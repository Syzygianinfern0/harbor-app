import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSettings, settingsCategories, settingsIndex } from '../src/shared/settingsIndex';

const hosts = [{ id: 'local', label: 'This Mac', local: true }, { id: 'devbox', label: 'devbox', target: 'devbox.example.invalid' }];

test('settings search matches every word across labels, keywords and categories', () => {
  assert.deepEqual(searchSettings('', hosts), []);
  assert.deepEqual(searchSettings('beta', hosts).map(r => r.entry.label), ['Update channel']);
  assert.deepEqual(searchSettings('font size', hosts).map(r => r.entry.label), ['Terminal font size']);
  assert.ok(searchSettings('NOTIFY sound', hosts).some(r => r.entry.label === 'Play a sound'));
});

test('per-remote settings list once per remote, SSH-only ones skip This Mac, and a remote name finds its page', () => {
  const identity = searchSettings('identity', hosts);
  assert.deepEqual(identity.map(r => r.host?.id), ['devbox']);
  assert.deepEqual(searchSettings('test connection', hosts).map(r => r.host?.id), ['local', 'devbox']);
  const byName = searchSettings('devbox', hosts);
  assert.ok(byName.length > 0 && byName.every(r => r.host?.id === 'devbox'));
});

test('every indexed setting points at a real category', () => {
  const ids = new Set(settingsCategories.map(c => c.id));
  for (const entry of settingsIndex) assert.ok(ids.has(entry.category), entry.label);
});
