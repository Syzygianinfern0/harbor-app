import test from 'node:test';
import assert from 'node:assert/strict';
import { clipboardLimit, osc52Text } from '../src/shared/osc52';

const b64 = (text: string) => Buffer.from(text).toString('base64');
test('OSC 52 decodes clipboard writes, including UTF-8 and wrapped base64', () => {
  // Exact payload Claude Code 2.1.282 /copy emitted over SSH through tmux control mode.
  assert.deepEqual(osc52Text('c;Q09QWVRFU1QtUkVNT1RFLTU4MjI='), { text: 'COPYTEST-REMOTE-5822' });
  assert.deepEqual(osc52Text(';' + b64('héllo ✓\nline 2')), { text: 'héllo ✓\nline 2' });
  assert.deepEqual(osc52Text('pc;' + b64('x'.repeat(100)).replace(/(.{76})/g, '$1\n')), { text: 'x'.repeat(100) });
});
test('OSC 52 never reads or clears the clipboard and rejects malformed input', () => {
  for (const data of ['c;?', '?', 'c;', 'c', 'c;!!!!', 'c;abc', 'c;QQ==QQ==', 'x;' + b64('hi'), 'c;' + b64('hi') + ';extra', '52;c;' + b64('hi')]) assert.deepEqual(osc52Text(data), {}, data);
});
test('OSC 52 caps copied text at the clipboard IPC limit', () => {
  assert.equal(osc52Text('c;' + b64('a'.repeat(clipboardLimit))).text?.length, clipboardLimit);
  assert.match(osc52Text('c;' + b64('a'.repeat(clipboardLimit + 1))).error!, /too large/);
  assert.match(osc52Text('c;' + b64('a'.repeat(10 * clipboardLimit))).error!, /too large/);
});
