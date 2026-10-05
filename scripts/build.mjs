import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
await build({ entryPoints: ['src/desktop/main.ts', 'src/desktop/preload.ts'], outdir: 'dist/desktop', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true,
  // Only CI release builds (HARBOR_RELEASE_BUILD=1) update themselves; builds from source leave the updater off.
  // Pull request previews (HARBOR_PREVIEW_BUILD=1) run as "Harbor Preview" with their own profile and tmux socket.
  define: { 'process.env.HARBOR_RELEASE_BUILD': JSON.stringify(process.env.HARBOR_RELEASE_BUILD === '1' ? '1' : ''), 'process.env.HARBOR_PREVIEW_BUILD': JSON.stringify(process.env.HARBOR_PREVIEW_BUILD === '1' ? '1' : '') } });
await viteBuild();

await mkdir('dist/bridge', { recursive: true });
await copyFile('src/bridge/harbor_bridge.py', 'dist/bridge/harbor_bridge.py');
