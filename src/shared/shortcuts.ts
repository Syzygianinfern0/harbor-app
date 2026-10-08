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
/** Command-F alone opens the focused terminal's find bar (⌘G/⌘⇧G stay with tab groups). */
export const findShortcut=(event:{key:string;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean})=>event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='f';
/** Find-bar status: "3 of 12", "12 matches" with none current, "1000+" once capped at the highlight limit. */
export function findStatus(query:string,index:number,count:number,limit:number):string {
  if(!query)return '';if(!count)return 'No results';
  const total=count>=limit?`${limit}+`:String(count);
  return index<0?`${total} ${count===1?'match':'matches'}`:`${index+1} of ${total}`;
}
/** Every Harbor shortcut, listed read-only in Settings → Shortcuts. Keep in step with the handlers above, App.tsx and the app menu. */
export const shortcutList: {section:string;items:[action:string,keys:string][]}[] = [
  {section:'Chats',items:[['New chat in the selected project','⌘ N / ⌘ T'],['Close the chat, or Settings when it is showing','⌘ W'],['Open the focused chat’s folder in the default app','⌘ ⇧ O'],['Refresh chats and status','⌘ R'],['Search chats and projects','⌘ K'],['Find in the focused terminal, or search Settings','⌘ F']]},
  {section:'Tabs',items:[['Select tab 1–8','⌘ 1 … ⌘ 8'],['Select the last tab','⌘ 9'],['Next / previous tab','⌃ Tab / ⌃ ⇧ Tab'],['Next / previous tab','⌘ ⇧ ] / ⌘ ⇧ [']]},
  {section:'Tab groups',items:[['Group the selected tabs','⌘ G'],['Turn grouping by project on or off','⌘ ⇧ G'],['Next / previous group','⌥ ⌘ → / ⌥ ⌘ ←'],['Open group 1–9','⌥ ⌘ 1 … ⌥ ⌘ 9'],['Next chat that needs input','⌘ J']]},
  {section:'New chat dialog',items:[['Codex / Claude Code / Terminal','⌘ 1 / ⌘ 2 / ⌘ 3']]},
  {section:'Terminal',items:[['Delete to the start of the line','⌘ ⌫'],['Start / end of the line','⌘ ← / ⌘ →'],['Copy / paste','⌘ C / ⌘ V']]},
  {section:'Notes',items:[['Switch between Markdown and Formatted','⌘ E']]},
  {section:'Window',items:[['Open Settings','⌘ ,'],['Collapse or pin the sidebar','⌘ B']]},
];
