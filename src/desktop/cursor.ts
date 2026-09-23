import { execFile } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Project, SshConnection } from '../shared/types';
import { validateConnection } from '../engine/transport';

type SshDefaults = { hostname?: string; user?: string; port?: number };

function remoteConnection(authority: string): SshConnection | undefined {
  if (!authority.startsWith('ssh-remote+')) return;
  const value = authority.slice('ssh-remote+'.length);
  try {
    if (!/^(?:[\da-f]{2})+$/i.test(value)) return validateConnection(value);
    const decoded = JSON.parse(Buffer.from(value, 'hex').toString());
    const connection: SshConnection = { target: decoded.hostName, user: decoded.user, port: decoded.port };
    const args = decoded.sshArgs ?? [];
    if (!Array.isArray(args)) return;
    if (args.length && decoded.user !== undefined && decoded.userInDestination !== true) return;
    // Only compare the overrides Harbor understands; other SSH options can
    // change the destination or authentication and must not be ignored.
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === '-o' && typeof args[i + 1] === 'string' && args[i + 1].startsWith('Hostname=')) connection.hostname = args[i + 1].slice(9);
      else if (args[i] === '-i' && typeof args[i + 1] === 'string') connection.identityFile = args[i + 1];
      else return;
    }
    return validateConnection(connection);
  } catch { return; }
}

function connectionKey(connection: SshConnection, defaults: SshDefaults) {
  const parts = connection.target.split('@');
  return JSON.stringify([
    parts.at(-1), connection.hostname ?? defaults.hostname ?? parts.at(-1),
    connection.user ?? (parts.length > 1 ? parts[0] : defaults.user),
    connection.port ?? defaults.port,
    connection.identityFile?.replace(/^~\//, homedir() + '/'),
  ]);
}

export function cursorArguments(project: Pick<Project, 'connection' | 'cwd'>, existingFolders: string[] = [], defaults: SshDefaults = {}): string[] {
  if (!project.cwd.startsWith('/') || /[\x00-\x1f]/.test(project.cwd)) throw new Error('The project folder must be an absolute path.');
  if (project.connection === 'local') return ['--new-window', '--folder-uri', pathToFileURL(project.cwd).href];
  const connection = validateConnection(project.connection);
  const folderPath = path.posix.normalize(project.cwd).replace(/\/$/, '') || '/';
  for (const folder of existingFolders) {
    try {
      const uri = new URL(folder);
      if (uri.protocol !== 'vscode-remote:' || (path.posix.normalize(decodeURIComponent(uri.pathname)).replace(/\/$/, '') || '/') !== folderPath) continue;
      const existing = remoteConnection(decodeURIComponent(uri.host));
      if (existing && connectionKey(existing, defaults) === connectionKey(connection, defaults)) {
        // Preserve Cursor's exact authority, including legacy/plain aliases.
        // Its native folder matching focuses that window before creating one.
        return ['--new-window', '--folder-uri', folder];
      }
    } catch { /* Ignore stale or malformed entries in Cursor's window state. */ }
  }
  const parts = connection.target.split('@');
  const user = connection.user ?? (parts.length > 1 ? parts[0] : undefined);
  const sshArgs: string[] = [];
  if (connection.hostname) sshArgs.push('-o', `Hostname=${connection.hostname}`);
  if (connection.identityFile) sshArgs.push('-i', connection.identityFile.startsWith('~/') ? path.join(homedir(), connection.identityFile.slice(2)) : connection.identityFile);
  // Cursor Remote-SSH's encoded authority preserves aliases (and their jump hosts)
  // while carrying Harbor's explicit user, port, hostname and key overrides.
  const authority = Buffer.from(JSON.stringify({hostName: parts.at(-1), user, port: connection.port,
    ...(sshArgs.length ? {sshArgs, userInDestination: true} : {})})).toString('hex');
  const folder = folderPath.split('/').map(encodeURIComponent).join('/');
  return ['--new-window', '--folder-uri', `vscode-remote://ssh-remote+${authority}${folder}`];
}

async function cursorWindowFolders(): Promise<string[]> {
  const dataHome = process.platform === 'darwin' ? path.join(homedir(), 'Library/Application Support')
    : process.platform === 'win32' ? process.env.APPDATA : process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config');
  if (!dataHome) return [];
  try {
    const state = JSON.parse(await readFile(path.join(dataHome, 'Cursor/User/globalStorage/storage.json'), 'utf8')).windowsState;
    return [state?.lastActiveWindow, ...(Array.isArray(state?.openedWindows) ? state.openedWindows : [])]
      .map(window => window?.folder).filter((folder): folder is string => typeof folder === 'string');
  } catch { return []; }
}

export async function openProjectInCursor(project: Pick<Project, 'connection' | 'cwd'>) {
  cursorArguments(project); // Validate before resolving paths or reading SSH config.
  const candidates = ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor', path.join(homedir(), 'Applications/Cursor.app/Contents/Resources/app/bin/cursor'),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'cursor'))];
  let executable: string | undefined;
  for (const candidate of candidates) {try {await access(candidate, constants.X_OK); executable = candidate; break;} catch {}}
  if (!executable) throw new Error('Cursor was not found. Install Cursor or add its cursor command to PATH.');
  const existingFolders = await cursorWindowFolders();
  let defaults: SshDefaults = {};
  if (project.connection === 'local') {
    // Cursor identifies local folders by path, so resolve symlink aliases too.
    try {
      const canonical = await realpath(project.cwd);
      let cwd = canonical;
      for (const folder of existingFolders) {
        try {
          const existing = fileURLToPath(folder);
          if (await realpath(existing) === canonical) { cwd = existing; break; }
        } catch { /* Not an accessible local folder. */ }
      }
      project = {...project, cwd};
    } catch {}
  } else {
    const connection = validateConnection(project.connection);
    try {
      const alias = connection.target.split('@').at(-1)!;
      const {stdout} = await promisify(execFile)('/usr/bin/ssh', ['-G', alias], {timeout: 3000, maxBuffer: 1024 * 1024});
      const field = (key: string) => stdout.split('\n').find(line => line.startsWith(key + ' '))?.slice(key.length + 1).trim();
      defaults = {hostname: field('hostname'), user: field('user'), port: Number(field('port') || 22)};
    } catch { /* Exact authority matching still works without SSH config. */ }
  }
  await promisify(execFile)(executable, cursorArguments(project, existingFolders, defaults), {timeout: 15000, maxBuffer: 1024 * 1024});
}
