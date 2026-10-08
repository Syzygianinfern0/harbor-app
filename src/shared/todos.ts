// Todo edits on a note's Markdown text. Items are addressed by line number (as parsed from the same text); each edit
// returns new text. An item always travels with its subtree (children and continuation lines).
import { listRegions, scanLines, type ListNode, type Priority } from './markdown';

interface Found {node:ListNode;siblings:ListNode[];parent?:ListNode}
function find(text:string,line:number):Found|undefined {
  const walk=(siblings:ListNode[],parent?:ListNode):Found|undefined=>{for(const node of siblings){if(node.line===line)return {node,siblings,parent};if(line>node.line&&line<node.end)return walk(node.children,node);}};
  for(const r of listRegions(scanLines(text)))if(line>=r.start&&line<r.end)return walk(r.roots);
}
const descendants=(n:ListNode):ListNode[]=>n.children.flatMap(c=>[c,...descendants(c)]);
const CHECK=/^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[[ xX]\]/;
const setChecked=(line:string,checked:boolean)=>line.replace(CHECK,`$1[${checked?'x':' '}]`);
const NUM=/^([ \t]*)(\d{1,9})([.)])/;
/** Rewrite a sibling run [siblings[0].line, last.end) in a new order; numbered items keep the numbers of the places they land in. */
function reorder(lines:string[],siblings:ListNode[],order:ListNode[]) {
  const start=siblings[0].line,end=siblings.at(-1)!.end,nums=siblings.map(s=>NUM.exec(lines[s.line])?.[2]);
  const blocks=order.map(n=>lines.slice(n.line,n.end));
  blocks.forEach((b,k)=>{if(nums[k]!==undefined&&NUM.test(b[0]))b[0]=b[0].replace(NUM,`$1${nums[k]}$3`);});
  lines.splice(start,end-start,...blocks.flat());
}

/** Numbered sibling runs count up from their first number again after items move. */
export function renumber(text:string):string {
  const lines=text.split('\n'),info=scanLines(text);
  const fix=(nodes:ListNode[])=>{let n=0,prev:ListNode|undefined;for(const node of nodes){
    const l=info[node.line];if(!l.ordered){prev=undefined;}else{n=prev?n+1:l.num!;prev=node;lines[node.line]=lines[node.line].replace(/^([ \t]*)\d{1,9}([.)])/,`$1${n}$2`);}
    fix(node.children);}};
  for(const r of listRegions(info))fix(r.roots);
  return lines.join('\n');
}

/** Check or uncheck a task. A checked task sinks below its siblings with its subtree, and checking a parent checks its
 *  subtasks too. Unchecking lifts it back above the checked siblings; its subtasks keep their own state. */
export function toggleTask(text:string,line:number):string {
  const found=find(text,line);if(!found?.node.task)return text;
  const {node,siblings}=found,checked=!node.checked,lines=text.split('\n');
  lines[line]=setChecked(lines[line],checked);
  if(checked)for(const d of descendants(node))if(d.task)lines[d.line]=setChecked(lines[d.line],true);
  // Unchecking lifts a task above the first checked sibling below it; one already above them stays where it is.
  const rest=siblings.filter(s=>s!==node),first=rest.findIndex(s=>s.checked),index=siblings.indexOf(node);
  const at=checked?rest.length:first<0||siblings.indexOf(rest[first])>index?index:first;
  reorder(lines,siblings,[...rest.slice(0,at),node,...rest.slice(at)]);
  return lines.join('\n');
}

/** Set P1–P3 as a trailing `!pN` token; P4 (the default) removes it. */
export function setPriority(text:string,line:number,priority:Priority):string {
  const found=find(text,line);if(!found)return text;
  const lines=text.split('\n');const bare=lines[line].replace(/[ \t]+!p[1-4][ \t]*$/i,'').replace(/[ \t]+$/,'');
  lines[line]=priority<4?`${bare} !p${priority}`:bare;
  return lines.join('\n');
}

/** Move an item (with its subtree) before or after another item's subtree, taking that item's depth and list style.
 *  Undefined when the move changes nothing or would drop an item inside itself. */
