import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { Bell, ChevronLeft, ChevronRight, Columns2, Plus, X } from 'lucide-react';
import type { Project, Session } from '../shared/types';
import { AgentIcon } from './AgentIcon';
import { ChatStatusIcon, StatusIcon, UnreadDot } from './ChatStatusIcon';
import { activityLabel, chatActivity, tracksActivity, type ChatStatus } from '../shared/chatStatus';
import { terminalCommand } from '../shared/terminalName';
import { dropSide, planStripDrop, type StripSource } from '../shared/dropCue';
import { splitRuns } from '../shared/splits';
import { useDropCue } from './useDropCue';
import { useTabMotion } from './useTabMotion';
import { InlineRename } from './InlineRename';
import { groupEntry, isCollapsed, layoutTabs, rollup, GROUP_COLORS, type TabGroups } from '../shared/tabGroups';

export interface GroupInfo { key:string; name:string; color:string; kind:'project'|'custom'; detail?:string }
export function groupInfo(key:string,groups:TabGroups,projects:Project[]):GroupInfo {
  if(key.startsWith('g:')){const g=groups.custom.find(g=>`g:${g.id}`===key);return {key,kind:'custom',name:g?.name??'Group',color:g?.color??GROUP_COLORS[4].value};}
  const p=projects.find(p=>p.id===key.slice(2));
  return {key,kind:'project',name:p?.name??'Project',color:groups.projectColors[key.slice(2)]??GROUP_COLORS[0].value,detail:p&&p.connection!=='local'?p.hostLabel:undefined};
}
const CHAT='application/x-harbor-chat',GROUP='application/x-harbor-group';
type Edge={count:number;attention:number;target?:string};
const noEdge:Edge={count:0,attention:0};
// Width the strip's content needs at rest. scrollWidth also counts in-flight FLIP
// transforms and exit ghosts, which would make the fit loop over-shrink.
const layoutWidth=(el:HTMLElement)=>{
  const items=Array.from(el.children as HTMLCollectionOf<HTMLElement>).filter(c=>!c.classList.contains('motion-ghost'));
  if(!items.length)return 0;
  const first=items[0],last=items[items.length-1],css=getComputedStyle(el);
  return last.offsetLeft+last.offsetWidth+parseFloat(getComputedStyle(last).marginRight)-first.offsetLeft+parseFloat(getComputedStyle(first).marginLeft)+parseFloat(css.paddingLeft)+parseFloat(css.paddingRight);
};

export interface TabStripProps {
  tabs:string[]; sessions:Session[]; projects:Project[]; groups:TabGroups; selected?:string; selection:Set<string>; busy?:string; dragging?:string;
  /** Chats tiled together (pane order), and the chats in the view now. */ splits?:string[][]; view?:string[];
  onOpen:(session:Session)=>void; onClose:(session:Session)=>void; onSelection:(ids:Set<string>)=>void;
  setTabs:(update:(tabs:string[])=>string[])=>void; setGroups:(update:(groups:TabGroups)=>TabGroups)=>void;
  onDragStart:(event:DragEvent,id:string)=>void; onDragEnd:()=>void; onNewChat:()=>void;
  onToggleGroup:(key:string)=>void; onTabMenu:(id:string,x:number,y:number)=>void; onGroupMenu:(key:string,x:number,y:number)=>void; onMoveProject:(source:string,target:string,after:boolean)=>void;
  /** The tab whose name is being edited in place (double-click a tab to start). */ renaming?:string; onStartRename?:(id:string)=>void; onRename?:(session:Session,name?:string)=>void;
}

