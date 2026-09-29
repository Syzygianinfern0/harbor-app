// Todo edits on a note's Markdown text. Items are addressed by line number (as parsed from the same text); each edit
// returns new text. An item always travels with its subtree (children and continuation lines).
import { listRegions, scanLines, type ListNode, type Priority } from './markdown';

interface Found {node:ListNode;siblings:ListNode[]}
function find(text:string,line:number):Found|undefined {
  const walk=(siblings:ListNode[]):Found|undefined=>{for(const node of siblings){if(node.line===line)return {node,siblings};if(line>node.line&&line<node.end)return walk(node.children);}};
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
  const src=find(text,from)?.node,dst=find(text,to)?.node;if(!src||!dst)return;
  if(dst.line>=src.line&&dst.line<src.end)return;
  let at=after?dst.end:dst.line;
  if(at>=src.line&&at<=src.end&&dst.indent===src.indent)return;
  const lines=text.split('\n'),moved=lines.slice(src.line,src.end),delta=dst.indent-src.indent;
  const shifted=moved.map(l=>{if(!l.trim())return l;const body=l.replace(/^[ \t]*/,''),width=Math.max(0,(l.match(/^[ \t]*/)![0].replace(/\t/g,'    ').length)+delta);return ' '.repeat(width)+body;});
  // The moved item adopts the target list's marker, so it joins that list rather than starting a new one beside it;
  // numbered runs keep their first number whether the item leaves or joins the front.
  const [,,num,delim]=/^([ \t]*)(?:(\d{1,9})([.)])|[-*+])/.exec(lines[dst.line])!,marker=num?`${Number(num)+(after?1:0)}${delim}`:/^[ \t]*([-*+])/.exec(lines[dst.line])![1];
  shifted[0]=shifted[0].replace(/^([ \t]*)([-*+]|\d{1,9}[.)])/,(_,space)=>space+marker);
  const {siblings}=find(text,from)!,k=siblings.indexOf(src),prev=siblings[k-1],follow=siblings[k+1],srcNum=NUM.exec(lines[src.line]);
  if(srcNum&&follow&&!(prev&&NUM.test(lines[prev.line]))&&NUM.test(lines[follow.line]))lines[follow.line]=lines[follow.line].replace(NUM,`$1${srcNum[2]}$3`);
  lines.splice(src.line,moved.length);if(at>src.line)at-=moved.length;
  lines.splice(at,0,...shifted);
  const next=renumber(lines.join('\n'));
  return next===renumber(text)?undefined:next;
}
