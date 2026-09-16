import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
await build({ entryPoints: ['src/desktop/main.ts', 'src/desktop/preload.ts'], outdir: 'dist/desktop', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true });
await viteBuild();

await mkdir('dist/bridge', { recursive: true });
await copyFile('src/bridge/harbor_bridge.py', 'dist/bridge/harbor_bridge.py');
