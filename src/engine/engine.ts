import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ControlClient } from './control';
import { discoverHosts } from './hosts';
import { Transport, quote, validateHost } from './transport';
import type { CreateSession, Diagnostics, Host, Session, Snapshot } from '../shared/types';

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
  private hosts: Host[] = [];
  private clients = new Map<string, ControlClient>();
  private attaching = new Map<string, Promise<void>>();
  private connectionEpochs = new Map<string, number>();
  private writes = Promise.resolve();
  private polling?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private disposed = false;
  private launches = new Set<Promise<Session>>();
  constructor(readonly dataDir: string, readonly transport = new Transport()) { super(); }
  async init(poll = true) {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await this.transport.init();
    try {
      const parsed = JSON.parse(await readFile(path.join(this.dataDir, 'sessions.json'), 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions) || !parsed.sessions.every((s: Session) => typeof s.id === 'string' && /^harbor-[a-f0-9-]+$/.test(s.tmuxName) && /^%\d+$/.test(s.paneId) && typeof s.name === 'string' && typeof s.cwd === 'string' && typeof s.group === 'string' && Array.isArray(s.tags) && ['shell', 'codex', 'claude', 'custom'].includes(s.launcher))) throw new Error('Invalid session index.');
      this.sessions = parsed.sessions.map((session: Session) => { validateHost(session.host); return { ...session, status: 'checking' }; });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read the session index at ${this.dataDir}. It has been preserved. ${String(error)}`);
    }
    this.hosts = await discoverHosts();
    if (poll) { void this.refresh(); this.polling = setInterval(() => { void this.refresh(); }, 10000); this.polling.unref(); }
    return this.snapshot();
  }
  snapshot(): Snapshot {
    const hosts = [...this.hosts];
    for (const s of this.sessions) if (!hosts.some(h => h.id === s.host)) hosts.push({ id: s.host, label: s.host, source: 'manual' });
    return { sessions: structuredClone(this.sessions), hosts, home: homedir(), dataDir: this.dataDir };
  }
  private changed() { if (!this.disposed) this.emit('snapshot', this.snapshot()); }
  private persist() {
    const payload = JSON.stringify({ version: 1, sessions: this.sessions }, null, 2);
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
  async diagnose(host: string): Promise<Diagnostics> {
    validateHost(host);
    try {
      const result = await this.transport.run(host, this.transport.setup() + `printf 'HARBOR_HOME=%s\n' "$HOME"
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
  private async createInternal(input: CreateSession) {
    validateCreate(input);
    const id = randomUUID(); const tmuxName = `harbor-${id}`;
    const launch = input.launcher === 'custom' ? input.command! : input.launcher === 'shell' ? '' : input.launcher;
    const variables = Object.entries(input.env ?? {}).map(([key, value]) => `${key}=${quote(value)}`).join(' ');
    const inner = `cd -- ${directory(input.cwd)} || exit 1\n${launch ? launch : 'exec "${SHELL:-/bin/bash}" -l'}`;
    // Start the intended command directly, after the login shell initializes: no send-keys readiness race.
    const command = `exec env -u TMUX -u TMUX_PANE COLORTERM=truecolor ${variables} "\${SHELL:-/bin/bash}" ${launch ? `-lic ${quote(inner)}` : '-l'}`;
    const script = this.transport.setup() + `set -e
command -v tmux >/dev/null || { echo 'tmux is required on this host.' >&2; exit 1; }
cd -- ${directory(input.cwd)}
${this.transport.tmux(['-f', '/dev/null', 'new-session', '-d', '-P', '-F', 'HARBOR_PANE=#{pane_id}', '-s', tmuxName, '-x', '120', '-y', '32', command, ';', 'set-option', '-w', '-t', `=${tmuxName}:`, 'remain-on-exit', 'on', ';', 'set-option', '-t', `${tmuxName}`, 'status', 'off', ';', 'set-option', '-t', `${tmuxName}`, 'mouse', 'off', ';', 'set-option', '-w', '-t', `=${tmuxName}:`, 'allow-rename', 'off'])}
`;
    const result = await this.transport.run(input.host, script);
    const paneId = result.match(/^HARBOR_PANE=(%\d+)$/m)?.[1];
    if (!paneId) throw new Error(`The host did not return a pane ID. A session may exist as ${tmuxName}; do not automatically retry.`);
    const now = new Date().toISOString();
    const session: Session = { id, tmuxName, paneId, name: input.name.trim(), host: input.host, cwd: input.cwd || '~', launcher: input.launcher, command: launch, group: input.group?.trim() || 'Ungrouped', tags: input.tags ?? [], pinned: false, archived: false, createdAt: now, updatedAt: now, status: 'running' };
    this.sessions.push(session);
    try { await this.persist(); } catch (error) { this.changed(); throw new Error(`Session ${tmuxName} is running, but its index could not be saved: ${String(error)}`); }
    this.changed(); return structuredClone(session);
  }
  async update(id: string, patch: Partial<Pick<Session, 'name' | 'group' | 'tags' | 'pinned' | 'archived'>>) {
    const session = this.get(id);
    for (const key of ['name', 'group'] as const) if (patch[key] !== undefined) { bounded(patch[key], key, 100); if (!patch[key]?.trim()) throw new Error(`${key} cannot be empty.`); session[key] = patch[key]!.trim(); }
    if (patch.tags !== undefined) { if (!Array.isArray(patch.tags) || patch.tags.length > 20) throw new Error('Invalid tags.'); patch.tags.forEach(tag => bounded(tag, 'tag', 50)); session.tags = patch.tags; }
    for (const key of ['pinned', 'archived'] as const) if (patch[key] !== undefined) { if (typeof patch[key] !== 'boolean') throw new Error(`Invalid ${key}.`); session[key] = patch[key]!; }
    session.updatedAt = new Date().toISOString(); await this.persist(); this.changed();
  }
  async refresh() {
    if (this.refreshing || this.disposed) return;
    this.refreshing = true;
    try {
      this.hosts = await discoverHosts();
      await Promise.all([...new Set(this.sessions.map(s => s.host))].map(async host => {
        try {
          const result = await this.transport.run(host, this.transport.setup() + `command -v tmux >/dev/null || { echo 'tmux is missing' >&2; exit 127; }\n` + `${this.transport.tmux(['list-panes', '-a', '-F', 'HARBOR_STATUS=#{session_name}|#{pane_id}|#{pane_dead}|#{pane_current_command}|#{pane_dead_status}'])} 2>&1\n`, { retry: true, timeout: 12000 });
          const panes = result.split('\n').filter(line => line.startsWith('HARBOR_STATUS=')).map(line => line.slice(14).split('|'));
          for (const session of this.sessions.filter(s => s.host === host)) {
            const pane = panes.find(p => p[0] === session.tmuxName && p[1] === session.paneId);
            session.status = !pane ? 'missing' : pane[2] === '1' ? 'exited' : 'running';
            session.detail = !pane ? 'The tmux session no longer exists on this host.' : pane[2] === '1' ? `Process exited${pane[4] ? ` with code ${pane[4]}` : ''}. Scrollback is still available.` : pane[3];
          }
        } catch (error) {
          const message = (error as Error).message;
          const missing = /no server running|error connecting to .*No such file|no sessions/.test(message);
          for (const session of this.sessions.filter(s => s.host === host)) { session.status = missing ? 'missing' : 'unreachable'; session.detail = missing ? 'The tmux server is no longer running on this host.' : message; }
        }
      }));
      this.changed();
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
    const child = await this.transport.control(session.host, session.tmuxName);
    if (this.connectionEpochs.get(id) !== epoch || this.disposed) { child.stdin.end(); child.kill(); throw new Error('Connection was cancelled.'); }
    const client = new ControlClient(child, session.paneId);
    this.clients.set(id, client);
    client.on('data', (bytes: Buffer) => this.emit('terminal', { id, type: 'data', data: bytes.toString('base64') }));
    client.on('disconnected', data => { if (this.clients.get(id) === client) { this.transport.connectionFailed(session.host); this.clients.delete(id); this.emit('terminal', { id, type: 'disconnected', data }); } });
    try { await client.prime(cols, rows); } catch (error) { this.transport.connectionFailed(session.host); client.detach(); throw error; }
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
    await this.transport.run(session.host, this.transport.setup() + `set -e\nprintf '%b' ${quote(escaped)} | ${this.transport.tmux(['load-buffer', '-b', buffer, '-'])}\n${this.transport.tmux(['paste-buffer', '-p', '-d', '-b', buffer, '-t', session.paneId])}`);
  }
  private dimensions(cols: number, rows: number) { if (![cols, rows].every(n => Number.isInteger(n) && n >= 2 && n <= 1000)) throw new Error('Invalid terminal dimensions.'); }
  async resize(id: string, cols: number, rows: number) { this.dimensions(cols, rows); await this.clients.get(id)?.resize(cols, rows); }
  async terminate(id: string) {
    const session = this.get(id);
    await this.transport.run(session.host, this.transport.setup() + this.transport.tmux(['kill-session', '-t', `=${session.tmuxName}`]));
    this.detach(id); session.status = 'missing'; session.archived = true; session.detail = 'Terminated by you.';
    await this.persist(); this.changed();
  }
  async forget(id: string) {
    this.get(id); this.detach(id); this.sessions = this.sessions.filter(s => s.id !== id); await this.persist(); this.changed();
  }
  async dispose() {
    this.disposed = true; clearInterval(this.polling);
    await Promise.allSettled([...this.launches]);
    for (const id of this.clients.keys()) this.detach(id);
    await this.writes;
  }
}
