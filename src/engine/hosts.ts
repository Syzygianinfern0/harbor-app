import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'glob';
import type { Host } from '../shared/types';

export function configTokens(line: string): string[] {
  const tokens: string[] = []; let token = ''; let quote = ''; let escaped = false;
  for (const char of line) {
    if (escaped) { token += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; else token += char; continue; }
    if (char === '#') break;
    if (char === '"' || char === "'") { quote = char; continue; }
    if (/\s/.test(char) || char === '=') { if (token) { tokens.push(token); token = ''; } }
    else token += char;
  }
  if (token) tokens.push(token);
  return tokens;
}
export async function discoverHosts(config = path.join(homedir(), '.ssh/config'), home = homedir()): Promise<Host[]> {
  const found = new Set<string>(); const visited = new Set<string>();
  const walk = async (filename: string, depth: number) => {
    if (depth > 12 || visited.has(filename)) return;
    visited.add(filename);
    let source: string;
    try { source = await readFile(filename, 'utf8'); } catch { return; }
    for (const line of source.split(/\r?\n/)) {
      const [key, ...values] = configTokens(line);
      if (key?.toLowerCase() === 'host') {
        for (const alias of values) if (/^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$/.test(alias)) found.add(alias);
      }
      if (key?.toLowerCase() === 'include') for (let pattern of values) {
        if (pattern.startsWith('~/')) pattern = path.join(home, pattern.slice(2));
        if (!path.isAbsolute(pattern)) pattern = path.join(home, '.ssh', pattern);
        for (const file of (await glob(pattern, { nodir: true })).sort()) await walk(file, depth + 1);
      }
    }
  };
  await walk(config, 0);
  return [{ id: 'local', label: 'This Mac', source: 'local' }, ...[...found].filter(id => id !== 'local').sort().map(id => ({ id, label: id, source: 'ssh-config' as const }))];
}
