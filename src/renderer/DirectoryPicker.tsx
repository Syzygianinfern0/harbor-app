import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, ChevronRight, Eye, Folder, FolderOpen, Home, LoaderCircle, RefreshCw, Server } from 'lucide-react';
import type { DirectoryListing } from '../shared/types';

const asFolder = (path: string) => path.endsWith('/') ? path : path + '/';

export function DirectoryPicker({host, hostLabel, local, value, onChange, disabled}: {
  host: string; hostLabel: string; local: boolean; value: string; onChange: (path: string) => void; disabled: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<{key: string; data?: DirectoryListing; error?: string} | null>(null);
  const key = JSON.stringify([host, value, hidden, retry]);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  const loading = open && !current;
  const entries = data?.entries ?? [];

  useEffect(() => {
    if (!open || disabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      window.harbor.listDirectories(host, value, hidden).then(data => {
        if (cancelled) return;
        setResult({key, data});
        setActive(data.query && data.entries.length ? 0 : -1);
      }).catch(error => {
        if (!cancelled) setResult({key, error: (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')});
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [host, value, hidden, retry, open, disabled, key]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'});
  }, [active]);

  const browse = (path: string) => {
    onChange(asFolder(path));
    setActive(-1);
    setOpen(true);
    input.current?.focus();
  };
  const accept = () => {
    if (!data) return;
    onChange(data.directory);
    input.current?.focus();
    setOpen(false);
  };

  return <div className="directory-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation();
      input.current?.focus(); setOpen(false);
    }
  }}>
    <label htmlFor={id}>Project directory</label>
    <div className="input-action directory-input">
      <FolderOpen size={16} aria-hidden="true"/>
      <input ref={input} id={id} required value={value} disabled={disabled} role="combobox"
        aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && entries[active] ? `${id}-option-${active}` : undefined}
        aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false}
        placeholder="Type a path or browse folders…" onFocus={() => setOpen(true)}
        onChange={event => {onChange(event.target.value); setActive(-1); setOpen(true);}}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.altKey && event.key === 'ArrowUp' && data?.parent) {event.preventDefault(); browse(data.parent);}
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            if (entries.length) setActive(index => event.key === 'ArrowDown' ? (index + 1) % entries.length : (index <= 0 ? entries.length - 1 : index - 1));
          } else if (open && ((event.key === 'Tab' && !event.shiftKey && !!entries[active]) || event.key === 'Enter')) {
            event.preventDefault();
            if (entries[active]) browse(entries[active].path);
            else if (data && !data.query) accept();
          }
        }}/>
      <button type="button" disabled={disabled} aria-label={open ? 'Hide folder suggestions' : 'Browse folders'}
        onMouseDown={event => event.preventDefault()} onClick={() => {if (open) setOpen(false); else {input.current?.focus(); setOpen(true);}}}>
        {loading ? <LoaderCircle size={16} className="spin"/> : <ChevronDown size={16}/>}
      </button>
    </div>
    {open && !disabled && <div className="directory-dropdown">
      <div className="directory-toolbar">
        <span title={hostLabel}>{local ? <Folder size={13}/> : <Server size={13}/>} {hostLabel}</span>
        <button type="button" title="Home folder" aria-label="Home folder" onClick={() => browse('~')}><Home size={15}/></button>
        <button type="button" title="Parent folder (Alt+↑)" aria-label="Parent folder" disabled={!data?.parent} onClick={() => data?.parent && browse(data.parent)}><ArrowUp size={15}/></button>
        <button type="button" title="Show hidden folders" aria-label="Show hidden folders" aria-pressed={hidden} onClick={() => setHidden(!hidden)}><Eye size={15}/></button>
        {local && <button type="button" title="Open macOS folder dialog" aria-label="Choose project folder" onClick={async () => {
          try {const folder = await window.harbor.chooseFolder(); if (folder) browse(folder);}
          catch (error) {setResult({key, error: (error as Error).message});}
        }}><FolderOpen size={15}/></button>}
      </div>
      {data && <div className="directory-location" title={data.directory}>{data.directory}</div>}
      <div ref={list} id={`${id}-list`} className="directory-options" role="listbox" aria-label={`Folders on ${hostLabel}`} aria-busy={loading}>
        {entries.map((entry, index) => <div id={`${id}-option-${index}`} key={entry.path} role="option" aria-selected={active === index}
          className={`directory-option${active === index ? ' active' : ''}`} title={entry.path}
          onMouseDown={event => event.preventDefault()} onClick={() => browse(entry.path)}>
          <Folder size={15}/><span>{entry.name}</span><ChevronRight size={14}/>
        </div>)}
      </div>
      <div role="status" aria-live="polite">
        {loading && <p className="directory-message">{local ? 'Loading folders…' : `Loading folders on ${hostLabel}…`}</p>}
        {current?.error && <div className="directory-error"><p>{current.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={13}/> Retry</button></div>}
        {data && !entries.length && <p className="directory-message">{data.query ? 'No matching folders. Try another name.' : 'No subfolders in this folder.'}</p>}
        {data?.truncated && <p className="directory-message">Showing 200 folders. Keep typing to narrow the list.</p>}
      </div>
      {data && <button type="button" className="directory-select" onClick={accept}><Check size={14}/>Use this folder <span title={data.directory}>{data.directory.split('/').filter(Boolean).pop() || '/'}</span></button>}
    </div>}
    <small id={`${id}-hint`} className="directory-hint">{open ? '↑ ↓ to navigate · Tab / Enter to open · Esc to dismiss' : 'Type to find folders, or click to browse.'}</small>
  </div>;
}
