import type { TabShortcut } from './types';
export function tabShortcut(event:{key:string;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean}):TabShortcut|undefined {
  if(event.altKey)return;
  if(event.metaKey&&!event.shiftKey&&/^[1-9]$/.test(event.key))return Number(event.key);
  if(event.ctrlKey&&event.key==='Tab')return event.shiftKey?'previous':'next';
  if(event.metaKey&&event.shiftKey&&['[',']','{','}'].includes(event.key))return ['[','{'].includes(event.key)?'previous':'next';
}
export type GroupShortcut = 'group-selected' | 'toggle-project-groups' | 'next-group' | 'previous-group' | 'next-attention' | number;
/** Tab-group shortcuts. Option changes `key` on macOS (Option-1 is "¡"), so digits and letters use `code`. */
export function groupShortcut(event:{key:string;code?:string;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean}):GroupShortcut|undefined {
  if(!event.metaKey||event.ctrlKey)return;
  const letter=event.code?.startsWith('Key')?event.code.slice(3).toLowerCase():event.key.toLowerCase();
  if(event.altKey){
    if(event.shiftKey)return;
    if(event.key==='ArrowRight')return 'next-group';if(event.key==='ArrowLeft')return 'previous-group';
    const digit=/^Digit([1-9])$/.exec(event.code??'');return digit?Number(digit[1]):undefined;
  }
  if(letter==='g')return event.shiftKey?'toggle-project-groups':'group-selected';
  if(letter==='j'&&!event.shiftKey)return 'next-attention';
}
