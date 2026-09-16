import type { Session } from './types';

const quote = (value: string) => /^[a-zA-Z0-9_.:@/=-]+$/.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
export function attachCommand(session: Session) {
  const args = ['tmux', '-L', 'harbor', 'attach', '-t', session.tmuxName];
  if (session.host === 'local') return args.map(quote).join(' ');
  const connection = session.connection ?? { target: session.host };
  const ssh = ['ssh', '-t', ...(connection.hostname ? ['-o', `Hostname=${connection.hostname}`] : []), ...(connection.user ? ['-l', connection.user] : []), ...(connection.port ? ['-p', String(connection.port)] : []), ...(connection.identityFile ? ['-i', connection.identityFile] : []), connection.user ? connection.target.replace(/^[^@]+@/, '') : connection.target];
  return [...ssh, ...args].map(quote).join(' ');
}
