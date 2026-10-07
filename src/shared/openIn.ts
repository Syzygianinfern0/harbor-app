import type { Connection } from './types';

/** Apps a project or chat folder can be opened in. `custom` runs the user's own command. */
export type OpenAppId = 'finder' | 'terminal' | 'iterm' | 'vscode' | 'cursor' | 'zed' | 'custom';
export interface OpenApp { id: OpenAppId; label: string; remote: boolean; description: string }
export const openApps: readonly OpenApp[] = [
  { id: 'finder', label: 'Finder', remote: false, description: 'Shows the folder. Not available for SSH projects.' },
  { id: 'terminal', label: 'Terminal', remote: true, description: 'A new window in the folder; SSH projects connect with ssh first.' },
  { id: 'iterm', label: 'iTerm2', remote: true, description: 'A new window in the folder; SSH projects connect with ssh first (macOS asks once to let Harbor control iTerm2).' },
  { id: 'vscode', label: 'VS Code', remote: true, description: 'SSH projects open through the Remote - SSH extension.' },
  { id: 'cursor', label: 'Cursor', remote: true, description: 'SSH projects open through Cursor’s Remote SSH.' },
  { id: 'zed', label: 'Zed', remote: true, description: 'SSH projects open with Zed’s remote development.' },
  { id: 'custom', label: 'Custom command', remote: true, description: 'Runs your command with $HARBOR_DIR set to the folder and $HARBOR_HOST to the SSH host (empty on this Mac).' },
];
const ids = new Set<string>(openApps.map(app => app.id));
export const isOpenApp = (value: unknown): value is OpenAppId => typeof value === 'string' && ids.has(value);

/** Saved in preferences.json as `openIn`. Hidden (not shown) apps are stored, so newly supported apps appear by default. */
export interface OpenInPreferences { hidden: OpenAppId[]; defaultApp?: OpenAppId; customLabel: string; customCommand: string }
export const defaultOpenIn = (): OpenInPreferences => ({ hidden: [], customLabel: '', customCommand: '' });
const line = (value: unknown, max: number) => typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value) ? value.slice(0, max) : '';

/** Lenient: missing, unknown or malformed values fall back to defaults so older and newer files both load. */
export function normalizeOpenIn(value: unknown): OpenInPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const hidden = Array.isArray(input.hidden) ? [...new Set(input.hidden.filter(isOpenApp))] : [];
  return { hidden, ...(isOpenApp(input.defaultApp) ? { defaultApp: input.defaultApp } : {}), customLabel: line(input.customLabel, 40).trim(), customCommand: line(input.customCommand, 2000).trim() };
}

export const isRemote = (connection: Connection) => connection !== 'local';
/** Whether an app can open a folder on this connection. Zed's ssh:// URLs carry only user, host and port. */
export function supportsConnection(app: OpenAppId, connection: Connection) {
  if (!isRemote(connection)) return true;
  if (!openApps.find(entry => entry.id === app)?.remote) return false;
  if (app === 'zed') return typeof connection === 'string' ? !connection.includes(':') : !connection.hostname && !connection.identityFile && !connection.target.includes(':');
  return true;
}
export const appLabel = (app: OpenAppId, preferences?: OpenInPreferences) => app === 'custom' ? preferences?.customLabel || 'Custom command' : openApps.find(entry => entry.id === app)!.label;
/** Apps that can be offered at all: installed ones, plus the custom command once it is set. */
export const availableApps = (installed: readonly OpenAppId[], preferences: OpenInPreferences) => openApps.map(app => app.id).filter(id => id === 'custom' ? !!preferences.customCommand.trim() : installed.includes(id));
/** The apps listed in a menu for this folder, in catalog order. */
export const menuApps = (preferences: OpenInPreferences, installed: readonly OpenAppId[], connection: Connection) =>
  availableApps(installed, preferences).filter(id => !preferences.hidden.includes(id) && supportsConnection(id, connection));
/** The one-click target: the chosen default when it can open this folder, otherwise the first app in the menu. */
export function defaultApp(preferences: OpenInPreferences, installed: readonly OpenAppId[], connection: Connection): OpenAppId | undefined {
  const apps = menuApps(preferences, installed, connection);
  return preferences.defaultApp && apps.includes(preferences.defaultApp) ? preferences.defaultApp : apps[0];
}
