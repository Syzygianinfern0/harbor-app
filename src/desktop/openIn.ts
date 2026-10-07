import { execFile, spawn } from 'node:child_process';
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Connection, SshConnection } from '../shared/types';
import { appLabel, isOpenApp, supportsConnection, type OpenAppId, type OpenInPreferences } from '../shared/openIn';
import { environment, quote, validateConnection } from '../engine/transport';
import { openInVsCodeFamily } from './cursor';

export interface OpenTarget { cwd: string; connection: Connection }
type InstalledApp = Exclude<OpenAppId, 'custom'>;
/** Where each app usually lives, and its bundle ID for a Spotlight lookup when it is somewhere else. */
export const appBundles: Record<InstalledApp, { bundleId: string; paths: string[] }> = {
  finder: { bundleId: 'com.apple.finder', paths: ['/System/Library/CoreServices/Finder.app'] },
  terminal: { bundleId: 'com.apple.Terminal', paths: ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app'] },
  iterm: { bundleId: 'com.googlecode.iterm2', paths: ['iTerm.app'] },
  vscode: { bundleId: 'com.microsoft.VSCode', paths: ['Visual Studio Code.app'] },
  cursor: { bundleId: 'com.todesktop.230313mzl4w4u92', paths: ['Cursor.app'] },
  zed: { bundleId: 'dev.zed.Zed', paths: ['Zed.app'] },
};

export interface DetectDeps { exists(file: string): Promise<boolean>; spotlight(bundleId: string): Promise<string[]>; home: string }
const defaultDeps: DetectDeps = {
  exists: file => access(file).then(() => true, () => false),
  spotlight: bundleId => promisify(execFile)('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == "${bundleId}"`], { timeout: 3000 }).then(({ stdout }) => stdout.split('\n').filter(Boolean), () => []),
  home: homedir(),
};
/** Finds installed apps: /Applications and ~/Applications first, then Spotlight by bundle ID. */
export async function detectApps(deps: DetectDeps = defaultDeps): Promise<Partial<Record<InstalledApp, string>>> {
  const found = await Promise.all((Object.entries(appBundles) as [InstalledApp, typeof appBundles[InstalledApp]][]).map(async ([id, bundle]) => {
    const candidates = bundle.paths.flatMap(file => file.startsWith('/') ? [file] : [path.join('/Applications', file), path.join(deps.home, 'Applications', file)]);
    for (const candidate of candidates) if (await deps.exists(candidate)) return [id, candidate] as const;
    const hit = (await deps.spotlight(bundle.bundleId)).find(file => file.endsWith('.app') && !file.includes('/.Trash/'));
    return hit ? [id, hit] as const : undefined;
  }));
  return Object.fromEntries(found.filter(entry => !!entry));
}

function absolute(cwd: string) {
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || /[\x00-\x1f\x7f]/.test(cwd) || cwd.length > 4096) throw new Error('The folder must be an absolute path.');
  return path.posix.normalize(cwd);
}
/** ssh options for an interactive login that honors Harbor's per-host overrides; the destination comes last. */
export function interactiveSsh(connection: SshConnection, home = homedir()) {
  const c = validateConnection(connection);
  return ['-t',
    ...(c.hostname ? ['-o', `Hostname=${c.hostname}`] : []),
    ...(c.user ? ['-l', c.user] : []),
    ...(c.port ? ['-p', String(c.port)] : []),
    ...(c.identityFile ? ['-i', c.identityFile.startsWith('~/') ? path.join(home, c.identityFile.slice(2)) : c.identityFile] : []),
    '--', c.user ? c.target.replace(/^[^@]+@/, '') : c.target];
}
/** A self-deleting shell script that connects to the host and starts a login shell in the folder. Every value is
 *  single-quoted once for the local shell; the remote command is quoted again because ssh hands it to the remote shell. */
export function remoteShellScript(target: OpenTarget, home = homedir()) {
  const remote = `cd -- ${quote(absolute(target.cwd))} && exec "\${SHELL:-/bin/sh}" -l`;
  return ['#!/bin/sh', 'rm -f -- "$0"; rmdir -- "${0%/*}" 2>/dev/null', `exec /usr/bin/ssh ${interactiveSsh(validateConnection(target.connection), home).map(quote).join(' ')} ${quote(remote)}`, ''].join('\n');
}
/** Zed's remote URL: ssh://[user@]host[:port]/path, each path segment percent-encoded. */
export function zedRemoteUrl(target: OpenTarget) {
  const c = validateConnection(target.connection);
  if (!supportsConnection('zed', target.connection)) throw new Error('Zed can only open SSH hosts without hostname or identity-file overrides.');
  const [maybeUser, host] = c.target.includes('@') ? c.target.split('@') : [undefined, c.target];
  const user = c.user ?? maybeUser;
  return `ssh://${user ? encodeURIComponent(user) + '@' : ''}${host}${c.port ? ':' + c.port : ''}${absolute(target.cwd).split('/').map(encodeURIComponent).join('/')}`;
}

/** What to run. `script` is written to a private temporary file first and its path replaces `{script}` in `args`. */
export type LaunchPlan =
  | { kind: 'exec'; file: string; args: string[]; script?: string }
  | { kind: 'editor'; editor: 'vscode' | 'cursor' }
  | { kind: 'custom'; command: string; cwd: string; env: Record<string, string> };

const iTermScript = ['on run argv', 'tell application id "com.googlecode.iterm2"', 'activate', 'create window with default profile command (item 1 of argv)', 'end tell', 'end run'];
/** Builds the launch without running anything. Paths and hosts are passed as separate arguments, never through a shell. */
export function launchPlan(app: OpenAppId, target: OpenTarget, appPath: string | undefined, preferences: OpenInPreferences, home = homedir()): LaunchPlan {
  if (!isOpenApp(app)) throw new Error('Unknown app.');
  const cwd = absolute(target.cwd), remote = target.connection !== 'local';
  if (!supportsConnection(app, target.connection)) throw new Error(`${appLabel(app, preferences)} cannot open folders on SSH hosts.`);
  if (app === 'custom') {
    if (!preferences.customCommand) throw new Error('Set a custom command in Preferences → Open in.');
    const host = remote ? (() => { const c = validateConnection(target.connection); return c.user ? `${c.user}@${c.target.replace(/^[^@]+@/, '')}` : c.target; })() : '';
    return { kind: 'custom', command: preferences.customCommand, cwd: remote ? home : cwd, env: { HARBOR_DIR: cwd, HARBOR_HOST: host } };
  }
  if (!appPath) throw new Error(`${appLabel(app)} was not found. Install it, or hide it in Preferences → Open in.`);
  if (app === 'vscode' || app === 'cursor') return { kind: 'editor', editor: app };
  if (!remote) return { kind: 'exec', file: '/usr/bin/open', args: ['-a', appPath, cwd] };
  if (app === 'terminal') return { kind: 'exec', file: '/usr/bin/open', args: ['-a', appPath, '{script}'], script: remoteShellScript(target, home) };
  if (app === 'iterm') return { kind: 'exec', file: '/usr/bin/osascript', args: [...iTermScript.flatMap(line => ['-e', line]), '{script}'], script: remoteShellScript(target, home) };
  if (app === 'zed') return { kind: 'exec', file: path.join(appPath, 'Contents/MacOS/cli'), args: [zedRemoteUrl(target)] };
  throw new Error(`${appLabel(app)} cannot open folders on SSH hosts.`);
}

const failure = (app: string, error: unknown) => new Error(`Could not open in ${app}. ${String((error as { stderr?: string }).stderr || (error as Error).message || error).trim().split('\n').slice(-3).join(' ')}`);
/** Runs a plan. Custom commands get a moment to fail visibly, then are left running on their own. */
export async function runPlan(plan: LaunchPlan, label: string, target: OpenTarget, appPath: string | undefined) {
  if (plan.kind === 'editor') { await openInVsCodeFamily(plan.editor, appPath, { connection: target.connection, cwd: absolute(target.cwd) }).catch(error => { throw failure(label, error); }); return; }
  if (plan.kind === 'custom') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', plan.command], { cwd: plan.cwd, env: { ...environment(), ...plan.env }, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      const timer = setTimeout(() => { child.stderr.destroy(); child.unref(); resolve(); }, 1500);
      child.on('error', error => { clearTimeout(timer); reject(failure(label, error)); });
      child.on('exit', code => { clearTimeout(timer); if (code) reject(failure(label, { stderr: stderr || `The command exited with status ${code}.` })); else resolve(); });
    });
    return;
  }
  let dir: string | undefined;
  try {
    let args = plan.args;
    if (plan.script !== undefined) {
      // tmpdir() is per user and has no spaces (iTerm2 splits its command on them).
      dir = await mkdtemp(path.join(tmpdir(), 'harbor-open-'));
      const script = path.join(dir, 'open.command');
      await writeFile(script, plan.script, { mode: 0o700 }); await chmod(script, 0o700);
      args = args.map(arg => arg === '{script}' ? script : arg);
    }
    await promisify(execFile)(plan.file, args, { timeout: 15000, env: environment() });
    dir = undefined; // The script removes itself once the terminal runs it.
  } catch (error) { throw failure(label, error); }
  finally { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}

let cache: { at: number; apps: Promise<Partial<Record<InstalledApp, string>>> } | undefined;
/** Installed apps, re-detected at most every 30 seconds. */
export function installedApps(force = false) {
  if (force || !cache || Date.now() - cache.at > 30000) cache = { at: Date.now(), apps: detectApps() };
  return cache.apps;
}
export async function openIn(app: OpenAppId, target: OpenTarget, preferences: OpenInPreferences) {
  const apps = await installedApps();
  const appPath = app === 'custom' ? undefined : apps[app];
  await runPlan(launchPlan(app, target, appPath, preferences), appLabel(app, preferences), target, appPath);
}
