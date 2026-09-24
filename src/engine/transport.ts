import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import type { Connection, SshConnection } from '../shared/types';
import { terminalColors } from '../shared/terminalTheme';

export const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export function validateHost(host: string) {
  if (typeof host !== 'string' || host.length > 255 || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$/.test(host)) throw new Error('Enter a valid SSH alias or user@hostname.');
  return host;
}
export function validateConnection(input: Connection): SshConnection {
  const connection = typeof input === 'string' ? { target: input } : input;
  if (!connection || typeof connection !== 'object') throw new Error('Invalid SSH connection.');
  validateHost(connection.target);
  if (connection.hostname !== undefined) validateHost(connection.hostname);
  if (connection.user !== undefined && (typeof connection.user !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(connection.user))) throw new Error('Invalid SSH username.');
  if (connection.port !== undefined && (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535)) throw new Error('SSH port must be between 1 and 65535.');
  if (connection.identityFile !== undefined && (typeof connection.identityFile !== 'string' || connection.identityFile.length > 4096 || /[\x00-\x1f]/.test(connection.identityFile) || !(connection.identityFile.startsWith('/') || connection.identityFile.startsWith('~/')))) throw new Error('Identity file must be an absolute path or start with ~/.');
  return connection;
}
// Variables that must not leak from Harbor's launcher into terminals. The agent-session markers appear when
// Harbor (or its tmux server) was started from inside Claude Code; inheriting them makes every new chat look
// like a Claude Code child session, which disables its transcript saving.
export const strippedVariables = ['TMUX', 'TMUX_PANE', 'NO_COLOR', 'FORCE_COLOR', 'CLICOLOR', 'CLICOLOR_FORCE',
  'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT'];
export const unsetStripped = strippedVariables.map(name => `-u ${name}`).join(' ');
export function environment() {
  const env = { ...process.env };
  for (const name of strippedVariables) delete env[name];
  env.TERM = 'xterm-256color'; env.COLORTERM = 'truecolor';
  env.PATH = [...new Set([env.PATH, `${homedir()}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean))].join(':');
  return env;
}
export class CommandError extends Error {
  constructor(message: string, public code: number | null, public timedOut = false) { super(message); }
}
export async function collect(child: ChildProcessWithoutNullStreams, input: string | Readable = '', timeout = 15000) {
  return new Promise<string>((resolve, reject) => {
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 8_000_000) child.kill(); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); if (typeof input !== 'string') input.destroy(); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (typeof input !== 'string') input.destroy();
      if (code === 0 && !timedOut) resolve(stdout);
      else reject(new CommandError(timedOut ? 'Connection timed out. Check the host, network, and SSH authentication.' : [stderr.trim(), stdout.trim()].filter(Boolean).join('\n') || `Command exited (${code}).`, code, timedOut));
    });
    if (typeof input === 'string') child.stdin.end(input);
    else { input.on('error', error => { child.kill(); reject(error); }); input.pipe(child.stdin); }
  });
}
export class Transport {
  readonly muxDir = path.join('/tmp', `harbor-ssh-${userInfo().uid}`);
  private bypassUntil = new Map<string, number>();
  constructor(readonly socket = 'harbor') {
    if (!/^[a-zA-Z0-9_-]+$/.test(socket)) throw new Error('Invalid tmux socket name');
  }
  async init() {
    await mkdir(this.muxDir, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.muxDir);
    if (!stat.isDirectory() || stat.uid !== userInfo().uid) throw new Error('SSH control directory has unexpected ownership or type.');
    await chmod(this.muxDir, 0o700);
  }
  connectionFailed(host: Connection) { if (host !== 'local') this.bypassUntil.set(JSON.stringify(host), Date.now() + 60000); }
  private multiplex(host: Connection) { return (this.bypassUntil.get(JSON.stringify(host)) ?? 0) < Date.now(); }
  sshArgs(host: Connection, multiplex = true) {
    const connection = validateConnection(host);
    return ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
      ...(multiplex ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${this.muxDir}/%C`, '-o', 'ControlPersist=300'] : ['-o', 'ControlMaster=no', '-o', 'ControlPath=none']),
      ...(connection.hostname ? ['-o', `Hostname=${connection.hostname}`] : []),
      ...(connection.user ? ['-l', connection.user] : []),
      ...(connection.port ? ['-p', String(connection.port)] : []),
      ...(connection.identityFile ? ['-i', connection.identityFile.startsWith('~/') ? path.join(homedir(), connection.identityFile.slice(2)) : connection.identityFile] : []),
      connection.user ? connection.target.replace(/^[^@]+@/, '') : connection.target];
  }
  private spawnScript(host: Connection, multiplex = true) {
    return host === 'local'
      ? spawn('/bin/bash', ['--noprofile', '--norc', '-s'], { env: environment() })
      : spawn('/usr/bin/ssh', [...this.sshArgs(host, multiplex), 'bash --noprofile --norc -s'], { env: environment() });
  }
  async run(host: Connection, script: string, options: { retry?: boolean; timeout?: number } = {}) {
    await this.init();
    // Reads may retry without multiplexing. Mutations MUST NOT be replayed after an ambiguous timeout.
    try { return await collect(this.spawnScript(host, this.multiplex(host)), script, options.timeout); }
    catch (error) {
      if (host !== 'local' && error instanceof CommandError && (error.timedOut || error.code === 255)) {
        this.connectionFailed(host);
        if (options.retry) return collect(this.spawnScript(host, false), script, options.timeout);
      }
      throw error;
    }
  }
  setup() {
    // Same PATH on every operation; login-shell startup output cannot pollute the protocol.
    return 'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"\nunset TMUX TMUX_PANE NO_COLOR FORCE_COLOR CLICOLOR CLICOLOR_FORCE\nexport TERM=xterm-256color COLORTERM=truecolor\n';
  }
  async uploadFile(host: Connection, source: string, destination: string) {
    await this.init();
    const script = `umask 077; cat > ${quote(destination)}`;
    const child = host === 'local'
      ? spawn('/bin/bash', ['--noprofile', '--norc', '-c', script], { env: environment() })
      : spawn('/usr/bin/ssh', [...this.sshArgs(host, this.multiplex(host)), script], { env: environment() });
    await collect(child, createReadStream(source), 10 * 60 * 1000);
  }
  tmux(args: string[]) { return ['tmux', '-L', this.socket, ...args].map(quote).join(' '); }
  terminalCommand(command: string) {
    // Set defaults inside the new pane, before its app can query OSC 10/11.
    // This also works while detached and on tmux versions without color reports.
    const style = `fg=${terminalColors.foreground},bg=${terminalColors.background}`;
    return `${this.tmux(['select-pane', '-P', style])} -t "$TMUX_PANE" || exit 1\n${command}`;
  }
  async control(host: Connection, name: string) {
    await this.init();
    const script = this.setup() + `exec ${this.tmux(['-C', 'attach-session', '-f', 'no-output', '-t', `=${name}`])}`;
    // Control protocol needs stdin after startup, so the fixed, shell-quoted bootstrap goes in argv.
    return host === 'local'
      ? spawn('/bin/bash', ['--noprofile', '--norc', '-c', script], { env: environment() })
      : spawn('/usr/bin/ssh', [...this.sshArgs(host, this.multiplex(host)), `bash --noprofile --norc -c ${quote(script)}`], { env: environment() });
  }
}
