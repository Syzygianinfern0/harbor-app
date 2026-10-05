import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createWriteStream, openSync } from 'node:fs';
import { access, constants, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppUpdateState, UpdateChannel } from '../shared/types';
import { betaFeed, BUNDLE_ID, compareVersions, RELEASES_API, parseManifest, UPDATE_FEED, updateBlocker, type UpdateManifest } from './appUpdateCore';

const run = promisify(execFile);
const CHECK_EVERY = 4 * 60 * 60 * 1000;

// Waits for Harbor to exit, swaps in the staged bundle (keeping the old one for rollback) and optionally relaunches.
// It never touches tmux: quitting Harbor only detaches, so chats keep running throughout.
const INSTALLER = `#!/bin/bash
pid="$1"; target="$2"; staged="$3"; previous="$4"; relaunch="$5"
for _ in $(seq 1 600); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$pid" 2>/dev/null; then echo "Harbor did not exit; update skipped."; exit 1; fi
codesign --verify --deep --strict "$staged" || { echo "The staged update failed its signature check."; exit 1; }
rm -rf "$previous"; mkdir -p "$(dirname "$previous")"
mv "$target" "$previous" || { echo "Could not move the current app aside."; exit 1; }
if ! mv "$staged" "$target"; then mv "$previous" "$target"; echo "Could not install the update; restored the previous app."; exit 1; fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
touch "$target"
echo "Installed $(date)."
if [ "$relaunch" = 1 ]; then
  # Isolated profiles (tests, sandboxes) relaunch with their own environment; normal installs go through Launch Services.
  if [ -n "$HARBOR_DATA_DIR" ]; then nohup "$target/Contents/MacOS/Harbor" >/dev/null 2>&1 & else open "$target"; fi
fi
`;

export class AppUpdater extends EventEmitter {
  private state: AppUpdateState;
  private dir: string;
  private staged?: { version: string; app: string };
  private busy?: Promise<AppUpdateState>;
  private timer?: NodeJS.Timeout;
  private installOnQuit = true;

  constructor(private readonly options: { version: string; bundlePath: string; userData: string; enabled: boolean; disabledReason?: string; feed?: string; releases?: string; publicKey?: string; channel: () => UpdateChannel; fetch?: typeof fetch }) {
    super();
    this.dir = path.join(options.userData, 'updates');
    const reason = !options.enabled ? options.disabledReason ?? 'This copy of Harbor was built from source, so it does not update itself. Release builds from GitHub do.' : updateBlocker(options.bundlePath);
    this.state = reason ? { current: options.version, status: 'disabled', reason } : { current: options.version, status: 'idle' };
  }

  // Electron passes net.fetch: Node's fetch can hit an internal assertion (undici `assert(!this.paused)`)
  // when the server closes the connection while a large download is paused for backpressure.
  private get fetch() { return this.options.fetch ?? fetch; }

  get snapshot() { return this.state; }
  private set(patch: Partial<AppUpdateState>) { this.state = { ...this.state, ...patch }; this.emit('state', this.state); }

