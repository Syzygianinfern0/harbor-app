import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { SearchAddon } from '@xterm/addon-search';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { findShortcut, findStatus } from '../shared/shortcuts';
import { terminalSearchColors } from '../shared/terminalTheme';

const limit = 1000;
/** ⌘F find bar for one terminal pane, searching its scrollback. The addon loads on first use and again whenever the pane recreates its terminal. */
export function TerminalSearch({ terminal, surface }: { terminal: RefObject<Terminal | null>; surface: RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ index: -1, count: 0 });
  const input = useRef<HTMLInputElement>(null);
  const addon = useRef<{ terminal: Terminal; search: SearchAddon } | null>(null);
  const searcher = () => {
    const current = terminal.current; if (!current) return;
    if (addon.current?.terminal !== current) {
      current.options.allowProposedApi = true; // match highlights use registerDecoration, still proposed API in xterm 6
      const search = new SearchAddon({ highlightLimit: limit }); current.loadAddon(search);
      search.onDidChangeResults(({ resultIndex, resultCount }) => { if (addon.current?.search === search) setResult({ index: resultIndex, count: resultCount }); });
      addon.current = { terminal: current, search };
    }
    return addon.current.search;
  };
  // Chats grow at the bottom, so typing and Enter walk upward from the newest match; Shift-Enter walks back down.
  const find = (term: string, older: boolean, incremental = false) => {
    const search = searcher(); if (!search) return;
    if (!term) { search.clearDecorations(); terminal.current?.clearSelection(); setResult({ index: -1, count: 0 }); return; }
    const options = { incremental, decorations: terminalSearchColors };
    if (older) search.findPrevious(term, options); else search.findNext(term, options);
  };
  const show = useRef(() => {});
  show.current = () => {
    setOpen(true); requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    if (query && !open) find(query, true, true);
  };
  const close = () => {
    setOpen(false); setResult({ index: -1, count: 0 });
    if (addon.current && addon.current.terminal === terminal.current) addon.current.search.clearDecorations();
    terminal.current?.focus();
  };
  useEffect(() => {
    // Capture on the surface so ⌘F from xterm's textarea reaches neither xterm nor App's sidebar-search shortcut.
    const element = surface.current; if (!element) return;
    const key = (event: KeyboardEvent) => {
      if (!findShortcut(event) || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); event.stopPropagation(); show.current();
    };
    element.addEventListener('keydown', key, true);
    return () => element.removeEventListener('keydown', key, true);
  }, []);
  const keyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); find(query, !event.shiftKey); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (findShortcut(event)) { event.preventDefault(); event.stopPropagation(); event.currentTarget.select(); }
  };
  if (!open) return null;
  const hold = (event: { preventDefault: () => void }) => event.preventDefault(); // keep focus in the field
  return <div className="terminal-find" role="search">
    <Search size={13} aria-hidden="true" />
    <input ref={input} aria-label="Find in terminal" placeholder="Find" spellCheck={false} autoComplete="off" className={query && !result.count ? 'no-results' : ''} value={query} onChange={event => { setQuery(event.target.value); find(event.target.value, true, true); }} onKeyDown={keyDown} />
    <span className="terminal-find-count" aria-live="polite">{findStatus(query, result.index, result.count, limit)}</span>
    <button className="icon-button" aria-label="Older match" title="Older match (Enter)" disabled={!result.count} onMouseDown={hold} onClick={() => find(query, true)}><ChevronUp size={14} /></button>
    <button className="icon-button" aria-label="Newer match" title="Newer match (Shift-Enter)" disabled={!result.count} onMouseDown={hold} onClick={() => find(query, false)}><ChevronDown size={14} /></button>
    <button className="icon-button" aria-label="Close find" title="Close (Esc)" onMouseDown={hold} onClick={close}><X size={14} /></button>
  </div>;
}
