import { useEffect, useState } from 'react';
import { ArrowUpCircle, Check, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import type { AppUpdateState } from '../shared/types';

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>();
  useEffect(() => {
    let active = true;
    const off = window.harbor.onAppUpdate(next => { if (active) setState(next); });
    void window.harbor.appUpdate().then(next => { if (active) setState(next); }).catch(() => undefined);
    return () => { active = false; off(); };
  }, []);
  return state;
}

/** Shown above Preferences once an update has been downloaded. */
export function SidebarUpdateButton({ state, collapsed }: { state?: AppUpdateState; collapsed?: boolean }) {
  if (state?.status !== 'ready' && state?.status !== 'installing') return null;
  const label = `Restart to update to Harbor ${state.latest}`;
  return <button className={`sidebar-update ${collapsed ? 'sidebar-update-collapsed' : ''}`} aria-label={label} title={label} disabled={state.status === 'installing'} onClick={() => void window.harbor.installAppUpdate()}>
    {state.status === 'installing' ? <LoaderCircle className="spin" size={collapsed ? 18 : 14}/> : <ArrowUpCircle size={collapsed ? 18 : 14}/>}{!collapsed && <span>{state.status === 'installing' ? 'Restarting…' : 'Restart to update'}</span>}
  </button>;
}

export function HarborUpdatePanel() {
  const state = useAppUpdate();
  const [checking, setChecking] = useState(false);
  if (!state) return null;
  const check = async () => { setChecking(true); try { await window.harbor.checkAppUpdate(); } finally { setChecking(false); } };
  const busy = checking || state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';
  const status = state.status === 'disabled' ? state.reason
    : state.status === 'checking' ? 'Checking for a new version…'
    : state.status === 'downloading' ? `Downloading Harbor ${state.latest}… ${state.progress ?? 0}%`
    : state.status === 'ready' ? `Harbor ${state.latest} is ready. Restart to finish, or it installs the next time you quit Harbor.`
    : state.status === 'installing' ? 'Restarting to install the update…'
    : state.status === 'current' ? 'You have the latest version.'
    : state.status === 'error' ? state.error
    : 'Harbor checks for new versions automatically and downloads them in the background.';
  return <div className="harbor-update">
    <div className="updates-heading"><div><h3>Harbor {state.current}</h3><p className={state.status === 'error' ? 'update-unknown' : state.status === 'ready' ? 'update-available' : ''} aria-live="polite">{status}</p></div>
      <div className="updates-actions">
        {state.notes && state.latest && <button className="text-button" onClick={() => void window.harbor.openExternal(state.notes!)}><ExternalLink size={13}/>What’s new in {state.latest}</button>}
        {state.status === 'ready' ? <button className="primary-button" onClick={() => void window.harbor.installAppUpdate()}><ArrowUpCircle size={14}/>Restart to update</button>
          : state.status !== 'disabled' && <button className="secondary-button" disabled={busy} onClick={() => void check()}>{busy ? <LoaderCircle className="spin" size={14}/> : state.status === 'current' ? <Check size={14}/> : <RefreshCw size={14}/>}Check for Harbor updates</button>}
      </div>
    </div>
    {state.status !== 'disabled' && <p className="preferences-note">Updates come from GitHub releases and are signature-checked before they install. Restarting reopens Harbor; your chats keep running in tmux and reattach.{state.checkedAt ? ` Last checked ${new Date(state.checkedAt).toLocaleString()}.` : ''}</p>}
  </div>;
}
