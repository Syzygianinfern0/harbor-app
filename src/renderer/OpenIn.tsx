import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Code2, ExternalLink, FolderOpen, SquareTerminal } from 'lucide-react';
import type { Connection, Session } from '../shared/types';
import { appLabel, defaultApp, menuApps, type OpenAppId, type OpenInPreferences } from '../shared/openIn';

let installed: Promise<OpenAppId[]> | undefined;
/** Installed apps, detected once per window (Settings → Open in… re-detects). */
export function useInstalledApps(refresh = false) {
  const [apps, setApps] = useState<OpenAppId[]>([]);
  useEffect(() => {
    let active = true;
    if (refresh || !installed) installed = window.harbor.openInApps().catch(() => { installed = undefined; return []; });
    void installed.then(value => { if (active) setApps(value); });
    return () => { active = false; };
  }, [refresh]);
  return apps;
}
export const sessionConnection = (session: Session): Connection => session.connection ?? session.host;
export function AppIcon({ app, size = 14 }: { app: OpenAppId; size?: number }) {
  if (app === 'finder') return <FolderOpen size={size} />;
  if (app === 'terminal') return <SquareTerminal size={size} />;
  if (app === 'iterm') return <SquareTerminal size={size} />;
  if (app === 'custom') return <ExternalLink size={size} />;
  return <Code2 size={size} />;
}
type Target = { kind: 'project' | 'chat'; id: string };
const open = (target: Target, app: OpenAppId | undefined, report: (message: string) => void) =>
  void window.harbor.openIn(target, app).catch((error: Error) => report(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')));

/** Menu items: "Open in <default>", then the other apps behind a disclosure so menus stay short. */
export function OpenInItems({ target, connection, preferences, onDone, report }: { target: Target; connection: Connection; preferences: OpenInPreferences; onDone: () => void; report: (message: string) => void }) {
  const apps = useInstalledApps();
  const [more, setMore] = useState(false);
  const shown = menuApps(preferences, apps, connection), first = defaultApp(preferences, apps, connection);
  if (!first) return null;
  const others = shown.filter(app => app !== first);
  const item = (app: OpenAppId) => <button key={app} role="menuitem" onClick={() => { onDone(); open(target, app, report); }}><AppIcon app={app} />Open in {appLabel(app, preferences)}{app === first && target.kind === 'chat' && <kbd>⌘⇧O</kbd>}</button>;
  return <>{item(first)}{others.length > 0 && <button role="menuitem" aria-expanded={more} className="open-in-more" onClick={event => { event.stopPropagation(); setMore(value => !value); }}>{more ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Open in…</button>}{more && <div className="open-in-others">{others.map(item)}</div>}</>;
}

/** One-click toolbar button: opens the chat's folder in the default app. */
export function OpenInButton({ session, preferences, report }: { session: Session; preferences: OpenInPreferences; report: (message: string) => void }) {
  const apps = useInstalledApps();
  const app = defaultApp(preferences, apps, sessionConnection(session));
  if (!app) return null;
  const label = `Open folder in ${appLabel(app, preferences)}`;
  return <button className="icon-button open-in-button" aria-label={label} title={`${label} (⌘⇧O)\nChoose apps in Settings → Open in…`} onClick={() => open({ kind: 'chat', id: session.id }, undefined, report)}><AppIcon app={app} size={16} /></button>;
}
/** ⌘⇧O: the same as the toolbar button, for the focused chat. */
export const openChatFolder = (session: Session, report: (message: string) => void) => open({ kind: 'chat', id: session.id }, undefined, report);
