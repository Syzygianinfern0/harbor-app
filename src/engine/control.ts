import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { terminalColors } from '../shared/terminalTheme';

export function decodeOutput(raw: Buffer): Buffer {
  const result: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 92 && i + 3 < raw.length && raw.subarray(i + 1, i + 4).every(byte => byte >= 48 && byte <= 55)) {
      result.push(parseInt(raw.subarray(i + 1, i + 4).toString(), 8)); i += 3;
    } else result.push(raw[i]);
  }
  return Buffer.from(result);
}
export class ControlParser extends EventEmitter {
  private pending = Buffer.alloc(0);
  private block: { guard: string; lines: string[] } | undefined;
  feed(chunk: Buffer) {
    this.pending = Buffer.concat([this.pending, chunk]);
    let end: number;
    while ((end = this.pending.indexOf(10)) !== -1) {
      const raw = this.pending.subarray(0, end);
      this.pending = this.pending.subarray(end + 1);
      const line = raw.toString('utf8');
      if (this.block) {
        if (line === `%end ${this.block.guard}` || line === `%error ${this.block.guard}`) {
          this.emit('response', { ok: line.startsWith('%end'), text: this.block.lines.join('\n') }); this.block = undefined;
        } else this.block.lines.push(line);
      } else if (line.startsWith('%begin ')) this.block = { guard: line.slice(7), lines: [] };
      else if (line.startsWith('%output ')) {
        const space = raw.indexOf(32, 8);
        if (space !== -1) this.emit('output', raw.subarray(8, space).toString(), decodeOutput(raw.subarray(space + 1)));
      } else if (line.startsWith('%exit')) this.emit('exit', line.slice(5).trim());
    }
    if (this.pending.length > 16_000_000) { this.pending = Buffer.alloc(0); this.emit('exit', 'Terminal protocol line exceeded the buffer limit.'); }
  }
}
type Request = { resolve: (value: string) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };
export class ControlClient extends EventEmitter {
  private parser = new ControlParser();
  private requests: Request[] = [];
  private closed = false;
  private stderr = '';
  private priming = true;
  private buffered: Buffer[] = [];
  readonly ready: Promise<string>;
  constructor(private child: ChildProcessWithoutNullStreams, readonly pane: string) {
    super();
    this.ready = this.expect();
    child.stdout.on('data', chunk => this.parser.feed(chunk));
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
    child.stdin.on('error', () => {});
    child.on('error', error => this.finish(error.message));
    child.on('close', () => this.finish(this.stderr.trim() || 'Terminal connection detached.'));
    this.parser.on('exit', message => this.finish(message || 'Terminal connection detached.'));
    this.parser.on('output', (id, bytes) => { if (id === this.pane) { if (this.priming) this.buffered.push(bytes); else this.emit('data', bytes); } });
    this.parser.on('response', ({ ok, text }) => {
      const request = this.requests.shift();
      if (!request) return;
      clearTimeout(request.timer);
      if (ok) request.resolve(text); else request.reject(new Error(text || 'tmux command failed.'));
    });
  }
  private expect() {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { this.finish('Terminal connection timed out.'); this.child.kill(); }, 15000);
      this.requests.push({ resolve, reject, timer });
    });
  }
  command(command: string) {
    if (this.closed) return Promise.reject(new Error('Terminal is disconnected.'));
    if (command.includes('\n') || command.includes('\r')) return Promise.reject(new Error('Invalid control command.'));
    const response = this.expect(); this.child.stdin.write(command + '\n'); return response;
  }
  async prime(cols: number, rows: number) {
    await this.ready;
    // Newer tmux answers OSC 10/11 itself. Control clients must supply the
    // actual theme or tmux may report black for both foreground and background.
    // Probe command support instead of assuming the SSH host's tmux version.
    const commands = await this.command('list-commands');
    if (/^refresh-client\b[^\n]*\[-r /m.test(commands)) {
      for (const [osc, color] of [[10, terminalColors.foreground], [11, terminalColors.background]] as const) {
        const rgb = color.slice(1).match(/../g)!.map(byte => byte.repeat(2)).join('/');
        await this.command(`refresh-client -r "${this.pane}:\\033]${osc};rgb:${rgb}\\007"`);
      }
    }
    await this.command(`refresh-client -C ${cols},${rows}`);
    // Commands execute together on tmux's event loop: capture, cursor, then turn live output on.
    this.child.stdin.cork();
    const history = this.command(`capture-pane -p -e -t ${this.pane} -S -2000`);
    const position = this.command(`display-message -p -t ${this.pane} '#{cursor_x},#{cursor_y},#{pane_height},#{alternate_on},#{cursor_flag},#{keypad_cursor_flag},#{insert_flag},#{bracket_paste_flag},#{wrap_flag}'`);
    const enable = this.command('refresh-client -f !no-output');
    this.child.stdin.uncork();
    // Queue the snapshot and enable in one batch; buffer live events until the snapshot is emitted.
    const [text, coordinates] = await Promise.all([history, position, enable]);
    const [x, y, height, alternate, cursor, keypad, insert, paste, wrap] = coordinates.split(',').map(Number);
    const lines = text.split('\n');
    const prefix = alternate ? '\x1b[?1049h' : '';
    this.emit('data', Buffer.from(prefix + '\x1b[2J\x1b[H' + lines.join('\r\n') + `\x1b[${Math.max(1, rows - height + y + 1)};${x + 1}H` + `\x1b[?25${cursor ? 'h' : 'l'}\x1b[?1${keypad ? 'h' : 'l'}\x1b[4${insert ? 'h' : 'l'}\x1b[?2004${paste ? 'h' : 'l'}\x1b[?7${wrap ? 'h' : 'l'}`));
    this.priming = false;
    for (const bytes of this.buffered.splice(0)) this.emit('data', bytes);
  }
  async input(data: string) {
    const bytes = Buffer.from(data);
    for (let i = 0; i < bytes.length; i += 512) {
      await this.command(`send-keys -H -t ${this.pane} ${[...bytes.subarray(i, i + 512)].map(byte => byte.toString(16).padStart(2, '0')).join(' ')}`);
    }
  }
  resize(cols: number, rows: number) { return this.command(`refresh-client -C ${cols},${rows}`); }
  detach() { this.finish('Detached. Your session is still running.'); this.child.stdin.end('\n'); this.child.kill(); }
  private finish(message: string) {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.requests.splice(0)) { clearTimeout(request.timer); request.reject(new Error(message)); }
    this.emit('disconnected', message);
  }
}
