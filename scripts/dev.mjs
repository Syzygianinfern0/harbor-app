import { build } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
await build({ entryPoints: ['src/desktop/main.ts', 'src/desktop/preload.ts'], outdir: 'dist/desktop', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true });
const server = await createServer();
await server.listen();
// --sandbox keeps development away from real chats: its own profile under .sandbox/ and its own tmux socket.
// Its usage panels show fake numbers (tests/fixtures/usage-mixed.json), never this Mac's real ~/.codex or ~/.claude usage.
const sandbox = process.argv.includes('--sandbox') ? { HARBOR_DATA_DIR: path.resolve('.sandbox/profile'), HARBOR_TMUX_SOCKET: 'harbor-dev', HARBOR_USAGE_FIXTURE: process.env.HARBOR_USAGE_FIXTURE || path.resolve('tests/fixtures/usage-mixed.json') } : {};
if (sandbox.HARBOR_DATA_DIR) { mkdirSync(sandbox.HARBOR_DATA_DIR, { recursive: true }); console.log(`Sandbox: profile ${sandbox.HARBOR_DATA_DIR}, tmux socket ${sandbox.HARBOR_TMUX_SOCKET}`); }
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, ...sandbox, HARBOR_DEV_URL: 'http://127.0.0.1:5173' } });
child.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', () => child.kill());
