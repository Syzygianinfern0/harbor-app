/** Settings categories, in sidebar order, and the static index Settings search reads. */
export type SettingsCategory = 'general' | 'agents' | 'remotes' | 'projects' | 'notifications' | 'open-in' | 'usage' | 'updates' | 'shortcuts' | 'icons' | 'about';
export const settingsCategories: {id: SettingsCategory; label: string; separator?: boolean}[] = [
  {id: 'general', label: 'General'}, {id: 'agents', label: 'Agents'}, {id: 'remotes', label: 'Remotes'}, {id: 'projects', label: 'Projects'}, {id: 'notifications', label: 'Notifications'}, {id: 'open-in', label: 'Open in…'},
  {id: 'usage', label: 'Usage', separator: true}, {id: 'updates', label: 'Updates'},
  {id: 'shortcuts', label: 'Shortcuts', separator: true}, {id: 'icons', label: 'Status icons'}, {id: 'about', label: 'About'},
];
export const isSettingsCategory = (value: unknown): value is SettingsCategory => settingsCategories.some(c => c.id === value);
export const categoryLabel = (id: SettingsCategory) => settingsCategories.find(c => c.id === id)!.label;

/** One searchable setting. `anchor` matches a `data-setting` attribute on its page, which is scrolled to and highlighted. `host` marks a per-remote setting. */
export interface SettingsEntry { label: string; keywords: string; category: SettingsCategory; anchor?: string; host?: boolean; /** Only SSH remotes have it, not This Mac. */ ssh?: boolean }
export const settingsIndex: SettingsEntry[] = [
  {category: 'general', label: 'Expand sidebar on hover', keywords: 'sidebar peek collapse rail hover', anchor: 'expand-on-hover'},
  {category: 'general', label: 'Terminal font size', keywords: 'terminal font text size zoom', anchor: 'font-size'},
  {category: 'general', label: 'Terminal font family', keywords: 'terminal font family menlo monospace nerd', anchor: 'font-family'},
  {category: 'general', label: 'Cursor blink', keywords: 'terminal cursor blink', anchor: 'cursor-blink'},
  {category: 'agents', label: 'Codex permission mode', keywords: 'codex sandbox approvals permission default full access read only', anchor: 'codex'},
  {category: 'agents', label: 'Claude Code permission mode', keywords: 'claude permission plan accept edits default full access', anchor: 'claude'},
  {category: 'remotes', label: 'Import from SSH config', keywords: 'ssh config import alias host remote', anchor: 'import'},
  {category: 'remotes', label: 'Add a remote manually', keywords: 'ssh host remote add manual machine', anchor: 'add'},
  {category: 'remotes', label: 'Test connection', keywords: 'ssh test diagnose tmux codex claude installed', host: true, anchor: 'test'},
  {category: 'remotes', label: 'Show in launcher', keywords: 'hide host remote launcher', host: true, anchor: 'enabled'},
  {category: 'remotes', label: 'SSH alias or address', keywords: 'ssh target alias address host', host: true, ssh: true, anchor: 'target'},
  {category: 'remotes', label: 'Hostname, username and port', keywords: 'ssh hostname user username port', host: true, ssh: true, anchor: 'hostname'},
  {category: 'remotes', label: 'Identity file', keywords: 'ssh key identity id_ed25519', host: true, ssh: true, anchor: 'identity'},
  {category: 'remotes', label: 'Default working directory', keywords: 'directory folder cwd default home', host: true, anchor: 'directory'},
  {category: 'projects', label: 'Reorder, hide or delete projects', keywords: 'projects order reorder hide visible delete remove', anchor: 'projects'},
  {category: 'notifications', label: 'Enable desktop notifications', keywords: 'notify notification alert', anchor: 'enabled'},
  {category: 'notifications', label: 'Play a sound', keywords: 'sound notify notification audio', anchor: 'sound'},
  {category: 'notifications', label: 'Notify even when Harbor is in front', keywords: 'focused foreground notify notification', anchor: 'whenFocused'},
  {category: 'notifications', label: 'Notify when an agent finishes working', keywords: 'complete done finished notify notification', anchor: 'onComplete'},
  {category: 'notifications', label: 'Send test notification', keywords: 'test notification macos', anchor: 'test'},
  {category: 'open-in', label: 'Apps in the Open in menu', keywords: 'open in finder terminal iterm vs code cursor zed editor app', anchor: 'apps'},
  {category: 'open-in', label: 'Default app', keywords: 'open in default editor app one click', anchor: 'apps'},
  {category: 'open-in', label: 'Custom command', keywords: 'open in custom command script sublime', anchor: 'custom'},
  {category: 'usage', label: 'Usage and cost', keywords: 'usage cost tokens spend money price model day week month', anchor: 'usage'},
  {category: 'updates', label: 'Check for Harbor updates', keywords: 'update version restart release harbor', anchor: 'harbor'},
  {category: 'updates', label: 'Update channel', keywords: 'beta stable channel release prerelease update', anchor: 'channel'},
  {category: 'updates', label: 'Update agents', keywords: 'codex claude version update agents npm', anchor: 'agents'},
  {category: 'shortcuts', label: 'Keyboard shortcuts', keywords: 'keys shortcut hotkey keyboard', anchor: 'shortcuts'},
  {category: 'icons', label: 'Chat status icons', keywords: 'status icon working attention finished error closed', anchor: 'icons'},
  {category: 'about', label: 'Version', keywords: 'version about harbor', anchor: 'version'},
  {category: 'about', label: 'Data folder', keywords: 'data folder profile sessions.json preferences.json', anchor: 'data'},
];

export interface SettingsResult { entry: SettingsEntry; host?: {id: string; label: string} }
/** Matches every word of the query against an entry's label, keywords and category. Per-remote entries are listed once per remote. */
export function searchSettings(query: string, hosts: {id: string; label: string; target?: string; local?: boolean}[]): SettingsResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const matches = (text: string) => words.every(word => text.toLowerCase().includes(word));
  const results: SettingsResult[] = [];
  for (const entry of settingsIndex) {
    const text = `${entry.label} ${entry.keywords} ${categoryLabel(entry.category)}`;
    if (!entry.host) { if (matches(text)) results.push({entry}); continue; }
    for (const host of hosts) if (!(entry.ssh && host.local) && matches(`${text} ${host.label} ${host.target ?? ''}`)) results.push({entry, host: {id: host.id, label: host.label}});
  }
  // A remote's name alone finds its page.
  for (const host of hosts) if (matches(`${host.label} ${host.target ?? ''}`) && !results.some(r => r.host?.id === host.id)) results.push({entry: {category: 'remotes', label: host.label, keywords: ''}, host: {id: host.id, label: host.label}});
  return results;
}
