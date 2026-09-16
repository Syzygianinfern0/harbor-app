import { contextBridge, ipcRenderer } from 'electron';
import type { HarborApi, Snapshot, TerminalEvent } from '../shared/types';
function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener);
}
const api: HarborApi = {
  snapshot: () => ipcRenderer.invoke('harbor:snapshot'),
  savePreferences: preferences => ipcRenderer.invoke('harbor:savePreferences', preferences),
  sshCandidates: () => ipcRenderer.invoke('harbor:sshCandidates'),
  resolveSsh: alias => ipcRenderer.invoke('harbor:resolveSsh', alias),
  onPreferences: callback => subscribe('harbor:preferences', callback),
  addProject: input => ipcRenderer.invoke('harbor:addProject', input),
  updateProject: (id,name) => ipcRenderer.invoke('harbor:updateProject', id,name),
  importHistory: id => ipcRenderer.invoke('harbor:importHistory', id),
  resume: (id,restart) => ipcRenderer.invoke('harbor:resume', id,restart),
  checkUpdates: () => ipcRenderer.invoke('harbor:checkUpdates'),
  testNotification: () => ipcRenderer.invoke('harbor:testNotification'),
  onOpenSession: callback => subscribe<string>('harbor:open-session',callback),
  create: input => ipcRenderer.invoke('harbor:create', input),
  update: (id, patch) => ipcRenderer.invoke('harbor:update', id, patch),
  terminate: id => ipcRenderer.invoke('harbor:terminate', id),
  forget: id => ipcRenderer.invoke('harbor:forget', id),
  attach: (id, cols, rows) => ipcRenderer.invoke('harbor:attach', id, cols, rows),
  detach: id => ipcRenderer.invoke('harbor:detach', id),
  input: (id, data) => ipcRenderer.invoke('harbor:input', id, data),
  paste: (id, data) => ipcRenderer.invoke('harbor:paste', id, data),
  resize: (id, cols, rows) => ipcRenderer.invoke('harbor:resize', id, cols, rows),
  diagnose: host => ipcRenderer.invoke('harbor:diagnose', host),
  refresh: () => ipcRenderer.invoke('harbor:refresh'),
  chooseFolder: () => ipcRenderer.invoke('harbor:chooseFolder'),
  openDataDir: () => ipcRenderer.invoke('harbor:openDataDir'),
  openExternal: url => ipcRenderer.invoke('harbor:openExternal', url),
  onSnapshot: callback => subscribe<Snapshot>('harbor:snapshot-changed', callback),
  onTerminal: callback => subscribe<TerminalEvent>('harbor:terminal', callback),
  onNewSession: callback => subscribe('harbor:new-session', callback)
};
contextBridge.exposeInMainWorld('harbor', api);
