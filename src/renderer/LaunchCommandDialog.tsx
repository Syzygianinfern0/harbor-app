import { useState } from 'react';
import { X } from 'lucide-react';
import type { Session } from '../shared/types';

export function LaunchCommandDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const original = session.originalLaunchCommand;
  const latest = session.latestLaunchCommand;
  const recorded = !session.imported ? session.command : undefined;
  const commands = [
    ...(original ? [{ label: 'Original launch command', command: original }] : []),
    ...(latest && latest !== original ? [{ label: 'Latest launch command', command: latest }] : []),
    ...(!original && !latest && recorded ? [{ label: 'Saved launcher command', command: recorded }] : [])
  ];
  return <div className="modal-backdrop"><section className="modal launch-command-modal" role="dialog" aria-modal="true" aria-label="Launch command">
    <div className="modal-heading"><h2>Launch command</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>
    <p>{session.name}</p><dl><dt>Host</dt><dd>{session.hostLabel || session.host}</dd><dt>Working directory</dt><dd>{session.cwd}</dd></dl>
    {!original && <p className="command-note">{session.imported ? 'The original command is unavailable for chats imported from history.' : 'The full original command was not recorded for this older chat.'}</p>}
    {commands.map(({ label, command }) => <div key={label}><label>{label}<textarea aria-label={label} readOnly rows={5} value={command} spellCheck={false}/></label><button className="secondary-button" onClick={async () => { try { await window.harbor.copyText(command); setMessage('Command copied.'); } catch { setMessage('Could not copy. Select the command and press ⌘C.'); } }}>Copy {label.toLowerCase()}</button></div>)}
    {message && <p role="status">{message}</p>}
  </section></div>;
}