export function moveTask(text:string,from:number,to:number,after:boolean):string|undefined {
  const found=find(text,from),dst=find(text,to)?.node;if(!found||!dst)return;const {node:src,siblings}=found;
  if(dst.line>=src.line&&dst.line<src.end)return;
  let at=after?dst.end:dst.line;
  if(at>=src.line&&at<=src.end&&dst.indent===src.indent)return;
  const lines=text.split('\n'),moved=lines.slice(src.line,src.end),delta=dst.indent-src.indent;
  const shifted=moved.map(l=>{if(!l.trim())return l;const body=l.replace(/^[ \t]*/,''),width=Math.max(0,(l.match(/^[ \t]*/)![0].replace(/\t/g,'    ').length)+delta);return ' '.repeat(width)+body;});
  // The moved item adopts the target list's marker, so it joins that list rather than starting a new one beside it;
  // numbered runs keep their first number whether the item leaves or joins the front.
  const [,,num,delim]=/^([ \t]*)(?:(\d{1,9})([.)])|[-*+])/.exec(lines[dst.line])!,marker=num?`${Number(num)+(after?1:0)}${delim}`:/^[ \t]*([-*+])/.exec(lines[dst.line])![1];
  shifted[0]=shifted[0].replace(/^([ \t]*)([-*+]|\d{1,9}[.)])/,(_,space)=>space+marker);
  const k=siblings.indexOf(src),prev=siblings[k-1],follow=siblings[k+1],srcNum=NUM.exec(lines[src.line]);
  if(srcNum&&follow&&!(prev&&NUM.test(lines[prev.line]))&&NUM.test(lines[follow.line]))lines[follow.line]=lines[follow.line].replace(NUM,`$1${srcNum[2]}$3`);
  lines.splice(src.line,moved.length);if(at>src.line)at-=moved.length;
  lines.splice(at,0,...shifted);
  const next=renumber(lines.join('\n'));
  return next===renumber(text)?undefined:next;
}

// Keep/Todoist-style editing in the Formatted view. Edits that create or move an item also return its new line, so the
// view can keep the cursor on it.
export interface Placed {text:string;line:number}
const PREFIX=/^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+|$)(\[[ xX]\](?:[ \t]+|$))?/;
const oneLine=(content:string)=>content.replace(/\r\n?|\n/g,' ');
/** A fresh item with `template`'s indent and marker (numbers are fixed by `renumber`), unchecked if it is a task. */
function newItem(template:string,content:string,task:boolean):string {
  const [,space,marker]=PREFIX.exec(template)!;
  return `${space}${marker} ${task?'[ ] ':''}${oneLine(content)}`;
}

/** Replace an item's own text (its first line), keeping its marker, checkbox and priority. Newlines become spaces. */
export function editTask(text:string,line:number,content:string):string {
  const found=find(text,line);if(!found)return text;
  const lines=text.split('\n'),head=PREFIX.exec(lines[line])![0].replace(/[ \t]*$/,' '),body=oneLine(content),{priority}=found.node;
  lines[line]=head+body+(priority<4?`${body&&!/[ \t]$/.test(body)?' ':''}!p${priority}`:'');
  return lines.join('\n');
}

/** Insert an item right below another (Enter in Keep): its first child when it has children, otherwise its next
 *  sibling, of the same kind (a task under a task). */
export function insertTask(text:string,line:number,content=''):Placed|undefined {
  const found=find(text,line);if(!found)return;const {node}=found,child=node.children[0],lines=text.split('\n');
  const at=child?child.line:node.end;
  lines.splice(at,0,newItem(lines[child?child.line:line],content,node.task));
  return {text:renumber(lines.join('\n')),line:at};
}

/** "+ Add item": a new unchecked task at the end of the list holding `line`, above its checked items like Keep. With no
 *  line, a checklist starts at the end of the note. */
