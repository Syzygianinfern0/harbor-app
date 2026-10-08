import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Bell, Bot, ChartColumn, CircleCheck, Download, ExternalLink, Folder, FolderOpen, HardDrive, Info, Keyboard, Plus, Search, Server, SlidersHorizontal, SquareArrowOutUpRight, X } from 'lucide-react';
import type { Preferences, SavedHost, Snapshot } from '../shared/types';
import { categoryLabel, searchSettings, settingsCategories, type SettingsCategory } from '../shared/settingsIndex';
import { shortcutList } from '../shared/shortcuts';
import { agentModes } from '../shared/agentModes';
import { UsagePanel, type UsageState } from './UsagePanel';
import { IconGuide } from './IconGuide';
import { ProjectManager } from './ProjectManager';
import { NotificationPreferences, UpdatePreferences } from './AgentPreferences';
import { HarborUpdatePanel, useAppUpdate } from './AppUpdate';
import { OpenInPreferences } from './OpenInPreferences';
import { HostSettings, RemotesOverview, newHost } from './RemoteSettings';
import { PageHeading, SettingRow, SettingsGroup, cleanError } from './SettingsParts';

export interface SettingsLocation { category: SettingsCategory; host?: string }
const icons: Record<SettingsCategory, typeof Bell> = { general: SlidersHorizontal, agents: Bot, remotes: Server, projects: Folder, notifications: Bell, 'open-in': SquareArrowOutUpRight, usage: ChartColumn, updates: Download, shortcuts: Keyboard, icons: CircleCheck, about: Info };
const REPO = 'https://github.com/Syzygianinfern0/harbor-app';
/** Settings, shown as a tab in the main window. Changes save as you make them, one preference section at a time, merged with the latest saved
 *  preferences so pages never overwrite each other. Remote connection fields wait for an explicit Save (see RemoteSettings). */
