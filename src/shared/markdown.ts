// A small Markdown subset for notes: headings (#–###), paragraphs, **bold**, *italic*/_italic_, `code`, fenced code,
// bullet/numbered lists nested by indentation, checklists (`- [ ]`/`- [x]`) and a trailing `!p1`–`!p3` priority.
// It produces a tree, never HTML, so the renderer only ever creates text nodes: nothing in a note can inject markup.

export type Priority=1|2|3|4;
export type Inline={t:'text';v:string}|{t:'code';v:string}|{t:'strong'|'em';c:Inline[]};
export interface LineInfo {kind:'blank'|'heading'|'item'|'text'|'fence'|'code';indent:number;level?:number;ordered?:boolean;num?:number;delim?:string;bullet?:string;task?:boolean;checked?:boolean;priority?:Priority;content:string}
/** A list item and its subtree: lines [line, end) of the note, children nested by indentation. */
export interface ListNode {line:number;end:number;indent:number;ordered:boolean;num:number;task:boolean;checked:boolean;priority:Priority;content:string;more:string[];children:ListNode[]}
export interface List {t:'list';ordered:boolean;start:number;items:ListNode[]}
export type Block={t:'heading';level:1|2|3;text:string}|{t:'para';lines:string[]}|{t:'code';v:string}|List;

const ITEM=/^([ \t]*)([-*+]|(\d{1,9})([.)]))(?:[ \t]+|$)(.*)$/,TASK=/^\[([ xX])\](?:[ \t]+|$)/,PRIORITY=/(?:^|[ \t])!p([1-4])[ \t]*$/i;
export const indentOf=(line:string)=>{let n=0;for(const ch of line){if(ch===' ')n++;else if(ch==='\t')n+=4-n%4;else break;}return n;};

