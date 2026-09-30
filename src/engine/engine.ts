import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ControlClient } from './control';
import { discoverHosts } from './hosts';
import { checkAgentUpdates, updateMachines, installAgentUpdate } from './updates';
import { validateMode } from '../shared/agentModes';
import { forkBlocker, forkName } from '../shared/fork';
import { onlyArtifactWatches } from '../shared/chatStatus';
import { UpdateManager } from './updateManager';
import { AgentBridge } from './bridge';
import { PricingStore } from './pricing';
import { PreferencesStore } from './preferences';
import { Transport, quote, unsetStripped, validateHost, validateConnection } from './transport';
import type { Connection, CreateSession, Diagnostics, Preferences, Project, SshConnection, Session, Snapshot, AgentUpdate, HostUsage } from '../shared/types';

function bounded(value: unknown, label: string, max = 500) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b-\x1f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function directory(value: string) {
  if (value === '~' || value === '') return '"$HOME"';
  if (value.startsWith('~/')) return '"$HOME"/' + quote(value.slice(2));
  if (!value.startsWith('/')) throw new Error('Use an absolute folder path or a path starting with ~/.');
  return quote(value);
}
export function validateCreate(input: CreateSession) {
  if (!input || typeof input !== 'object') throw new Error('Invalid session.');
  bounded(input.name, 'name', 100); if (!input.name.trim()) throw new Error('Give the session a name.');
  validateHost(input.host); directory(bounded(input.cwd, 'folder', 4096));
  if (!['shell', 'codex', 'claude', 'custom'].includes(input.launcher)) throw new Error('Invalid launcher.');
  if(input.permissionMode!==undefined)validateMode(input.launcher,input.permissionMode);
  if (input.launcher === 'custom' && !input.command?.trim()) throw new Error('Enter a custom command.');
  if (input.command) bounded(input.command, 'command', 16000);
  bounded(input.group ?? '', 'group', 100);
  if (input.tags && (!Array.isArray(input.tags) || input.tags.length > 20)) throw new Error('Use up to 20 tags.');
  input.tags?.forEach(tag => bounded(tag, 'tag', 50));
  if (input.env && (typeof input.env !== 'object' || Object.keys(input.env).length > 100)) throw new Error('Invalid environment variables.');
  for (const [key, value] of Object.entries(input.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable: ${key}`);
    bounded(value, 'environment value', 32000);
  }
}
export class HarborEngine extends EventEmitter {
  private sessions: Session[] = [];
  private projects: Project[] = [];
  private bridge: AgentBridge;
  private updates: UpdateManager;
  private pricing: PricingStore;
  private operations = new Set<string>();
  private importing = new Set<string>();
  private preferencesStore: PreferencesStore;
  private clients = new Map<string, ControlClient>();
  private attaching = new Map<string, Promise<void>>();
  private connectionEpochs = new Map<string, number>();
  private writes = Promise.resolve();
  private polling?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private disposed = false;
  private launches = new Set<Promise<Session>>();
  constructor(readonly dataDir: string, readonly transport = new Transport()) { super(); this.preferencesStore = new PreferencesStore(dataDir); this.bridge = new AgentBridge(transport); this.pricing = new PricingStore(dataDir); this.updates = new UpdateManager(dataDir, () => JSON.stringify(updateMachines(this.preferencesStore.value.hosts, this.projects)), () => checkAgentUpdates(this.transport, this.preferencesStore.value.hosts, this.projects), (host, agent) => this.performAgentUpdate(host, agent), () => this.changed()); }
  async init(poll = true) {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await this.transport.init();
    try {
      const parsed = JSON.parse(await readFile(path.join(this.dataDir, 'sessions.json'), 'utf8'));
      if (![1, 2].includes(parsed.version) || !Array.isArray(parsed.sessions) || !parsed.sessions.every((s: Session) => typeof s.id === 'string' && /^harbor-[a-f0-9-]+$/.test(s.tmuxName) && /^%\d+$/.test(s.paneId) && typeof s.name === 'string' && typeof s.cwd === 'string' && typeof s.group === 'string' && Array.isArray(s.tags) && ['shell', 'codex', 'claude', 'custom'].includes(s.launcher))) throw new Error('Invalid session index.');
      this.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
      this.sessions = parsed.sessions.map((session: Session) => { validateHost(session.host); if (session.connection) validateConnection(session.connection); return { ...session, unread: session.unread === true || undefined, status: session.status === 'closed' ? 'closed' : 'checking', activity: session.status === 'closed' ? 'closed' : 'unknown' }; });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read the session index at ${this.dataDir}. It has been preserved. ${String(error)}`);
    }
    await this.preferencesStore.load();
    let migrated = false;
    for (const session of this.sessions) {
      if (session.projectRemoved) continue;
      if (session.projectId && this.projects.some(p => p.id === session.projectId)) continue;
      let project = this.projects.find(p => p.cwd === session.cwd && JSON.stringify(p.connection) === JSON.stringify(this.connection(session)));
      if (!project) { project = { id: randomUUID(), name: session.cwd === '~' ? 'Home' : path.basename(session.cwd), cwd: session.cwd, hostId: session.hostId, hostLabel: session.hostLabel || session.host, connection: this.connection(session), createdAt: session.createdAt }; this.projects.push(project); }
      session.projectId = project.id;
      const defaultName = /^(Codex|Claude Code|Shell) · /.test(session.name);
      session.nameSource = defaultName ? 'auto' : 'manual';
      if (defaultName) session.name = session.launcher === 'shell' ? 'Terminal' : 'Untitled chat';
      migrated = true;
    }
    if (migrated) await this.persist();
    await this.updates.load();
    if (poll) { void this.refresh(); this.polling = setInterval(() => { void this.refresh(); }, 2500); this.polling.unref(); }
    return this.snapshot();
  }
  snapshot(): Snapshot {
    const preferences = structuredClone(this.preferencesStore.value);
    return { agentUpdates: this.updates.snapshot(), projects: structuredClone(this.projects), sessions: structuredClone(this.sessions), hosts: preferences.hosts.filter(host => host.enabled), preferences, home: homedir(), dataDir: this.dataDir };
  }
  async savePreferences(preferences: Preferences) { await this.preferencesStore.save(preferences); this.changed(); }
  async sshCandidates() { return (await discoverHosts()).filter(host => host.source !== 'local'); }
  async resolveSsh(alias: string): Promise<SshConnection> {
    validateHost(alias);
    const output = await this.transport.run('local', `/usr/bin/ssh -G ${quote(alias)}`, { timeout: 10000 });
    const field = (key: string) => output.split('\n').find(line => line.startsWith(key + ' '))?.slice(key.length + 1).trim();
    return validateConnection({ target: alias, hostname: field('hostname'), user: field('user'), port: Number(field('port') || 22) });
  }
  private connection(session: Session): Connection { return session.connection ?? session.host; }

  checkUpdates(force = true) { return this.updates.check(force); }
  updateAllAgents() { return this.updates.updateAll(); }
  updateAgent(hostId: string, agent: AgentUpdate['agent']) { return this.updates.install(hostId, agent); }
  private updatingAgents = new Set<string>();
  private async performAgentUpdate(hostId:string,agent:AgentUpdate['agent']) {
    const host=updateMachines(this.preferencesStore.value.hosts,this.projects).find(h=>h.id===hostId);
    if(!host) throw new Error('Host is no longer configured. Check for updates again.');
    if(agent!=='codex'&&agent!=='claude') throw new Error('Unknown agent.');
    if(this.updatingAgents.has(hostId)) throw new Error('An update is already running on this machine.');
    this.updatingAgents.add(hostId);
    try {
      const output=await installAgentUpdate(this.transport,host.connection,agent);
      const results=await checkAgentUpdates(this.transport,[],[{id:host.id,hostLabel:host.label,connection:host.connection} as Project]);
      return {update:results.find(u=>u.agent===agent)!,output:output.slice(-12000)};
    } finally {this.updatingAgents.delete(hostId);}
  }
  async checkReachability() {
    const connections=new Map(this.projects.filter(p=>p.connection!=='local').map(p=>[JSON.stringify(p.connection),p.connection]));
    return Object.fromEntries(await Promise.all([...connections].map(async([key,connection])=>{
      try {await this.transport.run(connection,'true\n',{timeout:12000});return [key,true];}
      catch{return [key,false];}
    })));
  }
  async projectForEditor(id: string): Promise<Project> {
    const project = this.projects.find(p => p.id === id);
    if (!project) throw new Error('Project not found.');
    if (project.cwd.startsWith('/')) return structuredClone(project);
    const cwd = (await this.transport.run(project.connection, this.transport.setup()+`cd -- ${directory(project.cwd)} && pwd -P`)).trim();
    return {...structuredClone(project), cwd};
  }
  async listDirectories(host: string, input: string, showHidden: boolean) {
    bounded(input, 'folder', 4096);
    if (/[\x00-\x1f]/.test(input) || typeof showHidden !== 'boolean') throw new Error('Invalid folder query.');
    const profile = this.preferencesStore.value.hosts.find(h => h.id === host && h.enabled);
    if (!profile) throw new Error('Choose an enabled host.');
    return this.bridge.listDirectories(profile.connection ?? 'local', input, showHidden);
  }
  async addProject(input: {name:string; host:string; cwd:string}) {
    bounded(input.name, 'project name', 100); directory(bounded(input.cwd, 'folder',4096));
    const profile = this.preferencesStore.value.hosts.find(h => h.id === input.host && h.enabled);
    if (!profile) throw new Error('Choose an enabled host.');
    const connection = profile.connection ?? 'local';
    const cwd = (await this.transport.run(connection, this.transport.setup()+`cd -- ${directory(input.cwd)} && pwd -P`)).trim();
    const existing = this.projects.find(p => p.cwd === cwd && JSON.stringify(p.connection) === JSON.stringify(connection));
    if (existing) return structuredClone(existing);
    const project: Project = { id:randomUUID(), name:input.name.trim() || path.basename(cwd) || 'Home', cwd, hostId:profile.id, hostLabel:profile.label, connection:structuredClone(connection), createdAt:new Date().toISOString() };
    this.projects.push(project); await this.persist(); this.changed();
    await this.importHistory(project.id); return structuredClone(project);
  }
  async updateProject(id:string, patch:Partial<Pick<Project,'name'|'note'>>) {
    const project = this.projects.find(p=>p.id===id); if (!project) throw new Error('Project not found.');
    if (!patch || typeof patch !== 'object') throw new Error('Invalid project update.');
    if (patch.name !== undefined) { bounded(patch.name,'project name',100); if (!patch.name.trim()) throw new Error('Enter a project name.'); project.name=patch.name.trim(); }
    if (patch.note !== undefined) { const note = bounded(patch.note, 'note', 20000).trim(); if (note) project.note = note; else delete project.note; }
    await this.persist(); this.changed();
  }
  async manageProjects(items: {id:string;hidden:boolean}[]) {
    if (!Array.isArray(items) || new Set(items.map(p=>p.id)).size!==items.length || items.some(p=>typeof p.hidden!=='boolean'||!this.projects.some(v=>v.id===p.id))) throw new Error('Invalid project list.');
    const removed=this.projects.filter(p=>!items.some(v=>v.id===p.id));
    if(removed.some(p=>this.importing.has(p.id))) throw new Error('Wait for project refresh to finish before deleting it.');
    this.projects=items.map(item=>({...this.projects.find(p=>p.id===item.id)!,hidden:item.hidden}));
    for(const session of this.sessions) if(removed.some(p=>p.id===session.projectId)) {session.projectId=undefined;session.projectRemoved=true;}
    await this.persist(); this.changed();
  }
  private usagePending?: Promise<HostUsage[]>;
  usage(): Promise<HostUsage[]> {
    if (this.usagePending) return this.usagePending;
    this.usagePending = Promise.all(updateMachines(this.preferencesStore.value.hosts, this.projects).map(async host => {
      const base = {hostId: host.id, hostLabel: host.label, checkedAt: new Date().toISOString()};
      try { return {...base, ...await this.bridge.usage(host.connection,await this.pricing.get())}; }
      catch (error) { return {...base, agents: [], error: (error as Error).message}; }
    })).finally(() => { this.usagePending = undefined; });
    return this.usagePending;
  }
  async chatUsage(id: string) {
    const session = this.sessions.find(s => s.id === id);
    if (!session?.conversationId || !['codex','claude'].includes(session.launcher)) return {error:'No saved conversation is available yet.'};
    return this.bridge.chatUsage(this.connection(session), session.launcher, session.cwd, session.conversationId, await this.pricing.get());
  }
  async chatPreview(id:string) {
    const session=this.sessions.find(s=>s.id===id);
    if(!session || !session.conversationId || !['codex','claude'].includes(session.launcher)) return {messages:[],error:'No saved conversation is available yet.'};
    return this.bridge.preview(this.connection(session),session.launcher,session.cwd,session.conversationId);
  }
  async importHistory(projectId:string) {
    if (this.importing.has(projectId)) return;
    const project = this.projects.find(p=>p.id===projectId); if (!project) throw new Error('Project not found.');
    this.importing.add(projectId);
    try {
      await this.refreshMetadata();
      for (const session of this.sessions.filter(s=>s.projectId===projectId && !s.conversationId && !s.generation && s.status!=='closed' && (s.launcher==='codex'||s.launcher==='claude'))) {
        try {
          const pid=Number((await this.transport.run(project.connection,this.transport.setup()+this.transport.tmux(['display-message','-p','-t',`=${session.tmuxName}:`,'#{pane_pid}']))).trim());
          if(Number.isInteger(pid)&&pid>0) { const identity=await this.bridge.identify(project.connection,session.launcher,pid); if(identity) {session.conversationId=identity;session.resumable=true;this.dropDuplicates(session);} }
        } catch { /* Never guess which conversation belongs to an old terminal. */ }
      }
      const {conversations,errors} = await this.bridge.history(project.connection, project.cwd);
      project.historyError = errors.join('\n') || undefined;
      for (const conversation of conversations) {
        if (!/^[a-f0-9-]{36}$/i.test(conversation.conversationId)) continue;
        const matches = this.sessions.filter(s=>s.conversationId === conversation.conversationId && s.launcher === conversation.launcher && JSON.stringify(this.connection(s))===JSON.stringify(project.connection));
        const existing = matches.find(s=>!s.imported) ?? matches[0];
        if (existing) { this.dropDuplicates(existing); if(existing.projectRemoved){existing.projectId=projectId;existing.projectRemoved=false;} if(typeof conversation.hasMessages==='boolean'&&existing.hasMessages!==true)existing.hasMessages=conversation.hasMessages; if (existing.nameSource !== 'manual') existing.name=conversation.name; if (existing.status === 'closed') existing.externalActive=conversation.externalActive; continue; }
        const id=randomUUID(); const connection=project.connection;
        this.sessions.push({id,tmuxName:`harbor-${id}`,paneId:'%0',projectId,name:conversation.name,nameSource:'auto',host:typeof connection==='string'?connection:connection.target,hostId:project.hostId,hostLabel:project.hostLabel,...(typeof connection==='object'?{connection:structuredClone(connection)}:{}),cwd:conversation.cwd,launcher:conversation.launcher,command:conversation.launcher,group:project.name,tags:[],pinned:false,archived:false,createdAt:new Date(conversation.createdAt*1000).toISOString(),updatedAt:new Date(conversation.updatedAt*1000).toISOString(),status:'closed',activity:'closed',conversationId:conversation.conversationId,resumable:true,hasMessages:conversation.hasMessages,imported:true,externalActive:conversation.externalActive});
      }
      await this.persist(); this.changed();
    } catch(error) { project.historyError=(error as Error).message; this.changed(); }
    finally { this.importing.delete(projectId); }
  }
  private async refreshMetadata() {
    const relevant=this.sessions.filter(s=>s.generation && (s.launcher==='codex'||s.launcher==='claude') );
    const connections=new Map(relevant.map(s=>[JSON.stringify(this.connection(s)),this.connection(s)]));
    await Promise.all([...connections].map(async([key,connection])=>{
      const sessions=relevant.filter(s=>JSON.stringify(this.connection(s))===key);
      try {
        const metadata=await this.bridge.metadata(connection,sessions.map(s=>s.id));
        for(const session of sessions) {
          const meta=metadata[session.id]; if(!meta || meta.generation!==session.generation) continue;
          const previous=session.activity; const previousAt=session.activityAt;
          if(meta.conversationId && /^[a-f0-9-]{36}$/i.test(meta.conversationId)) {session.conversationId=meta.conversationId;this.dropDuplicates(session);}
          if(meta.hasMessages===true || (meta.hasMessages===false&&session.hasMessages!==true))session.hasMessages=meta.hasMessages;
          if(meta.resumable!==undefined) session.resumable=meta.resumable;
          if(meta.name && session.nameSource!=='manual') session.name=meta.name.slice(0,100);
          let {activity,reason,completedAt}=meta;
          // Older bridges record a watch-only wait as background and bump updatedAt every poll, so the finish time is fixed once
          // when the wait begins, and only a turn seen running announces it; a wait already on screen or settled is not a new finish.
          let settled=false;
          if(activity==='background'&&onlyArtifactWatches(reason)) {
            settled=!['starting','working','attention'].includes(previous??'');
            completedAt=previous==='idle'?Math.max(Number(completedAt||0),Number(session.completedAt||0))||meta.updatedAt:Math.max(Number(completedAt||0),Number(meta.updatedAt||0));
            activity='idle';reason='';
          }
          if(session.status !== 'closed' && activity && ['starting','working','attention','background','idle','closed','error','unknown'].includes(activity)) session.activity=activity;
          session.activityDetail=reason; session.activityAt=meta.updatedAt;
          const attention=Number(meta.attentionAt||0)>Number(session.attentionAt||0), completed=Number((settled?meta.completedAt:completedAt)||0)>Number(session.completedAt||0);
          if(session.status==='running'&&previousAt&&(attention||completed)) this.emit('attention',{session:structuredClone(session),completed:!attention&&completed});
          session.attentionAt=meta.attentionAt;session.completedAt=completedAt;
        }
      } catch { /* Connection failures are represented by the terminal status, never fabricated as idle. */ }
    }));
  }
  // An import can run before a Harbor chat learns its conversation ID, leaving a closed copy that
  // mistakes Harbor's own agent for an external writer. The Harbor-owned chat is authoritative.
  private dropDuplicates(owner: Session) {
    const key=JSON.stringify(this.connection(owner));
    this.sessions=this.sessions.filter(s=>s===owner || !s.imported || s.generation || s.status!=='closed' || s.conversationId!==owner.conversationId || s.launcher!==owner.launcher || JSON.stringify(this.connection(s))!==key);
  }
  private changed() { if (!this.disposed) this.emit('snapshot', this.snapshot()); }
  private persist() {
    const payload = JSON.stringify({ version: 2, sessions: this.sessions, projects: this.projects }, null, 2);
    const task = this.writes.catch(() => {}).then(async () => {
      const temp = path.join(this.dataDir, `sessions.${randomUUID()}.tmp`);
      await writeFile(temp, payload, { mode: 0o600, flush: true });
      await rename(temp, path.join(this.dataDir, 'sessions.json'));
    });
    this.writes = task; return task;
  }
  private get(id: string) {
    const session = this.sessions.find(s => s.id === id);
    if (!session) throw new Error('Session not found.'); return session;
  }
  async diagnose(input: Connection): Promise<Diagnostics> {
    const profile = typeof input === 'string' ? this.preferencesStore.value.hosts.find(host => host.id === input) : undefined;
    const connection = profile?.connection ?? input;
    const host = typeof connection === 'string' ? connection : connection.target;
    validateConnection(connection);
    try {
      const result = await this.transport.run(connection, this.transport.setup() + `printf 'HARBOR_HOME=%s\n' "$HOME"
printf 'HARBOR_SHELL=%s\n' "\${SHELL:-/bin/bash}"
printf 'HARBOR_TMUX='; tmux -V 2>/dev/null || true
printf 'HARBOR_CODEX='; command -v codex || true
printf 'HARBOR_CLAUDE='; command -v claude || true
`, { retry: true });
      const field = (key: string) => result.split('\n').find(line => line.startsWith(`HARBOR_${key}=`))?.split('=').slice(1).join('=') ?? '';
      const tmux = field('TMUX');
      return { host, ok: !!tmux, home: field('HOME'), shell: field('SHELL'), tmux, codex: field('CODEX'), claude: field('CLAUDE'), error: tmux ? undefined : 'tmux is missing on this host. Install tmux, then check again.' };
    } catch (error) { return { host, ok: false, error: (error as Error).message }; }
  }
  async create(input: CreateSession) {
    if (this.disposed) throw new Error('Harbor is shutting down.');
    const task = this.createInternal(input); this.launches.add(task);
    try { return await task; } finally { this.launches.delete(task); }
  }
  /** A new chat in the original's folder, host, launcher and mode that starts from its conversation under a new ID; the original is untouched. */
  async fork(id: string) {
    if (this.disposed) throw new Error('Harbor is shutting down.');
    const source = this.get(id);
    if (this.operations.has(id)) throw new Error('This chat is changing state. Fork it again in a moment.');
    const blocked = forkBlocker(source); if (blocked) throw new Error(blocked);
    const project = source.projectRemoved ? undefined : source.projectId;
    const task = this.createInternal({ name: forkName(source.name), host: source.host, cwd: source.cwd, launcher: source.launcher, projectId: project && this.projects.some(p => p.id === project) ? project : undefined, permissionMode: source.permissionMode, group: source.group, tags: [...source.tags] }, source);
    this.launches.add(task);
    try { return await task; } finally { this.launches.delete(task); }
  }
  private async createInternal(input: CreateSession, forkOf?: Session) {
    validateCreate(input);
    const project = input.projectId ? this.projects.find(p => p.id === input.projectId) : undefined;
    if (input.projectId && !project) throw new Error('Project not found.');
    const profile = this.preferencesStore.value.hosts.find(host => host.id === input.host && host.enabled);
    if (!project && !profile && !forkOf) throw new Error('Choose an enabled host from Preferences first.');
    const connection: Connection = structuredClone(project?.connection ?? (forkOf ? this.connection(forkOf) : profile?.connection) ?? 'local');
    // A fork keeps the original's folder: agents file conversations by the folder they ran in.
    if (project && !forkOf) input = { ...input, cwd: project.cwd };
    const id = randomUUID(); const tmuxName = `harbor-${id}`; const generation = randomUUID();
    const agent = input.launcher === 'codex' || input.launcher === 'claude';
    const permissionMode=agent?validateMode(input.launcher,input.permissionMode??this.preferencesStore.value.agents[input.launcher as 'codex'|'claude']):undefined;
    const launch = agent ? `python3 ${await this.bridge.ensure(connection)} run ${input.launcher} ${quote(id)} ${quote(generation)} --permission-mode ${quote(permissionMode!)}${forkOf ? ` --fork ${quote(forkOf.conversationId!)}` : ''}` : input.launcher === 'custom' ? input.command! : '';
    const variables = Object.entries(input.env ?? {}).map(([key, value]) => `${key}=${quote(value)}`).join(' ');
    const inner = `cd -- ${directory(input.cwd)} || exit 1\n${launch ? launch : 'exec "${SHELL:-/bin/bash}" -l'}`;
    // Start the intended command directly, after the login shell initializes: no send-keys readiness race.
    const command = this.transport.terminalCommand(`exec env ${unsetStripped} TERM=xterm-256color COLORTERM=truecolor ${variables} "\${SHELL:-/bin/bash}" ${launch ? `-lic ${quote(inner)}` : '-l'}`);
    const script = this.transport.setup() + `set -e
command -v tmux >/dev/null || { echo 'tmux is required on this host.' >&2; exit 1; }
cd -- ${directory(input.cwd)}
${this.transport.tmux(['-f', '/dev/null', 'new-session', '-d', '-P', '-F', 'HARBOR_PANE=#{pane_id}', '-s', tmuxName, '-x', '120', '-y', '32', command, ';', 'set-option', '-w', '-t', `=${tmuxName}:`, 'remain-on-exit', 'on', ';', 'set-option', '-t', `${tmuxName}`, 'status', 'off', ';', 'set-option', '-t', `${tmuxName}`, 'mouse', 'off', ';', 'set-option', '-w', '-t', `=${tmuxName}:`, 'allow-rename', 'off'])}
`;
    const result = await this.transport.run(connection, script);
    const paneId = result.match(/^HARBOR_PANE=(%\d+)$/m)?.[1];
    if (!paneId) throw new Error(`The host did not return a pane ID. A session may exist as ${tmuxName}; do not automatically retry.`);
    const now = new Date().toISOString();
    const session: Session = { originalLaunchCommand: command, latestLaunchCommand: command, permissionMode, ...(agent?{hasMessages:!!forkOf}:{}), ...(forkOf?{forkedFrom:forkOf.conversationId,resumable:false,...(forkOf.projectRemoved?{projectRemoved:true}:{})}:{}), id, tmuxName, paneId, name: input.name.trim(), host: typeof connection === 'string' ? connection : connection.target, hostId: project?.hostId ?? profile?.id ?? forkOf?.hostId, hostLabel: project?.hostLabel ?? profile?.label ?? forkOf?.hostLabel, projectId: project?.id, generation, activity: agent ? 'starting' : 'idle', nameSource: /^New (chat|terminal)$/.test(input.name) ? 'auto' : 'manual', ...(typeof connection === 'object' ? { connection } : {}), cwd: input.cwd || '~', launcher: input.launcher, command: launch, group: input.group?.trim() || 'Ungrouped', tags: input.tags ?? [], pinned: false, archived: false, createdAt: now, updatedAt: now, status: 'running' };
    if (!session.projectId && !session.projectRemoved) {
      let inferred = this.projects.find(p => p.cwd === input.cwd && JSON.stringify(p.connection) === JSON.stringify(connection));
      if (!inferred) { inferred = { id: randomUUID(), name: input.cwd === '~' ? 'Home' : path.basename(input.cwd), cwd: input.cwd, hostId: profile?.id, hostLabel: profile?.label || 'This Mac', connection, createdAt: now }; this.projects.push(inferred); }
      session.projectId = inferred.id;
    }
    this.sessions.push(session);
    try { await this.persist(); } catch (error) { this.changed(); throw new Error(`Session ${tmuxName} is running, but its index could not be saved: ${String(error)}`); }
    this.changed(); return structuredClone(session);
  }
  async update(id: string, patch: Partial<Pick<Session, 'name' | 'group' | 'tags' | 'pinned' | 'archived' | 'note'>>) {
    const session = this.get(id);
    for (const key of ['name', 'group'] as const) if (patch[key] !== undefined) { bounded(patch[key], key, 100); if (!patch[key]?.trim()) throw new Error(`${key} cannot be empty.`); session[key] = patch[key]!.trim(); }
    if (patch.tags !== undefined) { if (!Array.isArray(patch.tags) || patch.tags.length > 20) throw new Error('Invalid tags.'); patch.tags.forEach(tag => bounded(tag, 'tag', 50)); session.tags = patch.tags; }
    for (const key of ['pinned', 'archived'] as const) if (patch[key] !== undefined) { if (typeof patch[key] !== 'boolean') throw new Error(`Invalid ${key}.`); session[key] = patch[key]!; }
    if (patch.note !== undefined) { const note = bounded(patch.note, 'note', 20000).trim(); if (note) session.note = note; else delete session.note; }
    if (patch.name !== undefined) session.nameSource = 'manual';
    // A note is an annotation, not activity, so it does not reorder the chat list.
    if (Object.keys(patch).some(key => key !== 'note')) session.updatedAt = new Date().toISOString();
    await this.persist(); this.changed();
  }
  /** The unread marker (see shared/unread.ts); only a real change is persisted. */
  async setUnread(id: string, unread: boolean) {
    const session = this.sessions.find(s => s.id === id); if (!session || !!session.unread === unread) return;
    if (unread) session.unread = true; else delete session.unread;
    await this.persist(); this.changed();
  }
  async refresh() {
    if (this.refreshing || this.disposed) return;
    this.refreshing = true;
    try {
      const connections = new Map(this.sessions.filter(s => s.status !== 'closed').map(session => [JSON.stringify(this.connection(session)), this.connection(session)]));
      await Promise.all([...connections].map(async ([key, host]) => {
        try {
          const result = await this.transport.run(host, this.transport.setup() + `command -v tmux >/dev/null || { echo 'tmux is missing' >&2; exit 127; }\n` + `${this.transport.tmux(['list-panes', '-a', '-F', 'HARBOR_STATUS=#{session_name}|#{pane_id}|#{pane_dead}|#{pane_current_command}|#{pane_dead_status}'])} 2>&1\n`, { retry: true, timeout: 12000 });
          const panes = result.split('\n').filter(line => line.startsWith('HARBOR_STATUS=')).map(line => line.slice(14).split('|'));
          for (const session of this.sessions.filter(s => s.status !== 'closed' && JSON.stringify(this.connection(s)) === key)) {
            const pane = panes.find(p => p[0] === session.tmuxName && p[1] === session.paneId);
            session.status = !pane || pane[2] === '1' ? 'closed' : 'running';
            if (session.status === 'closed') { session.activity = 'closed'; this.detach(session.id); }
            session.detail = !pane ? 'The tmux session no longer exists on this host.' : pane[2] === '1' ? `Process exited${pane[4] ? ` with code ${pane[4]}` : ''}. Scrollback is still available.` : pane[3];
          }
        } catch (error) {
          const message = (error as Error).message;
          const missing = /no server running|error connecting to .*No such file|no sessions/.test(message);
          for (const session of this.sessions.filter(s => s.status !== 'closed' && JSON.stringify(this.connection(s)) === key)) { session.status = missing ? 'closed' : 'unreachable'; session.detail = missing ? 'The tmux server is no longer running on this host.' : message; }
        }
      }));
      await this.refreshMetadata();
      await this.persist(); this.changed();
    } finally { this.refreshing = false; }
  }
  async attach(id: string, cols: number, rows: number) {
    const epoch = (this.connectionEpochs.get(id) ?? 0) + 1;
    this.connectionEpochs.set(id, epoch);
    const previous = this.attaching.get(id);
    const task = (async () => {
      if (previous) await previous.catch(() => {});
      if (this.connectionEpochs.get(id) !== epoch) throw new Error('Connection was cancelled.');
      await this.attachInternal(id, cols, rows, epoch);
    })();
    this.attaching.set(id, task);
    try { await task; } finally { if (this.attaching.get(id) === task) this.attaching.delete(id); }
  }
  private async attachInternal(id: string, cols: number, rows: number, epoch: number) {
    this.dimensions(cols, rows);
    this.detachClient(id);
    const session = this.get(id);
    const child = await this.transport.control(this.connection(session), session.tmuxName);
    if (this.connectionEpochs.get(id) !== epoch || this.disposed) { child.stdin.end(); child.kill(); throw new Error('Connection was cancelled.'); }
    const client = new ControlClient(child, session.paneId);
    this.clients.set(id, client);
    client.on('data', (bytes: Buffer) => this.emit('terminal', { id, type: 'data', data: bytes.toString('base64') }));
    client.on('disconnected', data => { if (this.clients.get(id) === client) { this.transport.connectionFailed(this.connection(session)); this.clients.delete(id); this.emit('terminal', { id, type: 'disconnected', data }); } });
    try { await client.prime(cols, rows); } catch (error) { this.transport.connectionFailed(this.connection(session)); client.detach(); throw error; }
  }
  private detachClient(id: string) { const client = this.clients.get(id); this.clients.delete(id); client?.detach(); }
  detach(id: string) { this.connectionEpochs.set(id, (this.connectionEpochs.get(id) ?? 0) + 1); this.detachClient(id); }
  async input(id: string, data: string) {
    if (typeof data !== 'string' || data.length > 128000) throw new Error('Paste is too large. Use chunks smaller than 128 KB.');
    const client = this.clients.get(id); if (!client) throw new Error('Reconnect the terminal first.');
    await client.input(data);
  }
  async paste(id: string, data: string) {
    if (typeof data !== 'string' || data.length > 128000) throw new Error('Paste is too large. Use chunks smaller than 128 KB.');
    const session = this.get(id);
    if (!this.clients.has(id)) throw new Error('Reconnect the terminal first.');
    const buffer = 'harbor-paste-' + randomUUID();
    const escaped = [...Buffer.from(data)].map(byte => '\\0' + byte.toString(8).padStart(3, '0')).join('');
    // tmux owns bracketed-paste state, including on 3.2 where it cannot be queried as a format.
    await this.transport.run(this.connection(session), this.transport.setup() + `set -e\nprintf '%b' ${quote(escaped)} | ${this.transport.tmux(['load-buffer', '-b', buffer, '-'])}\n${this.transport.tmux(['paste-buffer', '-p', '-d', '-b', buffer, '-t', session.paneId])}`);
  }
  async dropFiles(id: string, paths: string[]) {
    const session = this.get(id);
    const client = this.clients.get(id);
    if (!client) throw new Error('Reconnect the terminal before dropping files.');
    if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error('Drop between 1 and 100 files or folders.');
    const folders = new Set<string>();
    for (const file of paths) {
      if (typeof file !== 'string' || !path.isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file)) throw new Error('This drop does not contain a usable file path.');
      const info = await stat(file);
      if (info.isDirectory()) folders.add(file);
      else if (!info.isFile()) throw new Error(`${path.basename(file)} is not a regular file or folder.`);
    }
    const connection = this.connection(session);
    let inserted = paths;
    if (connection !== 'local') {
      const root = (await this.transport.run(connection, 'set -e\numask 077\nmkdir -p "$HOME/.local/share/harbor/drops"\nmktemp -d "$HOME/.local/share/harbor/drops/drop.XXXXXXXX"')).trim();
      if (!root.startsWith('/') || /[\x00-\x1f\x7f]/.test(root)) throw new Error('Could not create the remote drop directory.');
      inserted = [];
      try {
        for (const [index, file] of paths.entries()) {
          const folder = `${root}/${index}`;
          await this.transport.run(connection, `mkdir -m 700 -- ${quote(folder)}`);
          const destination = `${folder}/${path.basename(file)}`;
          if (folders.has(file)) await this.transport.uploadDirectory(connection, file, folder);
          else await this.transport.uploadFile(connection, file, destination);
          inserted.push(destination);
        }
      } catch (error) {
        await this.transport.run(connection, `rm -rf -- ${quote(root)}`).catch(() => {});
        throw error;
      }
    }
    if (this.clients.get(id) !== client) throw new Error('The terminal reconnected during the file drop. Drop the files again.');
    await this.paste(id, inserted.map(quote).join(' ') + ' ');
  }
  private dimensions(cols: number, rows: number) { if (![cols, rows].every(n => Number.isInteger(n) && n >= 2 && n <= 1000)) throw new Error('Invalid terminal dimensions.'); }
  async resize(id: string, cols: number, rows: number) { this.dimensions(cols, rows); await this.clients.get(id)?.resize(cols, rows); }
  async terminate(id: string) {
    if (this.operations.has(id)) throw new Error('This chat is already changing state.');
    this.operations.add(id);
    try { await this.closeInternal(this.get(id)); } finally { this.operations.delete(id); }
  }
  private async closeInternal(session: Session) {
    if (session.status === 'closed') return;
    await this.refreshMetadata();
    await this.transport.run(this.connection(session), this.transport.setup() + `if ${this.transport.tmux(['has-session','-t',`=${session.tmuxName}`])} 2>/dev/null; then ${this.transport.tmux(['kill-session','-t',`=${session.tmuxName}`])}; fi`);
    this.detach(session.id); session.status = 'closed'; session.activity = 'closed'; session.archived = false; session.detail = 'Closed. Conversation history is preserved.';
    await this.persist(); this.changed();
  }
  async resume(id: string, restart = false) {
    if (this.operations.has(id)) throw new Error('This chat is already changing state.');
    this.operations.add(id);
    try {
      const session = this.get(id);

      if (session.status === 'running' && !restart) return structuredClone(session);
      const agent = session.launcher === 'codex' || session.launcher === 'claude';
      if (agent && !session.conversationId && (session.imported || !session.generation)) throw new Error('The conversation ID is missing; refresh the project history first.');
      if (restart) await this.closeInternal(session);
      const connection = this.connection(session); const generation = randomUUID();
      if (agent && session.conversationId) {
        let available = await this.bridge.available(connection, session.launcher, session.conversationId);
        for (let attempt=0; !available && (restart || !!session.generation) && attempt<20; attempt++) { await new Promise(resolve=>setTimeout(resolve,250)); available=await this.bridge.available(connection,session.launcher,session.conversationId); }
        if (!available) {session.externalActive=true;this.changed();throw new Error('This conversation still has an active writer. Close it in the other terminal before resuming here.');}
        session.externalActive=false;
      }
      await this.transport.run(connection, this.transport.setup() + `if ${this.transport.tmux(['has-session','-t',`=${session.tmuxName}`])} 2>/dev/null; then ${this.transport.tmux(['kill-session','-t',`=${session.tmuxName}`])}; fi`);
      const permissionMode=agent?validateMode(session.launcher,session.permissionMode??this.preferencesStore.value.agents[session.launcher as 'codex'|'claude']):undefined;
      const launch = agent ? `python3 ${await this.bridge.ensure(connection)} run ${session.launcher} ${quote(id)} ${quote(generation)} --permission-mode ${quote(permissionMode!)}${session.conversationId && session.resumable !== false ? ` --resume ${quote(session.conversationId)}` : session.forkedFrom ? ` --fork ${quote(session.forkedFrom)}` : ''}` : session.launcher === 'custom' ? session.command : '';
      const inner = `cd -- ${directory(session.cwd)} || exit 1\n${launch || 'exec "${SHELL:-/bin/bash}" -l'}`;
      const command = this.transport.terminalCommand(`exec env ${unsetStripped} TERM=xterm-256color COLORTERM=truecolor "\${SHELL:-/bin/bash}" -lic ${quote(inner)}`);
      // A new tmux name per incarnation prevents a delayed detach/kill from touching its successor.
      const tmuxName = `harbor-${randomUUID()}`;
      const result = await this.transport.run(connection, this.transport.setup() + `set -e\ncd -- ${directory(session.cwd)}\n${this.transport.tmux(['-f','/dev/null','new-session','-d','-P','-F','HARBOR_PANE=#{pane_id}','-s',tmuxName,'-x','120','-y','32',command,';','set-option','-w','-t',`=${tmuxName}:`,'remain-on-exit','on',';','set-option','-t',tmuxName,'status','off'])}`);
      const paneId = result.match(/^HARBOR_PANE=(%\d+)$/m)?.[1];
      if (!paneId) throw new Error(`The session may have started as ${tmuxName}; do not automatically retry.`);
      Object.assign(session, { completedAt: undefined, attentionAt: undefined, activityAt: undefined, activityDetail: undefined, latestLaunchCommand: command, permissionMode, paneId, tmuxName, generation, status:'running', activity: agent ? 'starting' : 'idle', archived:false, updatedAt:new Date().toISOString() });
      await this.persist(); this.changed(); return structuredClone(session);
    } finally { this.operations.delete(id); }
  }
  async forget(id: string) {
    this.get(id); this.detach(id); this.sessions = this.sessions.filter(s => s.id !== id); await this.persist(); this.changed();
  }
  async dispose() {
    this.disposed = true; clearInterval(this.polling);
    await Promise.allSettled([...this.launches]);
    for (const id of this.clients.keys()) this.detach(id);
    await this.writes;
    await this.preferencesStore.flush();
    await this.updates.flush();
  }
}
