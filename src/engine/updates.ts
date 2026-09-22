import type { AgentUpdate, Project, SavedHost } from '../shared/types';
import { Transport, quote } from './transport';

export function compareVersions(installed:string, latest:string) {
  const parse=(s:string)=>s.match(/\d+\.\d+\.\d+/)?.[0].split('.').map(Number);
  const a=parse(installed), b=parse(latest); if(!a||!b) return 'unknown' as const;
  for(let i=0;i<3;i++) { if(a[i]<b[i]) return 'available' as const; if(a[i]>b[i]) return 'current' as const; }
  return 'current' as const;
}
export async function checkAgentUpdates(transport:Transport, hosts:SavedHost[], projects:Project[]):Promise<AgentUpdate[]> {
  const latest = await Promise.all((['codex','claude'] as const).map(async agent=>{
    try {
      const url=agent==='codex'?'https://registry.npmjs.org/@openai/codex/latest':'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';
      const response=await fetch(url,{signal:AbortSignal.timeout(12000)}); if(!response.ok) throw new Error(`Release lookup returned ${response.status}`);
      const json=await response.json() as {version?:string}; if(!/^\d+\.\d+\.\d+/.test(json.version??'')) throw new Error('Release version unavailable');
      return {agent,version:json.version!};
    } catch(error) { return {agent,error:(error as Error).message}; }
  }));
  const machines = updateMachines(hosts,projects);
  return (await Promise.all(machines.map(async host=>{
    let versions:Record<string,string>={}; let failure:string|undefined;
    try {
      // Match the login shell used by the launchers; don't mutate or upgrade either agent.
      const output=await transport.run(host.connection,transport.setup()+`"\${SHELL:-/bin/bash}" -lic ${quote("printf '\\nHARBOR_CODEX='; if command -v codex >/dev/null; then codex --version; else echo MISSING; fi; printf '\\nHARBOR_CLAUDE='; if command -v claude >/dev/null; then claude --version; else echo MISSING; fi")}`,{retry:true,timeout:20000});
      versions=Object.fromEntries([...output.matchAll(/^HARBOR_(CODEX|CLAUDE)=(.*)$/gm)].map(m=>[m[1].toLowerCase(),m[2].trim()]));
    } catch(error) {failure=(error as Error).message;}
    return latest.map(release=>({hostId:host.id,hostLabel:host.label,agent:release.agent,installed:versions[release.agent]?.match(/\d+\.\d+\.\d+/)?.[0],latest:release.version,status:failure?'unknown':versions[release.agent]==='MISSING'?'missing':release.version?compareVersions(versions[release.agent]??'',release.version):'unknown',error:failure??release.error,checkedAt:new Date().toISOString()} as AgentUpdate));
  }))).flat();
}

export function updateMachines(hosts:SavedHost[],projects:Project[]) {
  const machines=new Map(hosts.filter(h=>h.enabled).map(h=>[JSON.stringify(h.connection??'local'),{label:h.label,connection:h.connection??'local'}]));
  for(const p of projects) if(!machines.has(JSON.stringify(p.connection))) machines.set(JSON.stringify(p.connection),{label:p.hostLabel,connection:p.connection});
  return [...machines].map(([id,host])=>({id,...host}));
}

export function agentUpdateScript(agent:AgentUpdate['agent']) {
  if(agent!=='codex'&&agent!=='claude') throw new Error('Unknown agent.');
  const pkg=agent==='codex'?'@openai/codex':'@anthropic-ai/claude-code';
  // Resolve the active binary before choosing its owner. Never install a second copy over an unknown installation.
  return `set -e
binary=$(command -v ${agent}) || { echo 'Agent is not installed.' >&2; exit 1; }
resolved="$binary"
while [ -L "$resolved" ]; do
  link=$(readlink "$resolved")
  case "$link" in /*) resolved="$link" ;; *) resolved="$(dirname "$resolved")/$link" ;; esac
done
resolved="$(cd "$(dirname "$resolved")" && pwd -P)/$(basename "$resolved")"
case "$resolved" in
  */Cellar/*|*/Caskroom/*|*/Homebrew/*)
    command -v brew >/dev/null
    brew upgrade ${agent==='codex'?'codex':'claude-code'} ;;
  */node_modules/${pkg}/*)
    root=$(npm root -g)
    case "$resolved" in "$root"/${pkg}/*) npm install -g ${pkg}@latest ;; *) echo 'The active agent is not owned by the current global npm installation. Update it using its original package manager.' >&2; exit 1 ;; esac ;;
  ${agent==='codex'?'*/packages/standalone/*/codex) "$binary" update ;;':''}
  ${agent==='claude'?'*/.local/share/claude/*|*/.claude/local/*) claude update ;;':''}
  *) echo 'Unsupported installation path. Update this agent with its original installer, then check again.' >&2; exit 1 ;;
esac
`;
}
export async function installAgentUpdate(transport:Transport, connection:Project['connection'], agent:AgentUpdate['agent']) {
  const script=agentUpdateScript(agent);
  return transport.run(connection,transport.setup()+`"\${SHELL:-/bin/bash}" -lic ${quote(script)}`,{timeout:180000});
}
