import { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, shell } from 'electron';
import path from 'node:path';
import { HarborEngine } from '../engine/engine';

app.setName('Harbor');
if (process.env.HARBOR_DATA_DIR) app.setPath('userData', process.env.HARBOR_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window: BrowserWindow | undefined;
  let engine: HarborEngine;
  let quitting = false;
  const createWindow = () => {
    window = new BrowserWindow({ width: 1440, height: 920, minWidth: 950, minHeight: 640, title: 'Harbor', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 21 }, backgroundColor: '#101217', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.on('closed', () => { window = undefined; for (const session of engine.snapshot().sessions) engine.detach(session.id); });
    if (!app.isPackaged && process.env.HARBOR_DEV_URL === 'http://127.0.0.1:5173') void window.loadURL(process.env.HARBOR_DEV_URL);
    else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  };
  app.on('second-instance', () => { if (window) { window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    engine = new HarborEngine(app.getPath('userData'));
    await engine.init();
    function handle(channel: string, fn: (...args: any[]) => unknown) {
      ipcMain.handle(`harbor:${channel}`, (event, ...args) => {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender.');
        return fn(...args);
      });
    }
    handle('snapshot', () => engine.snapshot());
    handle('create', input => engine.create(input));
    handle('update', (id, patch) => engine.update(id, patch));
    handle('attach', (id, cols, rows) => engine.attach(id, cols, rows));
    handle('detach', id => engine.detach(id));
    handle('input', (id, data) => engine.input(id, data));
    handle('paste', (id, data) => engine.paste(id, data));
    handle('resize', (id, cols, rows) => engine.resize(id, cols, rows));
    handle('diagnose', host => engine.diagnose(host));
    handle('refresh', () => engine.refresh());
    handle('terminate', async id => {
      const session = engine.snapshot().sessions.find(s => s.id === id);
      if (!session) throw new Error('Session not found.');
      const choice = await dialog.showMessageBox(window!, { type: 'warning', message: `Terminate “${session.name}”?`, detail: `This stops the shell and any agent running in this session on ${session.host}. This cannot be undone. Use Archive to hide a session and keep it running.`, buttons: ['Cancel', 'Terminate session'], defaultId: 0, cancelId: 0 });
      if (choice.response !== 1) return false;
      await engine.terminate(id); return true;
    });
    handle('forget', async id => {
      const choice = await dialog.showMessageBox(window!, { type: 'question', message: 'Remove this session from Harbor?', detail: 'Its tmux session, if still running, will be left untouched. You can still attach with tmux from a terminal.', buttons: ['Cancel', 'Remove from Harbor'], defaultId: 0, cancelId: 0 });
      if (choice.response !== 1) return false;
      await engine.forget(id); return true;
    });
    handle('chooseFolder', async () => (await dialog.showOpenDialog(window!, { properties: ['openDirectory', 'createDirectory'] })).filePaths[0] ?? null);
    handle('openDataDir', () => shell.openPath(app.getPath('userData')));
    handle('openExternal', (url: string) => { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only web links can be opened.'); return shell.openExternal(parsed.toString()); });
    engine.on('snapshot', snapshot => window?.webContents.send('harbor:snapshot-changed', snapshot));
    engine.on('terminal', event => window?.webContents.send('harbor:terminal', event));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Harbor', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Session', submenu: [{ label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => window?.webContents.send('harbor:new-session') }, { label: 'Refresh Hosts and Status', accelerator: 'CmdOrCtrl+R', click: () => void engine.refresh() }] },
      { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : [])] }, { role: 'windowMenu' }
    ]));
    createWindow();
    powerMonitor.on('resume', () => { void engine.refresh(); window?.webContents.send('harbor:wake'); });
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Harbor could not start', String(error)); app.exit(1); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (quitting || !engine) return;
    event.preventDefault(); quitting = true;
    engine.dispose().finally(() => app.quit());
  });
}