  /** Checks shortly after launch, then every few hours; `check()` also runs on wake. */
  start() {
    if (this.state.status === 'disabled') return;
    void this.restoreStaged();
    const first = setTimeout(() => void this.check().catch(() => undefined), 20_000); first.unref();
    this.timer = setInterval(() => void this.check().catch(() => undefined), CHECK_EVERY); this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  skipInstallOnQuit() { this.installOnQuit = false; }

  check(): Promise<AppUpdateState> {
    if (this.state.status === 'disabled' || this.state.status === 'installing') return Promise.resolve(this.state);
    if (this.state.status === 'ready') return Promise.resolve(this.state);
    return this.busy ??= this.checkNow().finally(() => { this.busy = undefined; });
  }

  private async checkNow() {
    this.set({ status: 'checking', error: undefined });
    try {
      await this.ensureWritable();
      const response = await this.fetch(await this.feed(), { signal: AbortSignal.timeout(15_000), headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) throw new Error(response.status === 404 ? 'No Harbor release has been published yet.' : `The update check failed (HTTP ${response.status}).`);
      const manifest = parseManifest(await response.json(), this.options.publicKey);
      const checkedAt = Date.now();
      if (compareVersions(manifest.version, this.options.version) <= 0) { this.set({ status: 'current', latest: manifest.version, checkedAt, notes: manifest.notes }); return this.state; }
      this.set({ latest: manifest.version, notes: manifest.notes, checkedAt });
      await this.download(manifest);
      return this.state;
    } catch (error) {
      this.set({ status: 'error', error: (error as Error).message, checkedAt: Date.now(), progress: undefined });
      throw error;
    }
  }

  private async feed() {
    if (this.options.channel() !== 'beta') return this.options.feed ?? UPDATE_FEED;
    const response = await this.fetch(this.options.releases ?? RELEASES_API, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/vnd.github+json', 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw new Error(`The beta update check failed (HTTP ${response.status}).`);
    return betaFeed(await response.json());
  }

  private async ensureWritable() {
    try { await access(path.dirname(this.options.bundlePath), constants.W_OK); }
    catch { throw new Error(`Harbor can't replace itself in ${path.dirname(this.options.bundlePath)}. Download the update from GitHub instead.`); }
  }

  private async download(manifest: UpdateManifest) {
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
    const zip = path.join(this.dir, manifest.file);
    this.set({ status: 'downloading', progress: 0 });
    const response = await this.fetch(manifest.url, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`The update download failed (HTTP ${response.status}).`);
    const hash = createHash('sha256');
    let received = 0, reported = 0;
    const body = Readable.fromWeb(response.body as any);
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk); received += chunk.length;
      if (received > manifest.size) body.destroy(new Error('The update download is larger than expected.'));
      const progress = Math.floor(received / manifest.size * 100);
      if (progress >= reported + 5) { reported = progress; this.set({ progress }); }
    });
    await pipeline(body, createWriteStream(zip));
    if (received !== manifest.size || hash.digest('hex') !== manifest.sha256) throw new Error('The update download did not match its checksum.');
    const unpacked = path.join(this.dir, `Harbor-${manifest.version}`);
    await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
    await rm(zip, { force: true });
    const app = path.join(unpacked, 'Harbor.app');
    await this.verifyApp(app, manifest.version);
    await writeFile(path.join(this.dir, 'staged.json'), JSON.stringify({ version: manifest.version, app, notes: manifest.notes }));
    this.staged = { version: manifest.version, app };
    this.set({ status: 'ready', progress: undefined });
  }

  private async verifyApp(app: string, version: string) {
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    const plist = path.join(app, 'Contents', 'Info.plist');
    const read = async (key: string) => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
    if (await read('CFBundleIdentifier') !== BUNDLE_ID) throw new Error('The update is not a Harbor build.');
    if (await read('CFBundleShortVersionString') !== version) throw new Error('The update has an unexpected version.');
  }

  /** Picks up an update downloaded in an earlier session. */
  private async restoreStaged() {
    try {
      const saved = JSON.parse(await readFile(path.join(this.dir, 'staged.json'), 'utf8')) as { version: string; app: string; notes?: string };
      if (compareVersions(saved.version, this.options.version) <= 0) { await rm(this.dir, { recursive: true, force: true }); return; }
      await this.verifyApp(saved.app, saved.version);
      this.staged = { version: saved.version, app: saved.app };
      this.set({ status: 'ready', latest: saved.version, notes: saved.notes });
    } catch { /* nothing staged, or a stale/partial download that the next check replaces */ }
  }

  /**
   * Hands the swap to a detached installer that runs after Harbor exits. Returns false when nothing is staged.
   * The caller quits Harbor (relaunch) or is already quitting (install on quit).
   */
  async launchInstaller(relaunch: boolean) {
    if (!this.staged || this.state.status !== 'ready') return false;
    if (!relaunch && !this.installOnQuit) return false;
    const script = path.join(this.dir, 'install.sh');
    await writeFile(script, INSTALLER, { mode: 0o755 });
    // Outside `updates/`, which each new download clears: the last installed version stays available for rollback.
    const previous = path.join(this.options.userData, 'previous-version', path.basename(this.options.bundlePath));
    const log = path.join(this.options.userData, 'update-install.log');
    const out = openSync(log, 'a');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    spawn('/bin/bash', [script, String(process.pid), this.options.bundlePath, this.staged.app, previous, relaunch ? '1' : '0'], { detached: true, stdio: ['ignore', out, out], env }).unref();
    this.staged = undefined;
    this.set({ status: 'installing' });
    return true;
  }
}
