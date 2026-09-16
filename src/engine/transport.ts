import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';

export const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export function validateHost(host: string) {
  if (typeof host !== 'string' || host.length > 255 || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$/.test(host)) throw new Error('Enter a valid SSH alias or user@hostname.');
  return host;
}
export function environment() {
  const env = { ...process.env };
  delete env.TMUX; delete env.TMUX_PANE;
  env.PATH = [...new Set([env.PATH, `${homedir()}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean))].join(':');
  return env;
}
export class CommandError extends Error {
  constructor(message: string, public code: number | null, public timedOut = false) { super(message); }
}
export async function collect(child: ChildProcessWithoutNullStreams, input = '', timeout = 15000) {
  return new Promise<string>((resolve, reject) => {
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 8_000_000) child.kill(); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve(stdout);
      else reject(new CommandError(timedOut ? 'Connection timed out. Check the host, network, and SSH authentication.' : [stderr.trim(), stdout.trim()].filter(Boolean).join('\n') || `Command exited (${code}).`, code, timedOut));
    });
    child.stdin.end(input);
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
  connectionFailed(host: string) { if (host !== 'local') this.bypassUntil.set(host, Date.now() + 60000); }
  private multiplex(host: string) { return (this.bypassUntil.get(host) ?? 0) < Date.now(); }
  sshArgs(host: string, multiplex = true) {
    validateHost(host);
    return ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
      ...(multiplex ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${this.muxDir}/%C`, '-o', 'ControlPersist=300'] : ['-o', 'ControlMaster=no', '-o', 'ControlPath=none']), host];
  }
  private spawnScript(host: string, multiplex = true) {
    return host === 'local'
      ? spawn('/bin/bash', ['--noprofile', '--norc', '-s'], { env: environment() })
      : spawn('/usr/bin/ssh', [...this.sshArgs(host, multiplex), 'bash --noprofile --norc -s'], { env: environment() });
  }
  async run(host: string, script: string, options: { retry?: boolean; timeout?: number } = {}) {
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
    return 'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"\nunset TMUX TMUX_PANE\n';
  }
  tmux(args: string[]) { return ['tmux', '-L', this.socket, ...args].map(quote).join(' '); }
  async control(host: string, name: string) {
    await this.init();
    const script = this.setup() + `exec ${this.tmux(['-C', 'attach-session', '-f', 'no-output', '-t', `=${name}`])}`;
    // Control protocol needs stdin after startup, so the fixed, shell-quoted bootstrap goes in argv.
    return host === 'local'
      ? spawn('/bin/bash', ['--noprofile', '--norc', '-c', script], { env: environment() })
      : spawn('/usr/bin/ssh', [...this.sshArgs(host, this.multiplex(host)), `bash --noprofile --norc -c ${quote(script)}`], { env: environment() });
  }
}