/** Classify each line; fenced code is opaque so nothing inside it is a list or heading. */
export function scanLines(text:string):LineInfo[] {
  let fence=false;
  return text.split('\n').map(raw=>{
    const indent=indentOf(raw);
    if(/^[ \t]*(```|~~~)/.test(raw)){fence=!fence;return {kind:'fence',indent,content:raw};}
    if(fence)return {kind:'code',indent,content:raw};
    if(!raw.trim())return {kind:'blank',indent,content:''};
    const h=/^[ \t]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(raw)||/^[ \t]{0,3}(#{1,6})$/.exec(raw);
    if(h)return {kind:'heading',indent,level:Math.min(3,h[1].length),content:h[2]??''};
    const m=ITEM.exec(raw);
    if(m){
      let content=m[5];const task=TASK.exec(content);if(task)content=content.slice(task[0].length);
      const p=PRIORITY.exec(content);if(p)content=content.slice(0,p.index).trimEnd();
      return {kind:'item',indent,ordered:!!m[3],num:m[3]?Number(m[3]):undefined,delim:m[4],bullet:m[3]?undefined:m[2],task:!!task,checked:!!task&&task[1]!==' ',priority:(p?Number(p[1]):4) as Priority,content};
    }
    return {kind:'text',indent,content:raw.trim()};
  });
}

/** Every list region (a run of item lines and their indented continuation lines, ended by a blank line or other block) as a forest. */
export function listRegions(lines:LineInfo[]):{start:number;end:number;roots:ListNode[]}[] {
  const regions=[];
  for(let i=0;i<lines.length;){
    if(lines[i].kind!=='item'){i++;continue;}
    const start=i,roots:ListNode[]=[],stack:ListNode[]=[];let last:ListNode|undefined;
    for(;i<lines.length&&(lines[i].kind==='item'||(lines[i].kind==='text'&&lines[i].indent>0));i++){
      const l=lines[i];
      // Continuation text belongs to the item just above it, so an item's subtree is always a contiguous run of lines.
      if(l.kind==='text'){last!.more.push(l.content);continue;}
      while(stack.length&&stack.at(-1)!.indent>=l.indent)stack.pop();
      const node:ListNode={line:i,end:i+1,indent:l.indent,ordered:!!l.ordered,num:l.num??1,task:!!l.task,checked:!!l.checked,priority:l.priority??4,content:l.content,more:[],children:[]};
      (stack.at(-1)?.children??roots).push(node);stack.push(node);last=node;
    }
    const close=(nodes:ListNode[],end:number)=>nodes.forEach((n,k)=>{n.end=k+1<nodes.length?nodes[k+1].line:end;close(n.children,n.end);});
    close(roots,i);regions.push({start,end:i,roots});
  }
  return regions;
}

/** Siblings split into lists wherever bullets and numbers alternate, as Markdown does. */
export function groupLists(nodes:ListNode[]):List[] {
  const lists:List[]=[];
  for(const n of nodes){const prev=lists.at(-1);if(prev&&prev.ordered===n.ordered)prev.items.push(n);else lists.push({t:'list',ordered:n.ordered,start:n.num,items:[n]});}
  return lists;
}

export function parseBlocks(text:string):Block[] {
  const raw=text.split('\n'),lines=scanLines(text),regions=new Map(listRegions(lines).map(r=>[r.start,r])),blocks:Block[]=[];
  for(let i=0;i<lines.length;){
    const l=lines[i];
    if(l.kind==='blank'){i++;continue;}
    if(l.kind==='heading'){blocks.push({t:'heading',level:l.level as 1|2|3,text:l.content});i++;continue;}
    if(l.kind==='fence'){const body:string[]=[];for(i++;i<lines.length&&lines[i].kind==='code';i++)body.push(raw[i]);if(lines[i]?.kind==='fence')i++;blocks.push({t:'code',v:body.join('\n')});continue;}
    if(l.kind==='code'){i++;continue;}
    const region=regions.get(i);
    if(region){blocks.push(...groupLists(region.roots));i=region.end;continue;}
    const para:string[]=[];for(;i<lines.length&&lines[i].kind==='text';i++)para.push(lines[i].content);blocks.push({t:'para',lines:para});
  }
  return blocks;
}

/** Inline spans: `code` first (its contents stay literal), then **bold** or __bold__, then *italic* or _italic_. Unmatched markers stay text. */
export function parseInline(text:string):Inline[] {
  const out:Inline[]=[];const push=(v:string)=>{if(!v)return;const prev=out.at(-1);if(prev?.t==='text')prev.v+=v;else out.push({t:'text',v});};
  let i=0;
  while(i<text.length){
    const ch=text[i];
    if(ch==='\\'&&/[\\`*_!#[\]-]/.test(text[i+1]??'')){push(text[i+1]);i+=2;continue;}
    if(ch==='`'){const run=/^`+/.exec(text.slice(i))![0],close=text.indexOf(run,i+run.length);if(close>i){out.push({t:'code',v:text.slice(i+run.length,close).trim()||text.slice(i+run.length,close)});i=close+run.length;continue;}push(run);i+=run.length;continue;}
    if(ch==='*'||ch==='_'){
      const double=text[i+1]===ch,mark=double?ch+ch:ch,from=i+mark.length;
      // Intraword underscores (snake_case) are not emphasis; the opener must be followed by a non-space.
      const opens=!/\s/.test(text[from]??' ')&&!(ch==='_'&&/\w/.test(text[i-1]??''));
      let close=-1;
      if(opens)for(let j=from+1;j<=text.length-mark.length;j++){
        if(text[j]==='`'){const run=/^`+/.exec(text.slice(j))![0],end=text.indexOf(run,j+run.length);if(end>j){j=end+run.length-1;continue;}}
        if(!double&&text.startsWith(ch+ch,j)){j++;continue;}
        if(text.startsWith(mark,j)&&!/\s/.test(text[j-1])&&(double||text[j+1]!==ch)&&!(ch==='_'&&/\w/.test(text[j+mark.length]??''))){close=double&&text[j+2]===ch?j+1:j;break;}
      }
      if(close>0){out.push({t:double?'strong':'em',c:parseInline(text.slice(from,close))});i=close+mark.length;continue;}
      push(mark);i+=mark.length;continue;
    }
    const next=text.slice(i+1).search(/[\\`*_]/);const stop=next<0?text.length:i+1+next;push(text.slice(i,stop));i=stop;
  }
  return out;
}

/** Plain text of a note, markers removed (for titles, search and accessible names). */
export const inlineText=(nodes:Inline[]):string=>nodes.map(n=>n.t==='text'||n.t==='code'?n.v:inlineText(n.c)).join('');
