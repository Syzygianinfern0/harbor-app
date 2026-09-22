import { app, clipboard, BrowserWindow, dialog, ipcMain, Menu, Notification, powerMonitor, shell } from 'electron';
import path from 'node:path';
import { openProjectInCursor } from './cursor';
import { HarborEngine } from '../engine/engine';

app.setName('Harbor');
if (process.env.HARBOR_DATA_DIR) app.setPath('userData', process.env.HARBOR_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window: BrowserWindow | undefined;
  let engine: HarborEngine;
  let quitting = false;
  const activeNotifications=new Set<Notification>();
  let confirmingClose=false;
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
    handle('savePreferences', preferences => engine.savePreferences(preferences));
    handle('sshCandidates', () => engine.sshCandidates());
    handle('resolveSsh', alias => engine.resolveSsh(alias));
    handle('addProject', input => engine.addProject(input));
    handle('listDirectories', (host, input, showHidden) => engine.listDirectories(host, input, showHidden));
    handle('updateProject', (id,name) => engine.updateProject(id,name));
    handle('manageProjects', projects => engine.manageProjects(projects));
    handle('usage', () => engine.usage());
    handle('chatUsage', id => engine.chatUsage(id));
    handle('chatPreview', id => engine.chatPreview(id));
    handle('importHistory', id => engine.importHistory(id));
    handle('resume', (id,restart) => engine.resume(id,restart));
    handle('checkUpdates', force => engine.checkUpdates(force));
    handle('updateAllAgents', () => engine.updateAllAgents());
    handle('openProjectInCursor', async id => openProjectInCursor(await engine.projectForEditor(id)));
    handle('updateAgent', (hostId,agent) => engine.updateAgent(hostId,agent));
    handle('checkReachability', () => engine.checkReachability());
    handle('openNotificationSettings', () => shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension'));
    handle('testNotification', (sound?:boolean) => new Promise<string>(resolve => {
      if (!Notification.isSupported()) {resolve('Desktop notifications are unavailable on this system.');return;}
      const notification=new Notification({title:'Harbor notifications',body:'You’ll hear from Harbor when a chat needs your attention.',silent:!(sound??engine.snapshot().preferences.notifications.sound)});
      activeNotifications.add(notification);
      const finish=(message:string)=>{clearTimeout(timer);resolve(message);};
      const timer=setTimeout(()=>finish('macOS has not confirmed delivery. Check notification permission and Focus settings. For Harbor to appear by name, run the signed Harbor.app build.'),15000);
      notification.once('show',()=>finish('macOS accepted the test notification. If no banner appeared, check Harbor’s notification style and Focus settings.'));
      notification.once('failed',(_event,error)=>{activeNotifications.delete(notification);finish(`Notification failed: ${error}. Run the signed Harbor.app build and enable Harbor in System Settings → Notifications.`);});
      notification.once('close',()=>activeNotifications.delete(notification));
      notification.show();
    }));
    handle('create', input => engine.create(input));
    handle('update', (id, patch) => engine.update(id, patch));
    handle('attach', (id, cols, rows) => engine.attach(id, cols, rows));
    handle('detach', id => engine.detach(id));
    handle('input', (id, data) => engine.input(id, data));
    handle('paste', (id, data) => engine.paste(id, data));
    handle('dropFiles', (id, paths) => engine.dropFiles(id, paths));
    handle('copyText', (text: string) => { if (typeof text !== 'string' || text.length > 128000) throw new Error('Invalid clipboard text.'); clipboard.writeText(text); });
    handle('resize', (id, cols, rows) => engine.resize(id, cols, rows));
    handle('diagnose', host => engine.diagnose(host));
    handle('refresh', () => engine.refresh());
    handle('terminate', async id => {
      if(confirmingClose)return false;
      const session=engine.snapshot().sessions.find(s=>s.id===id);
      if(!session)throw new Error('Chat not found.');
      if(!['closed','exited','missing'].includes(session.status)) {
        confirmingClose=true;
        try {const choice=await dialog.showMessageBox(window!,{type:'warning',message:`Close “${session.name}”?`,detail:'This will stop its terminal session and any work still running in it.',buttons:['Cancel','Close chat'],defaultId:0,cancelId:0});if(choice.response!==1)return false;}
        finally{confirmingClose=false;}
      }
      if(session.status!=='closed')await engine.terminate(id);return true;
    });
    handle('forget', async id => {
      const choice = await dialog.showMessageBox(window!, { type: 'question', message: 'Remove this session from Harbor?', detail: 'Its tmux session, if still running, will be left untouched. You can still attach with tmux from a terminal.', buttons: ['Cancel', 'Remove from Harbor'], defaultId: 0, cancelId: 0 });
      if (choice.response !== 1) return false;
      await engine.forget(id); return true;
    });
    handle('chooseFolder', async () => (await dialog.showOpenDialog(window!, { properties: ['openDirectory', 'createDirectory'] })).filePaths[0] ?? null);
    handle('openDataDir', () => shell.openPath(app.getPath('userData')));
    handle('openExternal', (url: string) => { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only web links can be opened.'); return shell.openExternal(parsed.toString()); });
    engine.on('attention', ({session,completed}) => {
      const settings=engine.snapshot().preferences.notifications;
      if(!settings.enabled || (completed && !settings.onComplete) || (window?.isFocused() && !settings.whenFocused) || !Notification.isSupported()) return;
      const notification=new Notification({title:session.name,body:completed?'Finished and ready for your next message.':session.activityDetail||'This chat needs your attention.',silent:!settings.sound});
      activeNotifications.add(notification);
      notification.once('close',()=>activeNotifications.delete(notification));
      notification.once('failed',(_event,error)=>{activeNotifications.delete(notification);console.error('Harbor notification failed:',error);});
      notification.on('click',()=>{if(!window) createWindow(); window?.show(); window?.focus(); window?.webContents.send('harbor:open-session',session.id);});
      notification.show();
    });
    engine.on('snapshot', snapshot => window?.webContents.send('harbor:snapshot-changed', snapshot));
    engine.on('terminal', event => window?.webContents.send('harbor:terminal', event));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Harbor', submenu: [{ role: 'about' }, { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: () => window?.webContents.send('harbor:preferences') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Session', submenu: [{label:'Close Chat',accelerator:'CmdOrCtrl+W',click:()=>window?.webContents.send('harbor:close-session')}, { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => window?.webContents.send('harbor:new-session') }, {label:'New Tab',accelerator:'CmdOrCtrl+T',click:()=>window?.webContents.send('harbor:new-session')}, {label:'Next Tab',accelerator:'Ctrl+Tab',click:()=>window?.webContents.send('harbor:tab-shortcut','next')}, {label:'Previous Tab',accelerator:'Ctrl+Shift+Tab',click:()=>window?.webContents.send('harbor:tab-shortcut','previous')}, ...Array.from({length:9},(_,i)=>({label:i===8?'Select Last Tab':`Select Tab ${i+1}`,accelerator:`CmdOrCtrl+${i+1}`,click:()=>window?.webContents.send('harbor:tab-shortcut',i+1)})), { label: 'Refresh Chats and Status', accelerator: 'CmdOrCtrl+R', click: () => window?.webContents.send('harbor:refresh-all') }] },
      { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : [])] }, { role: 'windowMenu' }
    ]));
    const checkWhenDue = () => {if(quitting)return;void engine.checkUpdates(false).catch(error => console.error('Agent update check:', error.message));};
    app.on('browser-window-focus', checkWhenDue);
    const updateTimer = setInterval(checkWhenDue, 60 * 60 * 1000); updateTimer.unref();
    app.once('before-quit', () => clearInterval(updateTimer));
    createWindow();
    checkWhenDue();
    powerMonitor.on('resume', () => { checkWhenDue(); void engine.refresh(); window?.webContents.send('harbor:wake'); });
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Harbor could not start', String(error)); app.exit(1); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (quitting || !engine) return;
    event.preventDefault(); quitting = true;
    // Leave the cancelled before-quit callback before asking Electron to quit again.
    engine.dispose().finally(() => setImmediate(() => app.quit()));
  });
}