export function addTask(text:string,line?:number,content=''):Placed {
  const found=line===undefined?undefined:find(text,line);
  if(!found){
    if(!text.trim())return {text:`- [ ] ${oneLine(content)}`,line:0};
    const lines=[...text.replace(/\s+$/,'').split('\n'),'',`- [ ] ${oneLine(content)}`];
    return {text:lines.join('\n'),line:lines.length-1};
  }
  // The list is the run of siblings sharing the item's bullet-or-number style (Markdown splits lists where they alternate).
  const {node,siblings}=found;let first=siblings.indexOf(node),last=first;
  while(first>0&&siblings[first-1].ordered===node.ordered)first--;
  while(last+1<siblings.length&&siblings[last+1].ordered===node.ordered)last++;
  const run=siblings.slice(first,last+1),done=run.find(s=>s.task&&s.checked),lines=text.split('\n');
  const at=done?done.line:run.at(-1)!.end;
  lines.splice(at,0,newItem(lines[(done??run.at(-1)!).line],content,true));
  return {text:renumber(lines.join('\n')),line:at};
}

/** Delete an item with its sub-items. A numbered list keeps its first number, and a blank line left doubled (or
 *  leading/trailing the note) is dropped. */
export function deleteTask(text:string,line:number):string {
  const found=find(text,line);if(!found)return text;const {node,siblings}=found,lines=text.split('\n');
  const k=siblings.indexOf(node),prev=siblings[k-1],follow=siblings[k+1],num=NUM.exec(lines[node.line]);
  if(num&&follow&&!(prev&&NUM.test(lines[prev.line]))&&NUM.test(lines[follow.line]))lines[follow.line]=lines[follow.line].replace(NUM,`$1${num[2]}$3`);
  lines.splice(node.line,node.end-node.line);
  const at=node.line,blank=(i:number)=>i<0||i>=lines.length||!lines[i].trim();
  if(lines.length>1&&blank(at-1)&&blank(at))lines.splice(at<lines.length?at:at-1,1);
  return renumber(lines.join('\n'));
}

/** Move an item one place up or down among its siblings, with its subtree. Undefined at either end. */
export function nudgeTask(text:string,line:number,direction:-1|1):Placed|undefined {
  const found=find(text,line);if(!found)return;const {node,siblings}=found,k=siblings.indexOf(node),other=siblings[k+direction];
  if(!other)return;const lines=text.split('\n'),order=[...siblings];order[k]=other;order[k+direction]=node;
  reorder(lines,siblings,order);
  return {text:renumber(lines.join('\n')),line:direction<0?other.line:node.line+other.end-other.line};
}

/** Lines of every list item in reading order, for moving the cursor between items. */
export const itemLines=(text:string):number[]=>scanLines(text).flatMap((l,i)=>l.kind==='item'?[i]:[]);

const widthOf=(space:string)=>space.replace(/\t/g,'    ').length;
/** Tab: the item (with its subtree) becomes the last child of the sibling above it. Undefined for a first sibling. */
export function indentTask(text:string,line:number):Placed|undefined {
  const found=find(text,line);if(!found)return;const {node,siblings}=found,prev=siblings[siblings.indexOf(node)-1];if(!prev)return;
  const lines=text.split('\n'),last=prev.children.at(-1);
  // Line up with existing children, or with the text of the item above (past its marker).
  const [,space,marker]=PREFIX.exec(lines[last?last.line:prev.line])!,target=last?widthOf(space):widthOf(space)+marker.length+1;
  const delta=target-node.indent;
  for(let i=node.line;i<node.end;i++){if(!lines[i].trim())continue;const indent=/^[ \t]*/.exec(lines[i])![0];lines[i]=' '.repeat(Math.max(0,widthOf(indent)+delta))+lines[i].slice(indent.length);}
  // Join the children's list style, or start a numbered sublist at 1.
  const own=/^([ \t]*)([-*+]|\d{1,9}([.)]))/.exec(lines[line])!,style=last?PREFIX.exec(lines[last.line])![2]:own[3]?`1${own[3]}`:own[2];
  lines[line]=own[1]+style+lines[line].slice(own[0].length);
  return {text:renumber(lines.join('\n')),line};
}

/** Shift-Tab: the item (with its subtree) leaves its parent and becomes the parent's next sibling. Undefined at the top level. */
export function outdentTask(text:string,line:number):Placed|undefined {
  const found=find(text,line);if(!found?.parent)return;const {node,parent}=found;
  const next=moveTask(text,line,parent.line,true);
  return next===undefined?undefined:{text:next,line:parent.end-(node.end-node.line)};
}
