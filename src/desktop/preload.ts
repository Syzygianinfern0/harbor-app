import { contextBridge, ipcRenderer, webUtils } from 'electron';
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
  onRefresh: callback => subscribe('harbor:refresh-all', callback),
  onPreferences: callback => subscribe('harbor:preferences', callback),
  addProject: input => ipcRenderer.invoke('harbor:addProject', input),
  listDirectories: (host, input, showHidden) => ipcRenderer.invoke('harbor:listDirectories', host, input, showHidden),
  updateProject: (id,patch) => ipcRenderer.invoke('harbor:updateProject', id,patch),
  manageProjects: projects => ipcRenderer.invoke('harbor:manageProjects', projects),
  usage: () => ipcRenderer.invoke('harbor:usage'),
  chatUsage: id => ipcRenderer.invoke('harbor:chatUsage', id),
  chatPreview: id => ipcRenderer.invoke('harbor:chatPreview', id),
  importHistory: id => ipcRenderer.invoke('harbor:importHistory', id),
  resume: (id,restart) => ipcRenderer.invoke('harbor:resume', id,restart),
  checkUpdates: force => ipcRenderer.invoke('harbor:checkUpdates', force),
  updateAllAgents: () => ipcRenderer.invoke('harbor:updateAllAgents'),
  openProjectInCursor: id => ipcRenderer.invoke('harbor:openProjectInCursor', id),
  testNotification: sound => ipcRenderer.invoke('harbor:testNotification', sound),
  openNotificationSettings: () => ipcRenderer.invoke('harbor:openNotificationSettings'),
  updateAgent: (hostId,agent) => ipcRenderer.invoke('harbor:updateAgent',hostId,agent),
  checkReachability: () => ipcRenderer.invoke('harbor:checkReachability'),
  onTabShortcut: callback => subscribe('harbor:tab-shortcut',callback),
  onCloseSession: callback => subscribe('harbor:close-session',callback),
  onOpenSession: callback => subscribe<string>('harbor:open-session',callback),
  setChatView: view => ipcRenderer.invoke('harbor:setChatView', view),
  create: input => ipcRenderer.invoke('harbor:create', input),
  update: (id, patch) => ipcRenderer.invoke('harbor:update', id, patch),
  terminate: id => ipcRenderer.invoke('harbor:terminate', id),
  forget: id => ipcRenderer.invoke('harbor:forget', id),
  attach: (id, cols, rows) => ipcRenderer.invoke('harbor:attach', id, cols, rows),
  detach: id => ipcRenderer.invoke('harbor:detach', id),
  input: (id, data) => ipcRenderer.invoke('harbor:input', id, data),
  paste: (id, data) => ipcRenderer.invoke('harbor:paste', id, data),
  dropFiles: (id, files) => ipcRenderer.invoke('harbor:dropFiles', id, files.map(file => webUtils.getPathForFile(file))),
  copyText: text => ipcRenderer.invoke('harbor:copyText', text),
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
