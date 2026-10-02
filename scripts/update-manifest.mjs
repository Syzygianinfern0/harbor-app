// Writes release/harbor-update.json: the signed manifest that installed Harbor builds poll for updates.
// Usage: HARBOR_UPDATE_SIGNING_KEY="$(cat key.pem)" node scripts/update-manifest.mjs [download base URL]
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const key = process.env.HARBOR_UPDATE_SIGNING_KEY;
if (!key) throw new Error('HARBOR_UPDATE_SIGNING_KEY is not set.');
const file = `Harbor-${version}-arm64.zip`;
const data = readFileSync(`release/${file}`);
const base = process.argv[2] ?? `https://github.com/Syzygianinfern0/harbor-app/releases/download/v${version}`;
const manifest = { version, file, url: `${base}/${file}`, sha256: createHash('sha256').update(data).digest('hex'), size: statSync(`release/${file}`).size, notes: `https://github.com/Syzygianinfern0/harbor-app/releases/tag/v${version}` };
// Must match signedMessage() in src/desktop/appUpdateCore.ts.
const message = Buffer.from(`harbor-update\n${manifest.version}\n${manifest.file}\n${manifest.sha256}\n${manifest.size}\n`);
manifest.signature = sign(null, message, createPrivateKey(key)).toString('base64');
writeFileSync('release/harbor-update.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
