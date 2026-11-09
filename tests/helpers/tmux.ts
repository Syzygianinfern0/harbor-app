import type { Transport } from '../../src/engine/transport';

/**
 * Chats start with `$SHELL -lic`. An interactive login zsh can fork detached
 * background jobs that escape tmux and outlive the test, so tests that launch
 * real panes use a plain POSIX shell instead. Call before creating an engine.
 */
export function useTestShell(): void {
  process.env.SHELL = '/bin/sh';
}

/** Kills every pane's process group on the test's private socket, then the server. */
export async function killTestServer(transport: Transport, host = 'local'): Promise<void> {
  const panes = transport.tmux(['list-panes', '-a', '-F', '#{pane_pid}']);
  const script = `for pid in $(${panes} 2>/dev/null); do kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null; done; ${transport.tmux(['kill-server'])} 2>/dev/null; true`;
  await transport.run(host, transport.setup() + script).catch(() => {});
}
