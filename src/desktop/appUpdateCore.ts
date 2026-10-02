import { createHash, createPublicKey, verify } from 'node:crypto';

// Release manifests are signed in CI with the matching private key (GitHub secret HARBOR_UPDATE_SIGNING_KEY).
// A download is trusted only if its manifest verifies against this key and its SHA-256 matches the manifest.
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/T3cPzRLISJsLmNOHkOZ8pWgYLrUfIafBNPG6qS9YM0=
-----END PUBLIC KEY-----
`;
// Stable follows the release marked latest; beta reads the release list, which also includes prereleases.
export const UPDATE_FEED = 'https://github.com/Syzygianinfern0/harbor-app/releases/latest/download/harbor-update.json';
export const RELEASES_API = 'https://api.github.com/repos/Syzygianinfern0/harbor-app/releases?per_page=20';
export const BUNDLE_ID = 'dev.harbor.agent-manager';

export interface UpdateManifest { version: string; file: string; url: string; sha256: string; size: number; notes?: string; signature: string }

const VERSION = /^\d+\.\d+\.\d+$/;
export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

/** The manifest URL of the newest published release, prerelease or not. Its signature is still checked after download. */
export function betaFeed(releases: unknown) {
  let best: { version: string; url: string } | undefined;
  for (const release of Array.isArray(releases) ? releases : []) {
    const version = /^v(\d+\.\d+\.\d+)$/.exec(release?.tag_name)?.[1];
    const url = Array.isArray(release?.assets) ? release.assets.find((asset: any) => asset?.name === 'harbor-update.json')?.browser_download_url : undefined;
    if (!version || release.draft || typeof url !== 'string' || !isAllowedUrl(url)) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, url };
  }
  if (!best) throw new Error('No Harbor release has been published yet.');
  return best.url;
}

/** The exact bytes the release signature covers. */
export function signedMessage(m: Pick<UpdateManifest, 'version' | 'file' | 'sha256' | 'size'>) {
  return Buffer.from(`harbor-update\n${m.version}\n${m.file}\n${m.sha256}\n${m.size}\n`);
}

/** Validates a manifest's shape and signature; throws with a user-readable reason otherwise. */
export function parseManifest(raw: unknown, publicKey = UPDATE_PUBLIC_KEY): UpdateManifest {
  const m = raw as Partial<UpdateManifest> | null;
  if (!m || typeof m !== 'object') throw new Error('The update manifest is not valid JSON.');
  if (typeof m.version !== 'string' || !VERSION.test(m.version)) throw new Error('The update manifest has no valid version.');
  if (typeof m.file !== 'string' || !/^Harbor-\d+\.\d+\.\d+-arm64\.zip$/.test(m.file)) throw new Error('The update manifest names an unexpected file.');
  if (typeof m.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.sha256)) throw new Error('The update manifest has no valid checksum.');
  if (typeof m.size !== 'number' || !Number.isSafeInteger(m.size) || m.size <= 0 || m.size > 1_000_000_000) throw new Error('The update manifest has no valid size.');
  if (typeof m.url !== 'string' || !isAllowedUrl(m.url)) throw new Error('The update manifest has an unexpected download address.');
  if (m.notes !== undefined && (typeof m.notes !== 'string' || !m.notes.startsWith('https://'))) throw new Error('The update manifest has an unexpected release notes address.');
  if (typeof m.signature !== 'string') throw new Error('The update manifest is not signed.');
  let ok = false;
  try { ok = verify(null, signedMessage(m as UpdateManifest), createPublicKey(publicKey), Buffer.from(m.signature, 'base64')); } catch { ok = false; }
  if (!ok) throw new Error('The update manifest signature is not valid.');
  return { version: m.version, file: m.file, url: m.url, sha256: m.sha256, size: m.size, notes: m.notes, signature: m.signature };
}

function isAllowedUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)); }
  catch { return false; }
}

/** Why an installed bundle can't update itself in place, or undefined when it can. */
export function updateBlocker(bundlePath: string) {
  if (!bundlePath.endsWith('.app')) return 'Harbor is not running from an app bundle.';
  if (bundlePath.startsWith('/Volumes/')) return 'Move Harbor to your Applications folder to get updates.';
  if (bundlePath.includes('/AppTranslocation/')) return 'Move Harbor to your Applications folder, then open it from there to get updates.';
  return undefined;
}

export function sha256(data: Buffer | string) { return createHash('sha256').update(data).digest('hex'); }
