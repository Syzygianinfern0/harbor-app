import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Preferences, SavedHost } from '../shared/types';
import { validateMode } from '../shared/agentModes';
import { defaultOpenIn, normalizeOpenIn } from '../shared/openIn';
import { validateConnection } from './transport';

export const defaultPreferences = (): Preferences => ({
  agents: {codex:'standard',claude:'standard'},
  notifications: { enabled: false, sound: true, whenFocused: false, onComplete: true },
  sidebar: { expandOnHover: true },
  hosts: [{ id: 'local', label: 'This Mac', source: 'local', enabled: true, defaultDirectory: '~' }],
  terminal: { fontSize: 13, fontFamily: '"MesloLGS NF", "JetBrainsMono Nerd Font", Menlo, Monaco, monospace', cursorBlink: true },
  updates: { channel: 'stable' },
  openIn: defaultOpenIn()
});
function text(value: unknown, max: number) { return typeof value === 'string' && value.length <= max && !/[\x00-\x1f]/.test(value); }
export function validatePreferences(value: Preferences): Preferences {
  if (!value || !Array.isArray(value.hosts) || value.hosts.length > 200 || !value.terminal) throw new Error('Invalid preferences.');
  const ids = new Set<string>();
  const hosts: SavedHost[] = value.hosts.map(host => {
    if (!host || !text(host.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(host.id) || ids.has(host.id)) throw new Error('Each host needs a unique ID.');
    ids.add(host.id);
    if (!text(host.label, 100) || !host.label.trim()) throw new Error('Each host needs a display name.');
    if (!['local', 'manual', 'ssh-config'].includes(host.source) || typeof host.enabled !== 'boolean') throw new Error('Invalid host settings.');
    if (!text(host.defaultDirectory, 4096) || !(host.defaultDirectory === '~' || host.defaultDirectory.startsWith('~/') || host.defaultDirectory.startsWith('/'))) throw new Error('Default folders must start with / or ~/.');
    if (host.id === 'local') {
      if (host.source !== 'local' || host.connection) throw new Error('The local host cannot have SSH settings.');
    } else {
      if (host.source === 'local' || !host.connection || host.connection.target === 'local') throw new Error('Enter an SSH target for this host.');
      validateConnection(host.connection);
    }
    return { id: host.id, label: host.label.trim(), source: host.source, enabled: host.enabled, defaultDirectory: host.defaultDirectory, ...(host.connection ? { connection: { ...host.connection } } : {}) };
  });
  if (!ids.has('local')) throw new Error('Keep the local host entry; you can hide it using its switch.');
  const { fontSize, fontFamily, cursorBlink } = value.terminal;
  if (!Number.isInteger(fontSize) || fontSize < 9 || fontSize > 28 || !text(fontFamily, 300) || !fontFamily.trim() || typeof cursorBlink !== 'boolean') throw new Error('Invalid terminal preferences.');
  const sidebar = value.sidebar ?? defaultPreferences().sidebar;
  if (typeof sidebar.expandOnHover !== 'boolean') throw new Error('Invalid sidebar preferences.');
  const notifications = value.notifications ?? defaultPreferences().notifications;
  if (['enabled','sound','whenFocused','onComplete'].some(key => typeof notifications[key as keyof typeof notifications] !== 'boolean')) throw new Error('Invalid notification preferences.');
  const agents=value.agents??defaultPreferences().agents;
  validateMode('codex',agents.codex);validateMode('claude',agents.claude);
  const updates = value.updates ?? defaultPreferences().updates;
  if (!['stable', 'beta'].includes(updates.channel)) throw new Error('Invalid update preferences.');
  return { agents:{codex:agents.codex,claude:agents.claude}, notifications: { ...notifications }, sidebar: { expandOnHover: sidebar.expandOnHover }, hosts, terminal: { fontSize, fontFamily, cursorBlink }, updates: { channel: updates.channel }, openIn: normalizeOpenIn(value.openIn) };
}
const preferenceSections: (keyof Preferences)[] = ['agents', 'notifications', 'sidebar', 'hosts', 'terminal', 'updates', 'openIn'];
export class PreferencesStore {
  value = defaultPreferences();
  private writes = Promise.resolve();
  constructor(private dataDir: string) {}
  async load() {
    try {
      const stored = JSON.parse(await readFile(path.join(this.dataDir, 'preferences.json'), 'utf8'));
      if (stored.version !== 1) throw new Error('Unsupported preferences version.');
      this.value = validatePreferences(stored.preferences);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Could not load preferences. The file has been preserved. ${String(error)}`);
    }
  }
  async save(input: Preferences) { await this.queue(() => validatePreferences(input)); }
  /** Replaces only the given sections, merged with the latest saved value inside the write queue, so concurrent updates from different settings pages never overwrite each other. */
  async update(patch: Partial<Preferences>) {
    if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !preferenceSections.includes(key as keyof Preferences))) throw new Error('Invalid preferences.');
    await this.queue(() => validatePreferences({ ...this.value, ...patch }));
  }
  private async queue(next: () => Preferences) {
    const write = this.writes.catch(() => {}).then(async () => {
      const value = next();
      const temporary = path.join(this.dataDir, `preferences.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify({ version: 1, preferences: value }, null, 2), { mode: 0o600, flush: true });
      await rename(temporary, path.join(this.dataDir, 'preferences.json'));
      this.value = value;
    });
    this.writes = write; await write;
  }
  async flush() { await this.writes; }
}
