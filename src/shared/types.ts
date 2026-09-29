export type Launcher = 'shell' | 'codex' | 'claude' | 'custom';
export type PermissionMode = 'standard' | 'read-only' | 'accept-edits' | 'plan' | 'full-access';
export type TabShortcut = number | 'next' | 'previous';
export type Activity = 'starting' | 'working' | 'attention' | 'background' | 'idle' | 'closed' | 'error' | 'unknown';
export interface Project { id: string; name: string; cwd: string; hostId?: string; hostLabel: string; connection: Connection; createdAt: string; hidden?: boolean; historyError?: string; note?: string }
export interface TokenUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalTokens: number }
export interface CostAmount { usd: number; estimated: number; recorded: number; unpriced: number }
export interface CostModel extends CostAmount { model: string }
export interface CostDay extends CostModel { day: string }
export interface CostSummary extends CostAmount { models: CostModel[]; days: CostDay[] }
export interface ChatUsage { cost?: CostSummary | null; pricingUpdatedAt?: string; periods?: Record<UsagePeriod, {tokens: TokenUsage; sessions: number; cost?: CostSummary}>; tokens?: TokenUsage | null; compactionCount?: number | null; subagents?: number; partial?: boolean; error?: string }
export type UsagePeriod = 'day' | 'week' | 'month';
export interface AgentUsage extends ChatUsage { periods: Record<UsagePeriod, {tokens: TokenUsage; sessions: number; cost?: CostSummary}>; agent: 'codex' | 'claude'; sessions: number; recordedSessions: number }
export interface HostUsage { pricingUpdatedAt?: string; hostId: string; hostLabel: string; checkedAt: string; agents: AgentUsage[]; error?: string }
export interface ChatPreview { messageCount?: number; messages: {role: string; text: string}[]; error?: string }
export interface Conversation { conversationId: string; launcher: 'codex' | 'claude'; name: string; cwd: string; updatedAt: number; createdAt: number; externalActive?: boolean; transcript?: string; hasMessages?: boolean }
export interface AgentUpdate { hostId: string; hostLabel: string; agent: 'codex' | 'claude'; installed?: string; latest?: string; status: 'current' | 'available' | 'missing' | 'unknown'; error?: string; checkedAt: string }
export interface AgentUpdateState { updates: AgentUpdate[]; checking: boolean; updatingAll: boolean; checkedAt?: number; running?: string; completed?: number; total?: number; error?: string; results: Record<string, {message: string; output?: string}> }
export type SessionStatus = 'checking' | 'running' | 'exited' | 'unreachable' | 'missing' | 'closed';
export interface Host { id: string; label: string; source: 'local' | 'ssh-config' | 'manual' }
export interface SshConnection { target: string; hostname?: string; user?: string; port?: number; identityFile?: string }
export type Connection = string | SshConnection;
export interface SavedHost extends Host { enabled: boolean; connection?: SshConnection; defaultDirectory: string }
export interface Preferences { agents: {codex:PermissionMode;claude:PermissionMode}; notifications: { enabled: boolean; sound: boolean; whenFocused: boolean; onComplete: boolean }; sidebar: { expandOnHover: boolean }; hosts: SavedHost[]; terminal: { fontSize: number; fontFamily: string; cursorBlink: boolean } }
export interface Session {
  id: string; tmuxName: string; paneId: string; name: string; host: string;
  cwd: string; launcher: Launcher; command: string; group: string; tags: string[];
  pinned: boolean; archived: boolean; createdAt: string; updatedAt: string;
  permissionMode?: PermissionMode; hasMessages?: boolean;
  originalLaunchCommand?: string; latestLaunchCommand?: string;
  status: SessionStatus; detail?: string;
  hostId?: string; hostLabel?: string; connection?: SshConnection;
  projectId?: string; projectRemoved?: boolean; conversationId?: string; generation?: string; activity?: Activity; activityDetail?: string; activityAt?: number; attentionAt?: number; completedAt?: number; resumable?: boolean; nameSource?: 'auto' | 'manual'; imported?: boolean; externalActive?: boolean; note?: string;
  /** Set when a notification-worthy event arrived while the chat was not on screen; cleared once it is viewed. Persisted. */
  unread?: boolean;
}
export interface CreateSession {
  name: string; host: string; cwd: string; launcher: Launcher; projectId?: string;
  permissionMode?: PermissionMode;
  command?: string; group?: string; tags?: string[]; env?: Record<string, string>;
}
export interface Diagnostics { host: string; ok: boolean; home?: string; tmux?: string; shell?: string; codex?: string; claude?: string; error?: string }
export interface Snapshot { agentUpdates?: AgentUpdateState; projects: Project[]; sessions: Session[]; hosts: SavedHost[]; preferences: Preferences; dataDir: string; home: string }
export interface DirectoryListing { directory: string; parent: string | null; home: string; query: string; entries: {name: string; path: string}[]; truncated: boolean }
/** What the renderer is showing: the focused pane's chat and every chat in a visible pane. */
export interface ChatView { focused: string | null; visible: string[] }
export type TerminalEvent = { id: string; type: 'data' | 'disconnected'; data: string };
export interface HarborApi {
  snapshot(): Promise<Snapshot>;
  savePreferences(preferences: Preferences): Promise<void>;
  sshCandidates(): Promise<Host[]>;
  resolveSsh(alias: string): Promise<SshConnection>;
  create(input: CreateSession): Promise<Session>;
  addProject(input: {name: string; host: string; cwd: string}): Promise<Project>;
  listDirectories(host: string, input: string, showHidden: boolean): Promise<DirectoryListing>;
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'note'>>): Promise<void>;
  manageProjects(projects: {id: string; hidden: boolean}[]): Promise<void>;
  usage(): Promise<HostUsage[]>;
  chatUsage(id: string): Promise<ChatUsage>;
  chatPreview(id: string): Promise<ChatPreview>;
  importHistory(projectId: string): Promise<void>;
  resume(id: string, restart?: boolean): Promise<Session>;
  openProjectInCursor(id: string): Promise<void>;
  updateAllAgents(): Promise<void>;
  checkUpdates(force?: boolean): Promise<AgentUpdate[]>;
  updateAgent(hostId: string, agent: AgentUpdate['agent']): Promise<{update: AgentUpdate; output: string}>;
  checkReachability(): Promise<Record<string,boolean>>;
  onTabShortcut(callback: (shortcut: TabShortcut) => void): () => void;
  onCloseSession(callback: () => void): () => void;
  openNotificationSettings(): Promise<void>;
  testNotification(sound?: boolean): Promise<string>;
  onOpenSession(callback: (id: string) => void): () => void;
  setChatView(view: ChatView): Promise<void>;
  update(id: string, patch: Partial<Pick<Session, 'name' | 'group' | 'tags' | 'pinned' | 'archived' | 'note'>>): Promise<void>;
  terminate(id: string): Promise<boolean>;
  forget(id: string): Promise<boolean>;
  attach(id: string, cols: number, rows: number): Promise<void>;
  detach(id: string): Promise<void>;
  input(id: string, data: string): Promise<void>;
  paste(id: string, data: string): Promise<void>;
  dropFiles(id: string, files: File[]): Promise<void>;
  copyText(text: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  diagnose(host: Connection): Promise<Diagnostics>;
  refresh(): Promise<void>;
  chooseFolder(): Promise<string | null>;
  openDataDir(): Promise<void>;
  openExternal(url: string): Promise<void>;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
  onTerminal(callback: (event: TerminalEvent) => void): () => void;
  onNewSession(callback: () => void): () => void;
  onRefresh(callback: () => void): () => void;
  onPreferences(callback: () => void): () => void;
}
