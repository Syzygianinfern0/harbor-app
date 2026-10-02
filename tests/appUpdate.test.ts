import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareVersions, parseManifest, signedMessage, updateBlocker, UPDATE_PUBLIC_KEY } from '../src/desktop/appUpdateCore';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const base = { version: '1.2.3', file: 'Harbor-1.2.3-arm64.zip', url: 'https://github.com/Syzygianinfern0/harbor-app/releases/download/v1.2.3/Harbor-1.2.3-arm64.zip', sha256: 'a'.repeat(64), size: 1234, notes: 'https://github.com/Syzygianinfern0/harbor-app/releases/tag/v1.2.3' };
const signed = (m = base, key = privateKey) => ({ ...m, signature: sign(null, signedMessage(m), key).toString('base64') });

test('versions compare numerically, not as text', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.4.0', '0.5.0'), -1);
});

test('a manifest is accepted only with a valid signature over its version, file, checksum and size', () => {
  assert.equal(parseManifest(signed(), pub).version, '1.2.3');
  for (const tamper of [{ version: '9.9.9', file: 'Harbor-9.9.9-arm64.zip' }, { sha256: 'b'.repeat(64) }, { size: 99 }]) assert.throws(() => parseManifest({ ...signed(), ...tamper }, pub), /signature/);
  assert.throws(() => parseManifest(signed(base, generateKeyPairSync('ed25519').privateKey), pub), /signature/);
  assert.throws(() => parseManifest({ ...base }, pub), /not signed/);
  assert.throws(() => parseManifest(signed(), UPDATE_PUBLIC_KEY), /signature/, 'test keys never verify against the release key');
});

test('malformed manifests are rejected before any download', () => {
  assert.throws(() => parseManifest(null, pub), /not valid/);
  assert.throws(() => parseManifest(signed({ ...base, version: 'v1.2' }), pub), /version/);
  assert.throws(() => parseManifest(signed({ ...base, file: '../../evil.zip' }), pub), /file/);
  assert.throws(() => parseManifest(signed({ ...base, url: 'file:///etc/passwd' }), pub), /download address/);
  assert.throws(() => parseManifest(signed({ ...base, url: 'http://example.com/x.zip' }), pub), /download address/);
  assert.equal(parseManifest(signed({ ...base, url: 'http://127.0.0.1:8080/Harbor-1.2.3-arm64.zip' }), pub).size, 1234);
});

test('apps on a disk image or under App Translocation cannot update in place', () => {
  assert.equal(updateBlocker('/Applications/Harbor.app'), undefined);
  assert.equal(updateBlocker('/Users/alice/Applications/Harbor.app'), undefined);
  assert.match(updateBlocker('/Volumes/Harbor 0.5.0/Harbor.app')!, /Applications folder/);
  assert.match(updateBlocker('/private/var/folders/x/AppTranslocation/ABC/d/Harbor.app')!, /Applications folder/);
  assert.match(updateBlocker('/usr/local/bin')!, /app bundle/);
});

test('the release script signs manifests that the app accepts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harbor-manifest-'));
  try {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    mkdirSync(path.join(dir, 'release'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
    writeFileSync(path.join(dir, 'release', `Harbor-${version}-arm64.zip`), 'zip bytes');
    execFileSync(process.execPath, [path.resolve('scripts/update-manifest.mjs')], { cwd: dir, env: { ...process.env, HARBOR_UPDATE_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, stdio: 'pipe' });
    const manifest = parseManifest(JSON.parse(readFileSync(path.join(dir, 'release', 'harbor-update.json'), 'utf8')), pub);
    assert.equal(manifest.size, 9);
    assert.equal(manifest.url, `https://github.com/Syzygianinfern0/harbor-app/releases/download/v${version}/Harbor-${version}-arm64.zip`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
