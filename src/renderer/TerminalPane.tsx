import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { RefreshCw, TerminalSquare, X } from 'lucide-react';
import type { Preferences, Session } from '../shared/types';
import '@xterm/xterm/css/xterm.css';

export function TerminalPane({ session, onClose, report, preferences, reconnectKey = 0, showHeader = false }: { session: Session; onClose?: () => void; report: (message: string) => void; preferences: Preferences['terminal']; reconnectKey?: number; showHeader?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const reconnect = useRef<() => void>(() => {});
  const [state, setState] = useState('Connecting');
  const [error, setError] = useState('');
  const reportRef = useRef(report); reportRef.current = report;
  const status = useRef(session.status); status.current = session.status;
  useEffect(() => {
    const terminal = new Terminal({ cursorBlink: preferences.cursorBlink, cursorStyle: 'bar', fontFamily: preferences.fontFamily, fontSize: preferences.fontSize, lineHeight: 1.2, scrollback: 10000, allowProposedApi: false, theme: { background: '#101217', foreground: '#dce1eb', cursor: '#8ce0bf', selectionBackground: '#334a49', black: '#232731', red: '#f18989', green: '#9bd9ac', yellow: '#e4ca88', blue: '#91b5ed', magenta: '#c4a8e2', cyan: '#88d5d7', white: '#e3e7ef', brightBlack: '#697487', brightRed: '#ffacac', brightGreen: '#b7f0c5', brightYellow: '#f6dca0', brightBlue: '#b7d1fa', brightMagenta: '#e2c6fb', brightCyan: '#a6edf0', brightWhite: '#ffffff' } });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminalRef.current = terminal; fitRef.current = fit;
    terminal.loadAddon(new WebLinksAddon((_event, uri) => { void window.harbor.openExternal(uri).catch(error => reportRef.current(error.message)); }));
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
        connected = true; attempts = 0; setState('Connected'); terminal.focus();
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
    terminal.attachCustomKeyEventHandler(event => {
      if (document.querySelector('[aria-modal="true"]')) return false;
      if ((event.metaKey || event.ctrlKey) && ['n', 'k', 'f'].includes(event.key.toLowerCase())) return false;
      if (event.metaKey && ['b', 'c', 'v', 'a'].includes(event.key.toLowerCase())) return false;
      return true;
    });
    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!disposed) { fit.fit(); if (connected) void window.harbor.resize(session.id, terminal.cols, terminal.rows).catch(() => {}); } }, 80); });
    observer.observe(element.current!);
    const online = () => { if (!connected) void connect(); };
    window.addEventListener('online', online);
    void connect();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(resizeTimer); observer.disconnect(); unsubscribe(); input.dispose(); surface.removeEventListener('paste', paste, true); window.removeEventListener('online', online); void window.harbor.detach(session.id); terminal.dispose(); terminalRef.current = null; fitRef.current = null; };
  }, [session.id, reconnectKey]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = preferences.fontSize;
    terminal.options.fontFamily = preferences.fontFamily;
    terminal.options.cursorBlink = preferences.cursorBlink;
    fitRef.current?.fit();
    void window.harbor.resize(session.id, terminal.cols, terminal.rows).catch(() => {});
  }, [preferences.fontSize, preferences.fontFamily, preferences.cursorBlink, session.id]);
  return <section className="terminal-pane" aria-label={`Terminal: ${session.name}`}>
    {showHeader ? <div className="terminal-bar"><span className={`status-dot ${state === 'Connected' ? session.status : 'checking'}`} /><TerminalSquare size={14} /><strong>{session.name}</strong><span className="terminal-host">{session.host === 'local' ? 'This Mac' : session.host}</span><div className="spacer" /><span className="connection-label">{state}</span><button className="icon-button" aria-label={`Reconnect ${session.name}`} title="Reconnect terminal" onClick={() => reconnect.current()}><RefreshCw size={14} /></button>{onClose && <button className="icon-button" aria-label="Close split" onClick={onClose}><X size={15} /></button>}</div> : <span className="sr-only connection-label">{state}</span>}
    {error && <div className="connection-error"><span>{error}</span><button onClick={() => reconnect.current()}>Reconnect</button></div>}
    <div className="terminal-surface" ref={element} />
  </section>;
}