export function TabStrip(props:TabStripProps) {
  const {groups,selected,selection}=props;
  const byId=new Map(props.sessions.map(s=>[s.id,s]));
  const tabs=props.tabs.filter(id=>byId.has(id));
  const splits=props.splits??[];
  const {segments,keyOf}=layoutTabs(tabs,groups,id=>byId.get(id)?.projectId,props.projects.map(p=>p.id),splits);
  const selectedKey=selected?keyOf.get(selected):undefined;
  const stripState={tabs,groups,projectOf:(id:string)=>byId.get(id)?.projectId,projectOrder:props.projects.map(p=>p.id),splits};
  const strip=useRef<HTMLDivElement>(null);
  useTabMotion(strip);
  const [width,setWidth]=useState(0);
  const [shrink,setShrink]=useState(0);
  const [edges,setEdges]=useState<{left:Edge;right:Edge}>({left:noEdge,right:noEdge});

  // Inactive tabs keep their names and flex down to fill the strip; while that still overflows,
  // they become icons one at a time: other groups before the current one, farthest from the active tab first. The split in view keeps full width, like the active tab.
  const shown=segments.flatMap(s=>s.kind==='tab'?[s.id]:isCollapsed(groups,s.key,selectedKey)?(selected&&s.tabs.includes(selected)?[selected]:[]):s.tabs);
  const at=selected?shown.indexOf(selected):-1;
  // A split's tabs share one outline; the one in view is lit as a unit, its focused pane brightest.
  const runs=splitRuns(segments.flatMap(s=>s.kind==='tab'?[s.id]:[undefined,...shown.filter(id=>keyOf.get(id)===s.key),undefined]),splits);
  const inView=new Set((props.view?.length??0)>1?props.view:[]);
  const iconOrder=shown.filter(id=>id!==selected&&!inView.has(id)).sort((a,b)=>Number(keyOf.get(b)!==selectedKey)-Number(keyOf.get(a)!==selectedKey)||Math.abs(shown.indexOf(b)-at)-Math.abs(shown.indexOf(a)-at));
  const fitKey=JSON.stringify([width,groups.shrink,selected,splits,props.view,segments.map(s=>s.kind==='tab'?s.id:[s.key,isCollapsed(groups,s.key,selectedKey),s.tabs.map(id=>byId.get(id)?.name)]),tabs.map(id=>byId.get(id)?.name)]);
  const fitted=useRef('');
  useLayoutEffect(()=>{
    const el=strip.current;if(!el)return;
    if(fitted.current!==fitKey){fitted.current=fitKey;if(shrink!==0){setShrink(0);return;}}
    if(groups.shrink&&shrink<iconOrder.length&&layoutWidth(el)>el.clientWidth+1)setShrink(shrink+1);
  },[fitKey,shrink,groups.shrink]);
  const icons=new Set(iconOrder.slice(0,shrink));
  useEffect(()=>{const el=strip.current;if(!el)return;const observer=new ResizeObserver(()=>setWidth(Math.round(el.clientWidth)));observer.observe(el);return()=>observer.disconnect();},[]);

  // Count what's off either edge, so a chat needing input is never both hidden and silent.
  const measure=()=>{
    const el=strip.current;if(!el)return;const view=el.getBoundingClientRect();
    const next={left:{...noEdge},right:{...noEdge}};
    el.querySelectorAll<HTMLElement>('[data-tab-id],[data-group-key].collapsed').forEach(item=>{
      const r=item.getBoundingClientRect();const center=r.left+r.width/2;if(center>=view.left&&center<=view.right)return;
      const side=center<view.left?next.left:next.right;
      const count=Number(item.dataset.hiddenCount??1),attention=(item.dataset.attention??'').split(' ').filter(Boolean);
      side.count+=count;side.attention+=attention.length;if(attention.length&&!side.target)side.target=item.dataset.tabId??item.dataset.groupKey;
    });
    setEdges(v=>JSON.stringify(v)===JSON.stringify(next)?v:next);
  };
  useLayoutEffect(measure);
  useEffect(()=>{document.querySelector('.session-toolbar .tab.active')?.scrollIntoView({block:'nearest',inline:'nearest'});},[selected,shrink]);
  const reveal=(side:'left'|'right')=>{
    const el=strip.current!;const target=edges[side].target;
    const item=target&&el.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(target)}"],[data-group-key="${CSS.escape(target)}"]`);
    if(item)item.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});else el.scrollBy({left:(side==='left'?-1:1)*el.clientWidth*.7,behavior:'smooth'});
  };

  // Drops: every cue comes from the same plan the drop applies, so the line marks where the item lands.
  type Target={tab:string}|{key:string};
  const drag=useDropCue<string,{target:string;x?:number}>();
  const members=(key:string)=>Array.from(strip.current?.querySelectorAll<HTMLElement>('[data-tab-id],[data-group-key]')??[]).filter(el=>el.dataset.groupKey===key||!!el.dataset.tabId&&keyOf.get(el.dataset.tabId)===key);
  const resolve=(event:DragEvent,target:Target,source:StripSource|undefined)=>{
    if(!source)return;
    if('chat' in source&&'key' in target){const plan=planStripDrop(stripState,source,target,'into');return plan&&{plan,place:'into' as const};}
    // A tab lands beside a tab; a group lands beside the whole target group (or an ungrouped tab).
    const key='group' in source?('key' in target?target.key:keyOf.get(target.tab)):undefined;
    const run='tab' in target&&!key?runs.get(target.tab):undefined;
    const els=key?members(key):run?run.flatMap(id=>strip.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)??[]):[event.currentTarget as HTMLElement];if(!els.length)return;
    const first=els[0],last=els.at(-1)!,left=first.getBoundingClientRect().left,right=last.getBoundingClientRect().right;
    const place=dropSide({left,top:0,width:right-left,height:0},event.clientX,event.clientY,'x');
    const plan=planStripDrop(stripState,source,target,place);if(!plan)return;
    // Center the line in the gap to the neighbor, so it reads the same between tabs and before a chip.
    const edge=place==='before'?first:last,near=(place==='before'?edge.previousElementSibling:edge.nextElementSibling) as HTMLElement|null;
    const r=edge.getBoundingClientRect(),n=near&&!near.classList.contains('motion-ghost')?near.getBoundingClientRect():undefined;
    const x=place==='before'?(n?(n.right+r.left)/2:r.left-parseFloat(getComputedStyle(edge).marginLeft)/2):(n?(r.right+n.left)/2:r.right-1);
    return {plan,place,x};
  };
  const over=(event:DragEvent,target:Target,id:string)=>{
    const types=event.dataTransfer.types;if(!types.includes(CHAT)&&!types.includes(GROUP))return;event.stopPropagation();
    const hit=resolve(event,target,drag.source?{group:drag.source}:props.dragging?{chat:props.dragging}:undefined);
    if(!hit){drag.show(undefined);return;}
    event.preventDefault();event.dataTransfer.dropEffect='move';
    const wrap=strip.current!.parentElement!.getBoundingClientRect();
    drag.show({target:id,x:hit.x===undefined?undefined:Math.round(Math.max(1,Math.min(wrap.width-1,hit.x-wrap.left)))});
  };
  const drop=(event:DragEvent,target:Target)=>{
    event.preventDefault();event.stopPropagation();
    const group=event.dataTransfer.getData(GROUP),chat=event.dataTransfer.getData(CHAT);props.onDragEnd();
    const hit=resolve(event,target,group?{group}:chat?{chat}:undefined);if(!hit)return;const {plan}=hit;
    if(plan.project){props.onMoveProject(plan.project.source,plan.project.target,plan.project.after);return;}
    if(plan.groups!==groups)props.setGroups(()=>plan.groups);
    // Adding to a folded group keeps it folded; the chip's count is the feedback.
    if(hit.place==='into')props.setTabs(v=>v.includes(chat)?v:[...v,chat]);else props.setTabs(()=>plan.tabs);
  };
  const cueOf=(id:string)=>drag.cue?.target===id?drag.cue:undefined;
  const targetProps=(target:Target,id:string)=>({onDragOver:(event:DragEvent)=>over(event,target,id),onDragLeave:(event:DragEvent)=>drag.leave(event,c=>c.target===id),onDrop:(event:DragEvent)=>drop(event,target)});

  const click=(event:MouseEvent,session:Session)=>{
    if(event.metaKey||event.shiftKey){
      event.preventDefault();const next=new Set(selection.size||!selected?selection:[selected]);
      if(next.has(session.id))next.delete(session.id);else next.add(session.id);props.onSelection(next);return;
    }
    if(selection.size)props.onSelection(new Set());props.onOpen(session);
  };
  const tab=(id:string,color?:string,end=false)=>{
    const s=byId.get(id)!;const active=id===selected;const activity=chatActivity(s),command=terminalCommand(s);const editing=props.renaming===id;
    const size=active||editing||inView.has(id)||!groups.shrink?'':icons.has(id)?'compact':'narrow';
    const run=runs.get(id),partners=run?.filter(v=>v!==id).map(v=>byId.get(v)?.name).join(', ');
    const split=run?`split ${run[0]===id?'split-start':''} ${run.at(-1)===id?'split-end':''} ${inView.has(id)?'split-view':''}`:'';
    return <div key={id} data-tab-id={id} data-attention={activity==='attention'?id:undefined} title={size==='compact'?(tracksActivity(s)?`${s.name}\n${activityLabel[activity]}`:command?`${s.name} · ${command}`:s.name):undefined}
      style={{'--tab-color':color??(s.projectId&&groups.projectColors[s.projectId])??GROUP_COLORS[0].value,...(color?{'--group-color':color}:{})} as CSSProperties}
      onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onAuxClick={event=>{if(event.button===1){event.preventDefault();props.onClose(s);}}}
      onContextMenu={event=>{event.preventDefault();event.stopPropagation();props.onTabMenu(id,event.clientX,event.clientY);}}
      draggable={!editing} onDragStart={event=>props.onDragStart(event,id)} onDragEnd={props.onDragEnd} {...targetProps({tab:id},id)}
      data-split={run?.join(' ')} className={`tab ${split} ${active?'active':''} ${props.dragging===id||!!props.dragging&&!!run?.includes(props.dragging)?'dragging':''} ${color?'grouped':''} ${end?'group-end':''} ${size} ${selection.has(id)?'multi-selected':''} ${editing?'renaming':''}`}>
      {editing?<div className="tab-rename"><AgentIcon launcher={s.launcher} size={14}/><InlineRename initial={s.name} label={`Rename chat ${s.name}`} onDone={name=>props.onRename?.(s,name)}/></div>:
      <button onClick={event=>click(event,s)} onDoubleClick={event=>{if(!event.metaKey&&!event.shiftKey)props.onStartRename?.(id);}} aria-pressed={selection.size?selection.has(id):undefined} aria-description={run?`Split view with ${partners}`:undefined}>{run?.[0]===id&&<Columns2 className="split-mark" size={11} aria-hidden="true"/>}<AgentIcon launcher={s.launcher} size={14}/><span className="tab-name">{s.name}{command&&<span className="terminal-command"> · {command}</span>}</span><ChatStatusIcon session={s}/></button>}
      <button className="tab-close" disabled={props.busy===s.id} aria-label={`Close chat ${s.name}`} title="Close chat and stop its tmux session" onClick={()=>props.onClose(s)}><X size={12}/></button>
      {active&&<><span className="tab-flare left" aria-hidden="true"/><span className="tab-flare right" aria-hidden="true"/></>}
    </div>;
  };
  const chip=(key:string,ids:string[])=>{
    const info=groupInfo(key,groups,props.projects);const folded=isCollapsed(groups,key,selectedKey);const holds=!!selected&&ids.includes(selected);
    const members=ids.map(id=>byId.get(id)!);const summary=folded?rollup(members,s=>chatActivity(s)):undefined;
    const hidden=members.filter(s=>s.id!==selected);
    const toggle=()=>{
      // Focus mode: a chip switches groups; the open group's label folds it (showing the overview).
      if(groups.focus&&selected&&key!==selectedKey){const entry=byId.get(groupEntry(groups,segments,key));if(entry)props.onOpen(entry);return;}
      props.onToggleGroup(key);
    };
    const label=`${info.name} group, ${ids.length} ${ids.length===1?'chat':'chats'}${summary?`, ${activityLabel[summary.activity as ChatStatus].toLowerCase()}`:''}`;
    return <div key={key} data-group-key={key} data-hidden-count={folded?hidden.length:undefined} data-attention={folded?hidden.filter(s=>chatActivity(s)==='attention').map(s=>s.id).join(' '):undefined}
      className={`tab-group-chip ${folded?'collapsed':''} ${folded&&holds?'holds-active':''} ${drag.source===key?'drag-source':''} ${cueOf(key)&&cueOf(key)!.x===undefined?'drop-into':''}`} style={{'--group-color':info.color} as CSSProperties}
      draggable onDragStart={event=>{event.dataTransfer.setData(GROUP,key);event.dataTransfer.effectAllowed='move';drag.setSource(key);}} onDragEnd={()=>drag.setSource(undefined)} {...targetProps({key},key)}
      onContextMenu={event=>{event.preventDefault();event.stopPropagation();props.onGroupMenu(key,event.clientX,event.clientY);}}>
      <span className="chip-pill"><button className="chip-label" aria-expanded={!folded} aria-label={label} title={`${info.name}${info.detail?` · ${info.detail}`:''} · ${ids.length} ${ids.length===1?'chat':'chats'}\n${groups.focus&&selected?(key===selectedKey?'Click to collapse':'Switch to this group'):folded?'Click to expand':'Click to collapse'} · right-click for options`} onClick={toggle}>
        <span className="chip-name">{info.name}</span>{folded&&<span className="chip-count" aria-hidden="true">{ids.length}</span>}
      </button>
      {summary&&<button className="chip-rollup" aria-label={`Open ${summary.item.name}: ${activityLabel[summary.activity as ChatStatus]}`} title={`${activityLabel[summary.activity as ChatStatus]}: ${summary.item.name}${summary.count>1?` (+${summary.count-1} more)`:''}\nClick to open`} onClick={()=>props.onOpen(summary.item)}><StatusIcon activity={summary.activity as ChatStatus}/></button>}{folded&&<UnreadDot sessions={hidden} rollup/>}</span>
    </div>;
  };
  const edge=(side:'left'|'right')=>{const e=edges[side];if(!e.count)return null;const Arrow=side==='left'?ChevronLeft:ChevronRight;
    return <button className={`tab-edge ${side}`} aria-label={`${e.count} more ${e.count===1?'tab':'tabs'} to the ${side}${e.attention?`, ${e.attention} ${e.attention===1?'needs':'need'} input`:''}`} onClick={()=>reveal(side)}>
      {side==='right'?<><span className="edge-pill">{e.count} more<Arrow size={11}/></span>{e.attention>0&&<span className="edge-pill attention"><Bell size={11}/>{e.attention}</span>}</>:<>{e.attention>0&&<span className="edge-pill attention"><Bell size={11}/>{e.attention}</span>}<span className="edge-pill"><Arrow size={11}/>{e.count} more</span></>}
    </button>;};

  return <div className="tab-strip-wrap">
    <div ref={strip} className="tab-strip" onScroll={measure} onWheel={event=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX))event.currentTarget.scrollLeft+=event.deltaY;}}>
      {segments.map(seg=>{
        if(seg.kind==='tab')return tab(seg.id);
        const color=groupInfo(seg.key,groups,props.projects).color;const folded=isCollapsed(groups,seg.key,selectedKey);
        return [chip(seg.key,seg.tabs),...(folded?(selected&&seg.tabs.includes(selected)?[tab(selected,color,true)]:[]):seg.tabs.map((id,i)=>tab(id,color,i===seg.tabs.length-1)))];
      })}
      <button className="icon-button tab-add" aria-label="New chat tab" onClick={props.onNewChat}><Plus size={16}/></button>
    </div>
    {edge('left')}{edge('right')}
    {drag.cue?.x!==undefined&&<span className="tab-drop-caret" style={{left:drag.cue.x}} aria-hidden="true"/>}
  </div>;
}
