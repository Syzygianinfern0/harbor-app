import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Project } from '../shared/types';
import { validateConnection } from '../engine/transport';

export function cursorArguments(project: Pick<Project, 'connection' | 'cwd'>): string[] {
  if (!project.cwd.startsWith('/') || /[\x00-\x1f]/.test(project.cwd)) throw new Error('The project folder must be an absolute path.');
  if (project.connection === 'local') return ['--new-window', '--folder-uri', pathToFileURL(project.cwd).href];
  const connection = validateConnection(project.connection);
  const parts = connection.target.split('@');
  const user = connection.user ?? (parts.length > 1 ? parts[0] : undefined);
  const sshArgs: string[] = [];
  if (connection.hostname) sshArgs.push('-o', `Hostname=${connection.hostname}`);
  if (connection.identityFile) sshArgs.push('-i', connection.identityFile.startsWith('~/') ? path.join(homedir(), connection.identityFile.slice(2)) : connection.identityFile);
  // Cursor Remote-SSH's encoded authority preserves aliases (and their jump hosts)
  // while carrying Harbor's explicit user, port, hostname and key overrides.
  const authority = Buffer.from(JSON.stringify({hostName: parts.at(-1), user, port: connection.port,
    ...(sshArgs.length ? {sshArgs, userInDestination: true} : {})})).toString('hex');
  const folder = project.cwd.split('/').map(encodeURIComponent).join('/');
  return ['--new-window', '--folder-uri', `vscode-remote://ssh-remote+${authority}${folder}`];
}
export async function openProjectInCursor(project: Pick<Project, 'connection' | 'cwd'>) {
  const candidates = ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor', path.join(homedir(), 'Applications/Cursor.app/Contents/Resources/app/bin/cursor'),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'cursor'))];
  let executable: string | undefined;
  for (const candidate of candidates) {try {await access(candidate, constants.X_OK); executable = candidate; break;} catch {}}
  if (!executable) throw new Error('Cursor was not found. Install Cursor or add its cursor command to PATH.');
  await promisify(execFile)(executable, cursorArguments(project), {timeout: 15000, maxBuffer: 1024 * 1024});
}
