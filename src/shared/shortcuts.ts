import type { TabShortcut } from './types';
export function tabShortcut(event:{key:string;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean}):TabShortcut|undefined {
  if(event.altKey)return;
  if(event.metaKey&&!event.shiftKey&&/^[1-9]$/.test(event.key))return Number(event.key);
  if(event.ctrlKey&&event.key==='Tab')return event.shiftKey?'previous':'next';
  if(event.metaKey&&event.shiftKey&&['[',']','{','}'].includes(event.key))return ['[','{'].includes(event.key)?'previous':'next';
}
