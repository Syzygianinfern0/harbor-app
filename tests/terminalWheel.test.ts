import test from 'node:test';
import assert from 'node:assert/strict';
import { WheelAccumulator, wheelSequence } from '../src/renderer/terminalWheel';
import { mouseModes } from '../src/engine/control';

const plain = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const pixels = (deltaY: number) => ({ deltaY, deltaMode: 0 });

test('trackpad pixels become one row per cell height, carrying the remainder', () => {
  const wheel = new WheelAccumulator();
  assert.equal(wheel.rows(pixels(10), 20, 40), 0);
  assert.equal(wheel.rows(pixels(35), 20, 40), 2);
  assert.equal(wheel.rows(pixels(200), 20, 40), 10);
});

test('reversing direction drops leftover motion', () => {
  const wheel = new WheelAccumulator();
  wheel.rows(pixels(15), 20, 40);
  assert.equal(wheel.rows(pixels(-20), 20, 40), -1);
});

test('line and page deltas scale, capped at one screen per event', () => {
  const wheel = new WheelAccumulator();
  assert.equal(wheel.rows({ deltaY: 3, deltaMode: 1 }, 20, 40), 3);
  assert.equal(wheel.rows({ deltaY: 1, deltaMode: 2 }, 20, 40), 40);
  assert.equal(wheel.rows(pixels(-5000), 20, 40), -40);
});

test('mouse tracking sends one SGR wheel report per row', () => {
  const mode = { tracking: true, sgr: true, alternate: true, applicationCursor: false };
  assert.equal(wheelSequence(-2, mode, plain, 5, 7), '\x1b[<64;5;7M\x1b[<64;5;7M');
  assert.equal(wheelSequence(1, mode, { ...plain, ctrlKey: true }, 1, 1), '\x1b[<81;1;1M');
  assert.equal(wheelSequence(1, { ...mode, sgr: false }, plain, 1, 1), undefined);
  assert.equal(wheelSequence(0, mode, plain, 1, 1), '');
});

test('alternate screen without tracking sends arrow keys; normal screen is left to xterm', () => {
  const mode = { tracking: false, sgr: false, alternate: true, applicationCursor: false };
  assert.equal(wheelSequence(3, mode, plain, 1, 1), '\x1b[B\x1b[B\x1b[B');
  assert.equal(wheelSequence(-1, { ...mode, applicationCursor: true }, plain, 1, 1), '\x1bOA');
  assert.equal(wheelSequence(2, { ...mode, alternate: false }, plain, 1, 1), undefined);
});

test('reattach restores the pane mouse modes', () => {
  assert.equal(mouseModes(1, 0, 0, 1, 0), '\x1b[?1000h\x1b[?1006h');
  assert.equal(mouseModes(0, 1, 0, 1, 0), '\x1b[?1002h\x1b[?1006h');
  assert.equal(mouseModes(0, 0, 1, 0, 1), '\x1b[?1003h\x1b[?1005h');
  assert.equal(mouseModes(0, 0, 0, 0, 0), '');
  assert.equal(mouseModes(NaN, NaN, NaN, NaN, NaN), '');
});
