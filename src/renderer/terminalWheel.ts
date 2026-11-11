// Ghostty-style wheel scrolling for full-screen terminal apps.
// xterm.js sends at most one wheel report (or arrow key) per DOM wheel event and damps trackpad deltas,
// so a trackpad flick that is 30 rows of motion reaches Claude Code or Codex as a handful of steps.
// Here every row's worth of motion becomes one report, like a native terminal.

export type WheelInput = { deltaY: number; deltaMode: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean };
export type WheelMode = { tracking: boolean; sgr: boolean; alternate: boolean; applicationCursor: boolean };

const PIXEL = 0, LINE = 1;

/** Accumulates pixel deltas and returns whole rows scrolled (negative is up). */
export class WheelAccumulator {
  private partial = 0;
  rows(event: Pick<WheelInput, 'deltaY' | 'deltaMode'>, cellHeight: number, pageRows: number) {
    if (!event.deltaY || cellHeight <= 0) return 0;
    const amount = event.deltaMode === PIXEL ? event.deltaY / cellHeight : event.deltaMode === LINE ? event.deltaY : event.deltaY * pageRows;
    // Reversing direction drops leftover motion so the first reversed step responds at once.
    if (this.partial && Math.sign(this.partial) !== Math.sign(amount)) this.partial = 0;
    this.partial += amount;
    const whole = Math.trunc(this.partial);
    this.partial -= whole;
    return Math.max(-pageRows, Math.min(pageRows, whole));
  }
  reset() { this.partial = 0; }
}

/** The bytes for `rows` of wheel motion, or undefined when xterm's own handling should run. */
export function wheelSequence(rows: number, mode: WheelMode, event: Pick<WheelInput, 'altKey' | 'ctrlKey' | 'metaKey'>, col: number, row: number) {
  if (!rows) return '';
  const count = Math.abs(rows);
  if (mode.tracking) {
    if (!mode.sgr) return undefined; // Legacy encodings are rare under tmux; leave them to xterm.
    const button = (rows < 0 ? 64 : 65) + (event.altKey || event.metaKey ? 8 : 0) + (event.ctrlKey ? 16 : 0);
    return `\x1b[<${button};${col};${row}M`.repeat(count);
  }
  if (mode.alternate) return `\x1b${mode.applicationCursor ? 'O' : '['}${rows < 0 ? 'A' : 'B'}`.repeat(count);
  return undefined; // Normal screen: xterm scrolls its own scrollback, which is already smooth.
}