export function SettingsView({ snapshot, usage, location, onNavigate, hidden, search }: { snapshot: Snapshot; usage: UsageState; location: SettingsLocation; onNavigate: (location: SettingsLocation) => void; hidden: boolean; search: RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Partial<Preferences>>({});
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState<string>();
  // Remote edits not saved yet, by host ID; hosts added manually stay here until their first save.
  const [hostDrafts, setHostDrafts] = useState<Record<string, SavedHost>>({});
  const [added, setAdded] = useState<string[]>([]);
  const content = useRef<HTMLDivElement>(null);
  const latest = useRef(snapshot.preferences); latest.current = snapshot.preferences;
  const timers = useRef(new Map<keyof Preferences, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<keyof Preferences, unknown>());
  const saved = Date.now() - savedAt < 2000;
  useEffect(() => { if (!savedAt) return; const timer = setTimeout(() => setSavedAt(0), 2000); return () => clearTimeout(timer); }, [savedAt]);
  const done = () => { setSavedAt(Date.now()); setError(''); };
  const run = async (save: () => Promise<void>) => { try { await save(); done(); return true; } catch (failure) { setError(cleanError(failure)); return false; } };
  const flush = (key: keyof Preferences) => {
    clearTimeout(timers.current.get(key)); timers.current.delete(key);
    if (!pending.current.has(key)) return;
    const value = pending.current.get(key); pending.current.delete(key);
    void run(() => window.harbor.updatePreferences({ [key]: value }));
  };
  /** Saves one section after a short pause, so typing in a field writes once. */
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K], delay = 250) => {
    setDrafts(v => ({ ...v, [key]: value })); pending.current.set(key, value);
    clearTimeout(timers.current.get(key)); timers.current.set(key, setTimeout(() => flush(key), delay));
  };
  useEffect(() => () => { for (const key of [...pending.current.keys()]) flush(key); }, []);
  // Drop drafts once the saved preferences have caught up with them.
  const savedKey = JSON.stringify(snapshot.preferences);
  useEffect(() => { setDrafts(v => { const next = Object.fromEntries(Object.entries(v).filter(([key, value]) => pending.current.has(key as keyof Preferences) || JSON.stringify(value) !== JSON.stringify(snapshot.preferences[key as keyof Preferences]))); return Object.keys(next).length === Object.keys(v).length ? v : next; }); }, [savedKey]);
  const prefs: Preferences = { ...snapshot.preferences, ...drafts };

  const hosts = [...snapshot.preferences.hosts, ...added.filter(id => hostDrafts[id] && !snapshot.preferences.hosts.some(h => h.id === id)).map(id => hostDrafts[id])];
  const shownHost = (id: string) => hostDrafts[id] ?? hosts.find(h => h.id === id);
  const results = searchSettings(query, hosts.map(h => { const v = shownHost(h.id)!; return { id: v.id, label: v.label, target: v.connection?.target, local: v.id === 'local' }; }));
  const host = location.category === 'remotes' && location.host ? shownHost(location.host) : undefined;
  const go = (next: SettingsLocation, anchor?: string) => { setQuery(''); setHighlight(anchor); setError(''); onNavigate(next); };
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [location.category, location.host, query !== '']);
  useEffect(() => {
    if (!highlight || hidden) return;
    const target = content.current?.querySelector<HTMLElement>(`[data-setting="${CSS.escape(highlight)}"]`);
    setHighlight(undefined); if (!target) return;
    target.scrollIntoView({ block: 'center' }); target.classList.add('setting-highlight');
    const timer = setTimeout(() => target.classList.remove('setting-highlight'), 1600); return () => clearTimeout(timer);
  }, [highlight, location, hidden]);

  const addHost = () => { const value = newHost(); setHostDrafts(v => ({ ...v, [value.id]: value })); setAdded(v => [...v, value.id]); go({ category: 'remotes', host: value.id }); };
  const forgetDraft = (id: string) => { setHostDrafts(v => { const next = { ...v }; delete next[id]; return next; }); setAdded(v => v.filter(value => value !== id)); };
  const saveHosts = (next: SavedHost[]) => run(() => window.harbor.updatePreferences({ hosts: next }));

  const page = (): ReactNode => {
    const heading = (description?: ReactNode) => <PageHeading title={categoryLabel(location.category)} description={description} saved={saved}/>;
    switch (location.category) {
      case 'general': return <>{heading('How Harbor looks and behaves.')}
        <SettingsGroup title="Sidebar"><SettingRow anchor="expand-on-hover" label="Expand sidebar on hover" detail="When the sidebar is collapsed, hovering its icon rail reveals your chats. ⌘ B collapses or pins it. The terminal keeps its size while you peek."><input type="checkbox" aria-label="Expand sidebar on hover" checked={prefs.sidebar.expandOnHover} onChange={e => change('sidebar', { expandOnHover: e.target.checked })}/></SettingRow></SettingsGroup>
        <SettingsGroup title="Terminal">
          <SettingRow anchor="font-size" label="Font size" detail="Applies to every chat terminal right away."><select aria-label="Terminal font size" value={prefs.terminal.fontSize} onChange={e => change('terminal', { ...prefs.terminal, fontSize: Number(e.target.value) })}>{Array.from({ length: 20 }, (_, i) => i + 9).map(size => <option key={size} value={size}>{size} pt</option>)}</select></SettingRow>
          <SettingRow anchor="font-family" label="Font family" detail="A CSS font list. The first font installed on this Mac is used."><input className="settings-wide-input" aria-label="Terminal font family" value={prefs.terminal.fontFamily} maxLength={300} spellCheck={false} onChange={e => change('terminal', { ...prefs.terminal, fontFamily: e.target.value }, 600)}/></SettingRow>
          <SettingRow anchor="cursor-blink" label="Cursor blink"><input type="checkbox" aria-label="Cursor blink" checked={prefs.terminal.cursorBlink} onChange={e => change('terminal', { ...prefs.terminal, cursorBlink: e.target.checked })}/></SettingRow>
        </SettingsGroup></>;
      case 'agents': return <>{heading('Defaults for new chats. You can override them when creating a chat; resumed chats keep their original choice.')}
        {(['codex', 'claude'] as const).map(agent => { const label = agent === 'codex' ? 'Codex permission mode' : 'Claude Code permission mode'; return <SettingsGroup key={agent} title={agent === 'codex' ? 'Codex' : 'Claude Code'}><SettingRow anchor={agent} label="Permission mode" detail={agentModes[agent].find(mode => mode.value === prefs.agents[agent])?.description}><select aria-label={label} value={prefs.agents[agent]} onChange={e => change('agents', { ...prefs.agents, [agent]: e.target.value })}>{agentModes[agent].map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></SettingRow></SettingsGroup>; })}</>;
      case 'remotes': return host ? <HostSettings key={host.id} host={host} saved={snapshot.preferences.hosts.find(h => h.id === host.id)} hosts={() => latest.current.hosts} savedTick={saved} error={error}
          onDraft={value => setHostDrafts(v => ({ ...v, [value.id]: value }))} saveHosts={saveHosts} onSaved={() => forgetDraft(host.id)}
          onDiscard={() => { forgetDraft(host.id); if (!snapshot.preferences.hosts.some(h => h.id === host.id)) go({ category: 'remotes' }); }} onRemoved={() => go({ category: 'remotes' })}/>
        : <RemotesOverview hosts={hosts.map(h => shownHost(h.id)!)} saved={saved} onOpen={id => go({ category: 'remotes', host: id })} onAdd={addHost}
          onImport={async imported => { const ok = await saveHosts([...latest.current.hosts, ...imported]); if (ok && imported[0]) go({ category: 'remotes', host: imported[0].id }); return ok; }} error={error}/>;
      case 'projects': return <>{heading()}<ProjectSettings snapshot={snapshot} run={run}/></>;
      case 'notifications': return <>{heading()}<NotificationPreferences value={prefs.notifications} onChange={value => change('notifications', value)}/></>;
      case 'open-in': return <>{heading()}<OpenInPreferences value={prefs.openIn} onChange={value => change('openIn', value, 500)}/></>;
      case 'usage': return <>{heading('From saved Codex and Claude Code logs on each machine.')}<div data-setting="usage"><UsagePanel state={usage}/></div></>;
      case 'updates': return <>{heading('Harbor and the agents on your machines.')}<HarborUpdatePanel channel={prefs.updates.channel} onChannel={channel => change('updates', { channel }, 0)}/><UpdatePreferences/></>;
      case 'shortcuts': return <>{heading('Every keyboard shortcut in Harbor. A reference for now; they cannot be changed yet.')}<div data-setting="shortcuts">{shortcutList.map(group => <SettingsGroup key={group.section} title={group.section}>{group.items.map(([action, keys]) => <SettingRow key={action} label={action}><kbd>{keys}</kbd></SettingRow>)}</SettingsGroup>)}</div></>;
      case 'icons': return <>{heading()}<div data-setting="icons"><IconGuide/></div></>;
      case 'about': return <AboutPage snapshot={snapshot} saved={saved} onUpdates={() => go({ category: 'updates' })}/>;
    }
  };

  return <div className="settings-view" hidden={hidden}><div className="settings-shell">
    <nav className="settings-nav" aria-label="Settings categories">
      <div className="settings-search"><Search size={13}/><input ref={search} aria-label="Search settings" placeholder="Search settings" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } if (e.key === 'Enter' && results[0]) go({ category: results[0].entry.category, host: results[0].host?.id }, results[0].entry.anchor); }}/>{query ? <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={12}/></button> : <kbd>⌘ F</kbd>}</div>
      <div className="settings-categories">{settingsCategories.map(c => { const Icon = icons[c.id]; const hits = query ? results.filter(r => r.entry.category === c.id).length : 0; const active = !query && location.category === c.id && !(c.id === 'remotes' && host);
        return <div key={c.id} className="settings-category">{c.separator && <hr/>}
          <button className={`settings-nav-item ${active ? 'active' : ''} ${query && !hits ? 'dimmed' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => go({ category: c.id })}><Icon size={15}/><span>{c.label}</span>{hits > 0 && <span className="settings-hits">{hits}</span>}</button>
          {c.id === 'remotes' && <>{hosts.map(h => { const value = shownHost(h.id)!; const current = !query && location.category === 'remotes' && location.host === h.id; const savedHost = snapshot.preferences.hosts.find(v => v.id === h.id); const dirty = !!hostDrafts[h.id] && (!savedHost || JSON.stringify({ ...hostDrafts[h.id], enabled: 0 }) !== JSON.stringify({ ...savedHost, enabled: 0 }));
            return <button key={h.id} className={`settings-nav-item sub ${current ? 'active' : ''} ${query ? 'dimmed' : ''}`} aria-current={current ? 'page' : undefined} title={dirty ? 'Unsaved changes' : undefined} onClick={() => go({ category: 'remotes', host: h.id })}>{h.id === 'local' ? <HardDrive size={13}/> : <Server size={13}/>}<span>{value.label || 'New remote'}</span>{dirty && <span className="settings-unsaved" aria-label="Unsaved changes"/>}</button>; })}
            <button className={`settings-nav-item sub add ${query ? 'dimmed' : ''}`} onClick={addHost}><Plus size={13}/><span>Add remote</span></button></>}
        </div>; })}</div>
    </nav>
    <div className="settings-content" ref={content}>
      <div className="settings-page" data-category={query ? 'search' : location.category}>
        {query ? <><PageHeading title="Search" description={`${results.length} ${results.length === 1 ? 'setting matches' : 'settings match'} “${query}”`} saved={false}/>
          {results.length ? <div className="settings-rows settings-results">{results.map((r, i) => <button key={i} className="settings-result" onClick={() => go({ category: r.entry.category, host: r.host?.id }, r.entry.anchor)}><small>{categoryLabel(r.entry.category)}{r.host && ` › ${r.host.label}`}</small><strong>{r.entry.label}</strong></button>)}</div>
            : <p className="settings-empty">No settings match. Try “ssh”, “beta” or “sound”.</p>}</>
          : page()}
        {error && !query && location.category !== 'remotes' && <div className="form-error" role="alert">{error}</div>}
      </div>
    </div>
  </div></div>;
}

/** Reorder and show or hide projects as you go; deleting asks first, since nothing can be cancelled any more. */
function ProjectSettings({ snapshot, run }: { snapshot: Snapshot; run: (save: () => Promise<void>) => Promise<boolean> }) {
  const [order, setOrder] = useState<typeof snapshot.projects>();
  const key = JSON.stringify(snapshot.projects.map(p => [p.id, !!p.hidden]));
  useEffect(() => setOrder(undefined), [key]);
  const projects = order ?? snapshot.projects;
  return <div data-setting="projects"><ProjectManager projects={projects} onChange={next => { setOrder(next); void run(() => window.harbor.manageProjects(next.map(p => ({ id: p.id, hidden: !!p.hidden })))).then(ok => { if (!ok) setOrder(undefined); }); }}/></div>;
}

function AboutPage({ snapshot, saved, onUpdates }: { snapshot: Snapshot; saved: boolean; onUpdates: () => void }) {
  const update = useAppUpdate();
  return <>
    <PageHeading title="About" description="Version, and where Harbor keeps its data." saved={saved}/>
    <SettingsGroup>
      <SettingRow anchor="version" label="Version" detail={`Harbor ${update?.current ?? ''} · ${snapshot.preferences.updates.channel === 'beta' ? 'Beta' : 'Stable'} channel`}><button className="secondary-button" onClick={onUpdates}><Download size={13}/>Updates</button></SettingRow>
      <SettingRow anchor="data" label="Data folder" detail={<>Session index and preferences: <code>{snapshot.dataDir}</code>. Chats themselves live in tmux on each machine.</>}><button className="secondary-button" onClick={() => void window.harbor.openDataDir()}><FolderOpen size={13}/>Open data folder</button></SettingRow>
      <SettingRow label="Source and releases" detail="GitHub"><button className="secondary-button" onClick={() => void window.harbor.openExternal(REPO)}><ExternalLink size={13}/>Open</button></SettingRow>
      <SettingRow label="User guide" detail="Every feature, shortcut and setting."><button className="secondary-button" onClick={() => void window.harbor.openExternal(`${REPO}/blob/main/docs/user-guide.md`)}><ExternalLink size={13}/>Open</button></SettingRow>
    </SettingsGroup>
  </>;
}
