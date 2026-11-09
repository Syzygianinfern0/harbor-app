// A clock for usage limits: it ticks just after each known reset time, not only on a coarse interval, so a ring
// or a "paused" banner goes away the moment its window starts over, even when interval timers are throttled.

/** How long after a reset time to tick, so the reset has passed by the time the UI recomputes. */
export const RESET_GRACE_MS = 250;
const MAX_DELAY_MS = 2 ** 31 - 1; // longer timeouts fire at once
type Timer = ReturnType<typeof setTimeout>;
type Wake = { addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };
export interface ResetClockOptions {
  /** Coarse tick for relative text ("in 12m", "2 min ago"). */
  interval: number;
  /** Called once per tick in which at least one known reset time passed. */
  onReset?: () => void;
  /** Events that make the clock catch up at once (the window regaining focus or becoming visible). */
  wake?: [Wake, string][];
}

export class ResetClock {
  private listeners = new Set<() => void>();
  private resets: number[] = []; // milliseconds, ascending
  private timeout?: Timer; private interval?: ReturnType<typeof setInterval>;
  private now = Date.now();
  constructor(private options: ResetClockOptions) {}

  getNow = () => this.now;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stop(); };
  };
  /** Reset times in seconds since the epoch, as limit windows carry them. */
  setResets(seconds: Iterable<number>) {
    const next = [...new Set([...seconds].filter(s => Number.isFinite(s) && s > 0).map(s => s * 1000))].sort((a, b) => a - b);
    if (next.length === this.resets.length && next.every((value, i) => value === this.resets[i])) return;
    this.resets = next; this.arm();
  }
  /** Catch up with the wall clock: notify if time moved, report passed resets, and re-arm. */
  tick = () => {
    const before = this.now; this.now = Date.now();
    const passed = this.resets.some(reset => reset > before && reset <= this.now);
    if (this.now !== before) for (const listener of [...this.listeners]) listener();
    if (passed) this.options.onReset?.();
    this.arm();
  };

  private start() {
    this.interval = setInterval(this.tick, this.options.interval);
    for (const [target, type] of this.options.wake ?? []) target.addEventListener(type, this.tick);
    this.tick();
  }
  private stop() {
    clearInterval(this.interval); clearTimeout(this.timeout); this.interval = this.timeout = undefined;
    for (const [target, type] of this.options.wake ?? []) target.removeEventListener(type, this.tick);
  }
  private arm() {
    clearTimeout(this.timeout); this.timeout = undefined;
    if (!this.listeners.size) return;
    const next = this.resets.find(reset => reset > this.now);
    if (next !== undefined) this.timeout = setTimeout(this.tick, Math.min(MAX_DELAY_MS, next - this.now + RESET_GRACE_MS));
  }
}
