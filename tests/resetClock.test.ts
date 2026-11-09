import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { RESET_GRACE_MS, ResetClock } from '../src/shared/resetClock';

const start = 1_900_000_000_000;
function setup() {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: start });
  const resets: number[] = [];
  const clock = new ResetClock({ interval: 30_000, onReset: () => resets.push(Date.now()) });
  const stop = clock.subscribe(() => {});
  return { clock, resets, stop };
}
test.afterEach(() => mock.timers.reset());

test('ticks just after the next reset time, not on the coarse interval', () => {
  const { clock, resets, stop } = setup();
  clock.setResets([start / 1000 + 5, start / 1000 + 90]);
  mock.timers.tick(5_000 + RESET_GRACE_MS - 1); assert.equal(resets.length, 0); assert.ok(clock.getNow() < start + 5_000);
  mock.timers.tick(1); assert.deepEqual(resets, [start + 5_000 + RESET_GRACE_MS]); assert.equal(clock.getNow(), start + 5_000 + RESET_GRACE_MS);
  // Re-armed for the next one, which also requests a refresh, once.
  mock.timers.tick(85_000); assert.equal(resets.length, 2);
  mock.timers.tick(600_000); assert.equal(resets.length, 2);
  stop();
});

test('falls back to the coarse interval, catches up on wake events, and stops when unused', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: start });
  const listeners = new Map<string, () => void>();
  const target = { addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn); }, removeEventListener: (type: string) => { listeners.delete(type); } };
  const clock = new ResetClock({ interval: 30_000, wake: [[target, 'focus']] }); let ticks = 0;
  const stop = clock.subscribe(() => ticks++);
  const before = ticks;
  mock.timers.tick(30_000); assert.equal(ticks, before + 1); assert.equal(clock.getNow(), start + 30_000);
  // A throttled timer: the wall clock moved on without a tick; regaining focus catches up at once.
  mock.timers.setTime(start + 50_000); listeners.get('focus')!(); assert.equal(clock.getNow(), start + 50_000);
  stop(); assert.equal(listeners.size, 0);
  const frozen = clock.getNow(); mock.timers.tick(120_000); assert.equal(clock.getNow(), frozen);
});

test('a reset that passed while timers slept is reported on the next catch-up, and new resets re-arm', () => {
  const { clock, resets, stop } = setup();
  clock.setResets([start / 1000 + 10]);
  mock.timers.setTime(start + 20_000); clock.tick(); assert.equal(resets.length, 1);
  clock.setResets([start / 1000 + 10, start / 1000 + 1]); clock.tick(); assert.equal(resets.length, 1); // already past: not again
  clock.setResets([start / 1000 + 25]); mock.timers.tick(5_000 + RESET_GRACE_MS); assert.equal(resets.length, 2);
  stop();
});
