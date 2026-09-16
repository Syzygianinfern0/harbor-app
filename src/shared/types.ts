export type Launcher = 'shell' | 'codex' | 'claude' | 'custom';
export type SessionStatus = 'checking' | 'running' | 'exited' | 'unreachable' | 'missing';
export interface Host { id: string; label: string; source: 'local' | 'ssh-config' | 'manual' }
export interface SshConnection { target: string; hostname?: string; user?: string; port?: number; identityFile?: string }
export type Connection = string | SshConnection;
export interface SavedHost extends Host { enabled: boolean; connection?: SshConnection; defaultDirectory: string }
export interface Preferences { sidebar: { expandOnHover: boolean }; hosts: SavedHost[]; terminal: { fontSize: number; fontFamily: string; cursorBlink: boolean } }
export interface Session {
  id: string; tmuxName: string; paneId: string; name: string; host: string;
  cwd: string; launcher: Launcher; command: string; group: string; tags: string[];
  pinned: boolean; archived: boolean; createdAt: string; updatedAt: string;
  status: SessionStatus; detail?: string;
  hostId?: string; hostLabel?: string; connection?: SshConnection;
}
export interface CreateSession {
  name: string; host: string; cwd: string; launcher: Launcher;
  command?: string; group?: string; tags?: string[]; env?: Record<string, string>;
}
export interface Diagnostics { host: string; ok: boolean; home?: string; tmux?: string; shell?: string; codex?: string; claude?: string; error?: string }
export interface Snapshot { sessions: Session[]; hosts: SavedHost[]; preferences: Preferences; dataDir: string; home: string }
export type TerminalEvent = { id: string; type: 'data' | 'disconnected'; data: string };
export interface HarborApi {
  snapshot(): Promise<Snapshot>;
  savePreferences(preferences: Preferences): Promise<void>;
  sshCandidates(): Promise<Host[]>;
  resolveSsh(alias: string): Promise<SshConnection>;
  create(input: CreateSession): Promise<Session>;
  update(id: string, patch: Partial<Pick<Session, 'name' | 'group' | 'tags' | 'pinned' | 'archived'>>): Promise<void>;
  terminate(id: string): Promise<boolean>;
  forget(id: string): Promise<boolean>;
  attach(id: string, cols: number, rows: number): Promise<void>;
  detach(id: string): Promise<void>;
  input(id: string, data: string): Promise<void>;
  paste(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  diagnose(host: Connection): Promise<Diagnostics>;
  refresh(): Promise<void>;
  chooseFolder(): Promise<string | null>;
  openDataDir(): Promise<void>;
  openExternal(url: string): Promise<void>;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
  onTerminal(callback: (event: TerminalEvent) => void): () => void;
  onNewSession(callback: () => void): () => void;
  onPreferences(callback: () => void): () => void;
}
