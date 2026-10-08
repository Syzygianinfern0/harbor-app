import { useEffect, useState } from 'react';
import { Check, ChevronRight, Download, HardDrive, LoaderCircle, Plus, Search, Server, Trash2 } from 'lucide-react';
import type { Host, SavedHost } from '../shared/types';
import { PageHeading, SettingRow, SettingsGroup, cleanError } from './SettingsParts';

export const newHost = (): SavedHost => ({ id: crypto.randomUUID(), label: 'New remote', source: 'manual', enabled: true, defaultDirectory: '~', connection: { target: '' } });
const sourceLabel = (host: SavedHost) => host.source === 'ssh-config' ? 'imported from SSH config' : host.source === 'local' ? 'this Mac' : 'added manually';
/** Everything but the launcher switch, which saves on its own. */
const edits = (host?: SavedHost) => host && JSON.stringify({ ...host, enabled: undefined });

/** Settings → Remotes: import or add machines, and a row per machine that opens its page. */
export function RemotesOverview({ hosts, saved, onOpen, onAdd, onImport, error }: { hosts: SavedHost[]; saved: boolean; onOpen: (id: string) => void; onAdd: () => void; onImport: (hosts: SavedHost[]) => Promise<boolean>; error: string }) {
  const [candidates, setCandidates] = useState<Host[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const discover = async () => { setBusy(true); setFailure(''); try { setCandidates(await window.harbor.sshCandidates()); setPicked([]); setQuery(''); } catch (err) { setFailure(cleanError(err)); } finally { setBusy(false); } };
  const importPicked = async () => {
    setBusy(true); setFailure('');
    try {
      const imported: SavedHost[] = await Promise.all(picked.map(async alias => ({ id: crypto.randomUUID(), label: alias, source: 'ssh-config' as const, enabled: true, defaultDirectory: '~', connection: await window.harbor.resolveSsh(alias) })));
      if (await onImport(imported)) setCandidates(null);
    } catch (err) { setFailure(cleanError(err)); } finally { setBusy(false); }
  };
  const isAdded = (host: Host) => hosts.some(saved => saved.connection?.target === host.id);
  const shown = (candidates ?? []).filter(host => host.label.toLowerCase().includes(query.trim().toLowerCase()));
  const selectable = shown.filter(host => !isAdded(host)).map(host => host.id);
  const allPicked = selectable.length > 0 && selectable.every(id => picked.includes(id));
  return <>
    <PageHeading title="Remotes" description="Machines available when you start a chat. Harbor uses your SSH config, including jump hosts and keys, and never edits it." saved={saved}/>
    <div className="settings-actions"><button className="secondary-button" data-setting="import" onClick={() => void discover()} disabled={busy}><Download size={14}/>Import from SSH config</button><button className="secondary-button" data-setting="add" onClick={onAdd} disabled={busy}><Plus size={14}/>Add manually</button></div>
    {candidates ? <div className="ssh-import"><div className="import-heading"><h3>Select aliases to import</h3><button className="text-button" onClick={() => setCandidates(null)}>Back to remotes</button></div>
      {candidates.length > 0 && <div className="import-toolbar"><label className="import-search"><Search size={14}/><input aria-label="Search SSH aliases" placeholder="Search aliases…" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <button className="text-button" disabled={busy || !selectable.length} onClick={() => setPicked(values => allPicked ? values.filter(id => !selectable.includes(id)) : [...new Set([...values, ...selectable])])}>{allPicked ? 'Clear' : 'Select all'}</button></div>}
      <div className="import-options" role="group" aria-label="SSH aliases">{shown.map(host => {
        const added = isAdded(host);
        return <label key={host.id} className={`import-option ${added ? 'added' : ''}`} title={host.label}><input type="checkbox" checked={added || picked.includes(host.id)} disabled={added || busy} onChange={event => setPicked(values => event.target.checked ? [...values, host.id] : values.filter(id => id !== host.id))}/><span>{host.label}</span>{added && <small>Added</small>}</label>;
      })}{!candidates.length ? <p>No literal Host aliases were found in ~/.ssh/config. You can add a remote manually.</p> : !shown.length && <p>No aliases match “{query}”.</p>}</div>
      <div className="import-footer"><small>Only selected aliases are imported. Your SSH config is never edited.</small><button className="primary-button" disabled={!picked.length || busy} onClick={() => void importPicked()}>{busy ? <LoaderCircle className="spin" size={14}/> : <Download size={14}/>}Import selected ({picked.length})</button></div>
    </div> : <SettingsGroup title={`${hosts.length} ${hosts.length === 1 ? 'machine' : 'machines'}`}>{hosts.map(host => <button key={host.id} className="settings-row settings-link" onClick={() => onOpen(host.id)}>
      {host.id === 'local' ? <HardDrive size={16}/> : <Server size={16}/>}<span className="settings-row-text"><strong>{host.label}</strong><small>{host.id === 'local' ? 'Local machine' : host.connection?.target || 'Not configured yet'}{host.enabled ? '' : ' · hidden from the launcher'}</small></span><ChevronRight size={15}/>
    </button>)}</SettingsGroup>}
    {(failure || error) && <div className="form-error" role="alert">{failure || error}</div>}
    <p className="preferences-note">Changes apply to new chats. Hiding or removing a remote keeps its existing chats and their connection settings.</p>
  </>;
}

/** One machine's page. Test connection comes first. The launcher switch saves right away; name, folder and connection fields wait for Save,
 *  so a half-typed SSH target is never used. */
export function HostSettings({ host, saved, hosts, savedTick, onDraft, onDiscard, saveHosts, onSaved, onRemoved, error }: {
  host: SavedHost; saved?: SavedHost; hosts: () => SavedHost[]; savedTick: boolean; error: string;
  onDraft: (host: SavedHost) => void; onDiscard: () => void; saveHosts: (hosts: SavedHost[]) => Promise<boolean>; onSaved: () => void; onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ok: boolean; text: string}>();
  const [enabled, setEnabled] = useState(host.enabled);
  const [removing, setRemoving] = useState(false);
  useEffect(() => setEnabled(host.enabled), [host.enabled]);
  const local = host.id === 'local';
  const dirty = !saved || edits(host) !== edits(saved);
  const edit = (patch: Partial<SavedHost>) => { onDraft({ ...host, ...patch, enabled }); setDiagnostic(undefined); };
  const connection = (field: string, value: string | number | undefined) => edit({ connection: { target: '', ...host.connection, [field]: value } });
  const toggle = (value: boolean) => {
    setEnabled(value);
    if (dirty) onDraft({ ...host, enabled: value });
    if (saved) void saveHosts(hosts().map(h => h.id === host.id ? { ...h, enabled: value } : h));
  };
  const save = async () => { setBusy(true); try { const latest = hosts(); if (await saveHosts(saved ? latest.map(h => h.id === host.id ? { ...host, enabled: h.enabled } : h) : [...latest, { ...host, enabled }])) onSaved(); } finally { setBusy(false); } };
  const test = async () => {
    setBusy(true); setDiagnostic(undefined);
    try { const result = await window.harbor.diagnose(host.connection ?? 'local'); setDiagnostic(result.ok ? { ok: true, text: `Connected · ${result.tmux} · Codex ${result.codex ? 'available' : 'not found'} · Claude Code ${result.claude ? 'available' : 'not found'}` } : { ok: false, text: result.error || 'Connection failed.' }); }
    catch (err) { setDiagnostic({ ok: false, text: cleanError(err) }); } finally { setBusy(false); }
  };
  const remove = async () => { setBusy(true); try { if (await saveHosts(hosts().filter(h => h.id !== host.id))) { onSaved(); onRemoved(); } } finally { setBusy(false); } };
  return <form className="host-editor" onSubmit={event => { event.preventDefault(); if (dirty) void save(); }}>
    <PageHeading title={host.label || 'New remote'} saved={savedTick} crumb={<><span>Remotes</span><ChevronRight size={11}/><span>{host.label || 'New remote'}</span></>}/>
    <div className="host-card">
      <div className="host-card-icon">{local ? <HardDrive size={18}/> : <Server size={18}/>}</div>
      <div className="host-card-meta"><strong>{host.label || 'New remote'}</strong><small>{local ? 'Local machine' : host.connection?.target ? `SSH · ${host.connection.target}` : 'Not configured yet'} · {sourceLabel(host)}</small></div>
      <button type="button" className="primary-button" data-setting="test" disabled={busy || (!local && !host.connection?.target)} onClick={() => void test()}><Check size={14}/>Test connection</button>
    </div>
    {diagnostic && <div className={`diagnostic ${diagnostic.ok ? '' : 'error'}`} role="status">{diagnostic.text}</div>}
    <SettingsGroup title="Launcher">
      <SettingRow anchor="enabled" label="Show in launcher" detail="Hidden remotes keep their existing chats."><input type="checkbox" aria-label="Show in launcher" checked={enabled} onChange={event => toggle(event.target.checked)}/></SettingRow>
      <label className="settings-field">Display name<input value={host.label} maxLength={100} onChange={event => edit({ label: event.target.value })}/></label>
      <label className="settings-field" data-setting="directory">Default working directory<input value={host.defaultDirectory} spellCheck={false} onChange={event => edit({ defaultDirectory: event.target.value })}/><small>Where new projects on this machine start browsing.</small></label>
    </SettingsGroup>
    {!local && <SettingsGroup title={<>Connection</>}>
      <label className="settings-field" data-setting="target">SSH alias or address<input aria-label="SSH alias or address" value={host.connection?.target || ''} placeholder="devbox or alice@example.invalid" spellCheck={false} onChange={event => connection('target', event.target.value)}/><small>Uses this target’s SSH config, including jump hosts and authentication.</small></label>
      <div className="settings-field-row" data-setting="hostname">
        <label className="settings-field">Hostname override<input value={host.connection?.hostname || ''} placeholder="Use SSH config" spellCheck={false} onChange={event => connection('hostname', event.target.value || undefined)}/></label>
        <label className="settings-field">Username<input value={host.connection?.user || ''} placeholder="Use SSH config" spellCheck={false} onChange={event => connection('user', event.target.value || undefined)}/></label>
        <label className="settings-field narrow">Port<input type="number" min="1" max="65535" value={host.connection?.port ?? ''} placeholder="22" onChange={event => connection('port', event.target.value ? Number(event.target.value) : undefined)}/></label>
      </div>
      <label className="settings-field" data-setting="identity">Identity file<input value={host.connection?.identityFile || ''} placeholder="Use SSH config / SSH agent" spellCheck={false} onChange={event => connection('identityFile', event.target.value || undefined)}/><small>Path on this Mac, for example ~/.ssh/id_ed25519.</small></label>
    </SettingsGroup>}
    {!local && saved && <SettingsGroup title="Remove">
      <SettingRow label="Remove remote" detail={removing ? `Remove ${saved.label} from Harbor? Its existing chats and their connection settings are kept.` : 'Keeps its existing chats and their connection settings.'}>
        {removing ? <><button type="button" className="secondary-button" onClick={() => setRemoving(false)}>Cancel</button><button type="button" className="secondary-button danger" disabled={busy} onClick={() => void remove()}><Trash2 size={13}/>Remove</button></>
          : <button type="button" className="secondary-button danger" onClick={() => setRemoving(true)}><Trash2 size={13}/>Remove remote</button>}
      </SettingRow>
    </SettingsGroup>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {dirty && <div className="settings-savebar" role="region" aria-label="Unsaved changes"><span>{saved ? `Unsaved changes to ${saved.label}` : 'This remote is not saved yet'}</span><button type="button" className="secondary-button" disabled={busy} onClick={onDiscard}>{saved ? 'Revert' : 'Discard'}</button><button type="submit" className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}Save</button></div>}
  </form>;
}
