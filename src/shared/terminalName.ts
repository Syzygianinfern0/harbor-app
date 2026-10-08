import type { Session } from './types';

// Terminals are named "Terminal N" the way VS Code numbers them: N is the lowest number no other open terminal of the
// same project uses. The number is picked once, when the terminal opens, and stored as its name, so a terminal keeps its
// name when another one closes. "New terminal" and "Terminal" are the defaults older versions saved.
const numbered = /^Terminal (\d+)$/;
const legacy = new Set(['New terminal', 'Terminal']);

/** A terminal still on a name Harbor gave it (a rename makes the name the user's). */
export const defaultTerminalName = (session: Pick<Session, 'launcher' | 'name' | 'nameSource'>) =>
  session.launcher === 'shell' && session.nameSource !== 'manual' && (numbered.test(session.name) || legacy.has(session.name));
/** A default name from before numbering, which gets a number the next time the terminal opens. */
export const legacyTerminalName = (session: Pick<Session, 'launcher' | 'name' | 'nameSource'>) => defaultTerminalName(session) && legacy.has(session.name);

/** The lowest number that no other open terminal in the project shows as "Terminal N". */
export function nextTerminalNumber(sessions: readonly Session[], projectId: string | undefined, self?: string) {
  const used = new Set(sessions.filter(s => s.id !== self && s.launcher === 'shell' && s.projectId === projectId && s.status !== 'closed')
    .map(s => Number(numbered.exec(s.name)?.[1])).filter(Boolean));
  let number = 1; while (used.has(number)) number++;
  return number;
}
export const terminalName = (number: number) => `Terminal ${number}`;
/** Whether an open terminal's default name clashes with another open terminal in its project, or predates numbering. */
export const needsTerminalNumber = (sessions: readonly Session[], session: Session) => defaultTerminalName(session) &&
  (legacyTerminalName(session) || sessions.some(s => s.id !== session.id && s.launcher === 'shell' && s.projectId === session.projectId && s.status !== 'closed' && s.name === session.name));

/** The foreground process of a running terminal ("zsh", "python3", "htop"), as tmux's #{pane_current_command} reports it
 * in the status poll (stored in `detail` while the pane runs). Undefined while the terminal is closed, checking or unreachable. */
export function terminalCommand(session: Pick<Session, 'launcher' | 'status' | 'detail'>) {
  if (session.launcher !== 'shell' || session.status !== 'running' || !session.detail) return undefined;
  const command = session.detail.trim().replace(/^-/, '').split('/').pop() ?? '';
  return command && command.length <= 40 && !/\s/.test(command) ? command : undefined;
}
