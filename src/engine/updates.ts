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
  const machines = new Map(hosts.filter(h=>h.enabled).map(h=>[JSON.stringify(h.connection??'local'),{id:h.id,label:h.label,connection:h.connection??'local'}]));
  for(const p of projects) if(!machines.has(JSON.stringify(p.connection))) machines.set(JSON.stringify(p.connection),{id:p.hostId??p.id,label:p.hostLabel,connection:p.connection});
  return (await Promise.all([...machines.values()].map(async host=>{
    let versions:Record<string,string>={}; let failure:string|undefined;
    try {
      // Match the login shell used by the launchers; don't mutate or upgrade either agent.
      const output=await transport.run(host.connection,transport.setup()+`"\${SHELL:-/bin/bash}" -lic ${quote("printf '\\nHARBOR_CODEX='; if command -v codex >/dev/null; then codex --version; else echo MISSING; fi; printf '\\nHARBOR_CLAUDE='; if command -v claude >/dev/null; then claude --version; else echo MISSING; fi")}`,{retry:true,timeout:20000});
      versions=Object.fromEntries([...output.matchAll(/^HARBOR_(CODEX|CLAUDE)=(.*)$/gm)].map(m=>[m[1].toLowerCase(),m[2].trim()]));
    } catch(error) {failure=(error as Error).message;}
    return latest.map(release=>({hostId:host.id,hostLabel:host.label,agent:release.agent,installed:versions[release.agent]?.match(/\d+\.\d+\.\d+/)?.[0],latest:release.version,status:failure?'unknown':versions[release.agent]==='MISSING'?'missing':release.version?compareVersions(versions[release.agent]??'',release.version):'unknown',error:failure??release.error,checkedAt:new Date().toISOString()} as AgentUpdate));
  }))).flat();
}
