import { ChatPreviewPanel } from './ChatPreviewPanel';
import { TerminalSearch } from './TerminalSearch';
import { groupShortcut, tabShortcut } from '../shared/shortcuts';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { RefreshCw, TerminalSquare, X } from 'lucide-react';
import type { Preferences, Session } from '../shared/types';
import '@xterm/xterm/css/xterm.css';
import { terminalColors } from '../shared/terminalTheme';

export function TerminalPane({ session, onClose, onReconnect, report, preferences, reconnectKey = 0, showHeader = false, active = true }: { session: Session; onClose?: () => void; onReconnect?: () => void; report: (message: string) => void; preferences: Preferences['terminal']; reconnectKey?: number; showHeader?: boolean; active?: boolean }) {
  const activeRef=useRef(active);activeRef.current=active;
  useEffect(()=>{if(active)terminalRef.current?.focus();},[active]);
  const element = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const reconnect = useRef<() => void>(() => {});
  const [state, setState] = useState('Connecting');
  const [error, setError] = useState('');
  const [fileHover, setFileHover] = useState(false);
  const [dropping, setDropping] = useState(false);
  const reportRef = useRef(report); reportRef.current = report;
  const status = useRef(session.status); status.current = session.status;
  useEffect(() => {
    // OSC 8 links bypass WebLinksAddon; route both kinds through validated IPC.
    const linkHandler = {
      activate: (_event: MouseEvent, uri: string) => { void window.harbor.openExternal(uri).catch(error => reportRef.current(error.message)); },
      hover: (_event: MouseEvent, uri: string) => { if (element.current) element.current.title = uri; },
      leave: () => { element.current?.removeAttribute('title'); },
    };
    const terminal = new Terminal({ linkHandler, cursorBlink: preferences.cursorBlink, cursorStyle: 'bar', fontFamily: preferences.fontFamily, fontSize: preferences.fontSize, lineHeight: 1.2, scrollback: 10000, allowProposedApi: false, theme: { ...terminalColors, cursor: '#8ce0bf', selectionBackground: '#334a49', black: '#232731', red: '#f18989', green: '#9bd9ac', yellow: '#e4ca88', blue: '#91b5ed', magenta: '#c4a8e2', cyan: '#88d5d7', white: '#e3e7ef', brightBlack: '#697487', brightRed: '#ffacac', brightGreen: '#b7f0c5', brightYellow: '#f6dca0', brightBlue: '#b7d1fa', brightMagenta: '#e2c6fb', brightCyan: '#a6edf0', brightWhite: '#ffffff' } });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminalRef.current = terminal; fitRef.current = fit;
    terminal.loadAddon(new WebLinksAddon(linkHandler.activate, linkHandler));
    terminal.open(element.current!); fit.fit();
    let disposed = false; let connected = false; let connecting = false; let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => {
      if (disposed || status.current === 'missing') return;
      clearTimeout(timer);
      timer = setTimeout(() => { void connect(); }, Math.min(30000, 1500 * 2 ** Math.min(attempts++, 5)));
    };
    const connect = async () => {
      if (disposed || connecting) return;
      clearTimeout(timer); connecting = true; connected = false;
      setState('Connecting'); setError(''); terminal.reset(); fit.fit();
      try {
        await window.harbor.attach(session.id, terminal.cols, terminal.rows);
        if (disposed) return;
        connected = true; attempts = 0; setState('Connected'); if(activeRef.current)terminal.focus();
      } catch (err) {
        if (!disposed) { setState('Disconnected'); setError((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); retry(); }
      } finally { connecting = false; }
    };
    reconnect.current = () => { void connect(); };
    const unsubscribe = window.harbor.onTerminal(event => {
      if (event.id !== session.id || disposed) return;
      if (event.type === 'data') terminal.write(Uint8Array.from(atob(event.data), char => char.charCodeAt(0)));
      else { connected = false; setState('Disconnected'); setError(event.data); retry(); }
    });
    let inputQueue = Promise.resolve();
    const input = terminal.onData(data => {
      if (!connected) return;
      inputQueue = inputQueue.then(() => window.harbor.input(session.id, data)).catch(err => reportRef.current(err.message));
    });
    const paste = (event: ClipboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      const text = event.clipboardData?.getData('text/plain');
      if (text && connected) inputQueue = inputQueue.then(() => window.harbor.paste(session.id, text)).catch(err => reportRef.current(err.message));
    };
    const surface = element.current!; surface.addEventListener('paste', paste, true);
    const dragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = connected ? 'copy' : 'none';
      setFileHover(connected);
    };
    const dragLeave = (event: DragEvent) => { if (!surface.contains(event.relatedTarget as Node | null)) setFileHover(false); };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation(); setFileHover(false);
      if (!connected) { reportRef.current('Reconnect the terminal before dropping files.'); return; }
      const files = Array.from(event.dataTransfer.files);
      // Queue synchronously so subsequent typing cannot overtake the upload/paste.
      inputQueue = inputQueue.then(async () => {
        if (disposed) return;
        setDropping(true);
        try { await window.harbor.dropFiles(session.id, files); }
        finally { if (!disposed) { setDropping(false); terminal.focus(); } }
      }).catch(err => reportRef.current(err.message));
    };
    surface.addEventListener('dragover', dragOver);
    surface.addEventListener('dragleave', dragLeave);
    surface.addEventListener('drop', drop);
    terminal.attachCustomKeyEventHandler(event => {
      if (document.querySelector('[aria-modal="true"]')) return false;
      // Agents read modified Enter as CSI u (Shift = newline, Ctrl = distinct Ctrl+Enter); xterm would send a bare CR.
      if (event.key==='Enter' && event.shiftKey!==event.ctrlKey && !event.metaKey && !event.altKey && (session.launcher==='codex'||session.launcher==='claude')) {
        event.preventDefault();
        if(event.type==='keydown' && connected) inputQueue=inputQueue.then(()=>window.harbor.input(session.id,event.ctrlKey?'\x1b[13;5u':'\x1b[13;2u')).catch(err=>reportRef.current(err.message));
        return false;
      }
      if (tabShortcut(event)!==undefined || groupShortcut(event)!==undefined) return false;
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        if (event.type === 'keydown' && connected) inputQueue = inputQueue.then(() => window.harbor.input(session.id, event.key === 'ArrowLeft' ? '\x01' : '\x05')).catch(err => reportRef.current(err.message));
        return false;
      }
      if (event.metaKey && event.key === 'Backspace') {
        if (event.type === 'keydown' && connected) inputQueue = inputQueue.then(() => window.harbor.input(session.id, '\u0015')).catch(err => reportRef.current(err.message));
        event.preventDefault(); return false;
      }
      // macOS app shortcuts use Command; Control belongs to the terminal (e.g. Codex Ctrl+T).
      if (event.metaKey && ['n', 'k', 'f', 'w', 't', 'r'].includes(event.key.toLowerCase())) return false;
      if (event.metaKey && ['b', 'c', 'v', 'a'].includes(event.key.toLowerCase())) return false;
      return true;
    });
    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!disposed && element.current?.isConnected && element.current.clientWidth && element.current.clientHeight) { const line=terminal.buffer.active.viewportY; const following=line===terminal.buffer.active.baseY; fit.fit(); if(!following)terminal.scrollToLine(line); if (connected) void window.harbor.resize(session.id, terminal.cols, terminal.rows).catch(() => {}); } }, 80); });
    observer.observe(element.current!);
    const online = () => { if (!connected) void connect(); };
    window.addEventListener('online', online);
    void connect();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(resizeTimer); observer.disconnect(); unsubscribe(); input.dispose(); surface.removeEventListener('paste', paste, true); surface.removeEventListener('dragover', dragOver); surface.removeEventListener('dragleave', dragLeave); surface.removeEventListener('drop', drop); window.removeEventListener('online', online); void window.harbor.detach(session.id); terminal.dispose(); terminalRef.current = null; fitRef.current = null; };
  }, [session.id, session.generation, reconnectKey]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !element.current?.isConnected || !element.current.clientWidth) return;
    terminal.options.fontSize = preferences.fontSize;
    terminal.options.fontFamily = preferences.fontFamily;
    terminal.options.cursorBlink = preferences.cursorBlink;
    fitRef.current?.fit();
    void window.harbor.resize(session.id, terminal.cols, terminal.rows).catch(() => {});
  }, [preferences.fontSize, preferences.fontFamily, preferences.cursorBlink, session.id]);
  return <section className={`terminal-pane ${fileHover ? 'file-drop-hover' : ''}`} aria-label={`Terminal: ${session.name}`}>
    {(fileHover || dropping) && <div className="file-drop-indicator" role="status">{dropping ? (session.host === 'local' ? 'Inserting paths…' : 'Copying to host…') : 'Drop files or folders to insert their paths'}</div>}
    {showHeader ? <div className="terminal-bar"><span className={`status-dot ${state === 'Connected' ? session.status : 'checking'}`} /><TerminalSquare size={14} /><strong>{session.name}</strong><span className="terminal-host">{session.host === 'local' ? 'This Mac' : session.host}</span><div className="spacer" /><span className="connection-label">{state}</span><button className="icon-button" aria-label={`Reconnect ${session.name}`} title="Reconnect terminal" onClick={() => onReconnect ? onReconnect() : reconnect.current()}><RefreshCw size={14} /></button>{onClose && <button className="icon-button" aria-label="Close split" onClick={onClose}><X size={15} /></button>}</div> : <span className="sr-only connection-label">{state}</span>}
    {error && <div className="connection-error"><span>{error}</span><button onClick={() => onReconnect ? onReconnect() : reconnect.current()}>Reconnect</button></div>}
    {error&&<div className="disconnected-preview"><ChatPreviewPanel session={session} version={reconnectKey}/></div>}
    <TerminalSearch terminal={terminalRef} surface={element} />
    <div className="terminal-surface" ref={element} />
  </section>;
}
