import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { Bell, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import type { Project, Session } from '../shared/types';
import { AgentIcon } from './AgentIcon';
import { ChatStatusIcon, StatusIcon } from './ChatStatusIcon';
import { activityLabel, chatActivity, type ChatStatus } from '../shared/chatStatus';
import { reorderTabs } from '../shared/panes';
import { useTabMotion } from './useTabMotion';
import { addToGroup, arrangeTabs, groupEntry, groupTabs, isCollapsed, layoutTabs, removeFromGroups, rollup, GROUP_COLORS, type TabGroups } from '../shared/tabGroups';

export interface GroupInfo { key:string; name:string; color:string; kind:'project'|'custom'; detail?:string }
export function groupInfo(key:string,groups:TabGroups,projects:Project[]):GroupInfo {
  if(key.startsWith('g:')){const g=groups.custom.find(g=>`g:${g.id}`===key);return {key,kind:'custom',name:g?.name??'Group',color:g?.color??GROUP_COLORS[4].value};}
  const p=projects.find(p=>p.id===key.slice(2));
  return {key,kind:'project',name:p?.name??'Project',color:groups.projectColors[key.slice(2)]??GROUP_COLORS[0].value,detail:p&&p.connection!=='local'?p.hostLabel:undefined};
}
const CHAT='application/x-harbor-chat',GROUP='application/x-harbor-group';
type Edge={count:number;attention:number;target?:string};
const noEdge:Edge={count:0,attention:0};

export interface TabStripProps {
  tabs:string[]; sessions:Session[]; projects:Project[]; groups:TabGroups; selected?:string; selection:Set<string>; busy?:string; dragging?:string;
  onOpen:(session:Session)=>void; onClose:(session:Session)=>void; onSelection:(ids:Set<string>)=>void;
  setTabs:(update:(tabs:string[])=>string[])=>void; setGroups:(update:(groups:TabGroups)=>TabGroups)=>void;
  onDragStart:(event:DragEvent,id:string)=>void; onDragEnd:()=>void; onNewChat:()=>void;
  onToggleGroup:(key:string)=>void; onTabMenu:(id:string,x:number,y:number)=>void; onGroupMenu:(key:string,x:number,y:number)=>void; onMoveProject:(source:string,target:string,after:boolean)=>void;
}

export function TabStrip(props:TabStripProps) {
  const {groups,selected,selection}=props;
  const byId=new Map(props.sessions.map(s=>[s.id,s]));
  const tabs=props.tabs.filter(id=>byId.has(id));
  const {segments,keyOf}=layoutTabs(tabs,groups,id=>byId.get(id)?.projectId,props.projects.map(p=>p.id));
  const selectedKey=selected?keyOf.get(selected):undefined;
  const strip=useRef<HTMLDivElement>(null);
  useTabMotion(strip);
  const [width,setWidth]=useState(0);
  const [shrink,setShrink]=useState(0);
  const [edges,setEdges]=useState<{left:Edge;right:Edge}>({left:noEdge,right:noEdge});

  // Shrink inactive tabs one step at a time until they fit: narrow names, then icons outside the current group, then all icons.
  const fitKey=JSON.stringify([width,groups.shrink,selected,segments.map(s=>s.kind==='tab'?s.id:[s.key,isCollapsed(groups,s.key,selectedKey),s.tabs.map(id=>byId.get(id)?.name)]),tabs.map(id=>byId.get(id)?.name)]);
  const fitted=useRef('');
  useLayoutEffect(()=>{
    const el=strip.current;if(!el)return;
    if(fitted.current!==fitKey){fitted.current=fitKey;if(shrink!==0){setShrink(0);return;}}
    if(groups.shrink&&shrink<3&&el.scrollWidth>el.clientWidth+1)setShrink(shrink+1);
  },[fitKey,shrink,groups.shrink]);
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

  const accepts=(event:DragEvent)=>{const types=event.dataTransfer.types;if(types.includes(CHAT)||types.includes(GROUP)){event.preventDefault();event.dataTransfer.dropEffect='move';}};
  const arranged=arrangeTabs(segments);
  const moveBlock=(key:string,target:{tab?:string;key?:string},after:boolean)=>{
    const block=groupTabs(segments,key);if(!block.length)return;
    props.setTabs(()=>{
      const rest=arranged.filter(id=>!block.includes(id));
      const anchor=target.tab?[target.tab]:groupTabs(segments,target.key!);if(!anchor.length||block.includes(anchor[0]))return arranged;
      const at=after?rest.indexOf(anchor.at(-1)!)+1:rest.indexOf(anchor[0]);rest.splice(at,0,...block);return rest;
    });
  };
  const dropGroup=(source:string,target:{tab?:string;key?:string},after:boolean)=>{
    const targetKey=target.key??(target.tab?keyOf.get(target.tab):undefined);if(targetKey===source)return;
    if(source.startsWith('p:')&&targetKey?.startsWith('p:'))props.onMoveProject(source.slice(2),targetKey.slice(2),after);
    else moveBlock(source,target,after);
  };
  const dropOnTab=(event:DragEvent,target:string)=>{
    event.preventDefault();const bounds=event.currentTarget.getBoundingClientRect();const after=event.clientX>bounds.x+bounds.width/2;
    const group=event.dataTransfer.getData(GROUP),chat=event.dataTransfer.getData(CHAT);props.onDragEnd();
    if(group){dropGroup(group,{tab:target},after);return;}
    if(!chat||chat===target||!tabs.includes(chat))return;
    const targetKey=keyOf.get(target),sourceKey=keyOf.get(chat);
    if(targetKey!==sourceKey)props.setGroups(g=>targetKey?.startsWith('g:')?addToGroup(g,targetKey.slice(2),[chat]):sourceKey?.startsWith('g:')?removeFromGroups(g,[chat]):g);
    props.setTabs(()=>reorderTabs(arranged,chat,target,after));
  };
  const dropOnChip=(event:DragEvent,key:string)=>{
    event.preventDefault();event.stopPropagation();const bounds=event.currentTarget.getBoundingClientRect();
    const group=event.dataTransfer.getData(GROUP),chat=event.dataTransfer.getData(CHAT);props.onDragEnd();
    if(group){dropGroup(group,{key},event.clientX>bounds.x+bounds.width/2);return;}
    const session=chat&&byId.get(chat);if(!session)return;
    if(key.startsWith('g:'))props.setGroups(g=>addToGroup(g,key.slice(2),[chat]));
    else if(session.projectId===key.slice(2))props.setGroups(g=>removeFromGroups(g,[chat]));
    else return;
    // Adding to a folded group keeps it folded; the chip's count is the feedback.
    props.setTabs(v=>v.includes(chat)?v:[...v,chat]);
  };

  const click=(event:MouseEvent,session:Session)=>{
    if(event.metaKey||event.shiftKey){
      event.preventDefault();const next=new Set(selection.size||!selected?selection:[selected]);
      if(next.has(session.id))next.delete(session.id);else next.add(session.id);props.onSelection(next);return;
    }
    if(selection.size)props.onSelection(new Set());props.onOpen(session);
  };
  const tab=(id:string,color?:string,end=false)=>{
    const s=byId.get(id)!;const active=id===selected;const activity=chatActivity(s);
    const size=active||!groups.shrink?'':shrink>=3||(shrink===2&&keyOf.get(id)!==selectedKey)?'compact':shrink>=1?'narrow':'';
    return <div key={id} data-tab-id={id} data-attention={activity==='attention'?id:undefined} title={size==='compact'?`${s.name}\n${activityLabel[activity]}`:undefined}
      style={{'--tab-color':color??(s.projectId&&groups.projectColors[s.projectId])??GROUP_COLORS[0].value,...(color?{'--group-color':color}:{})} as CSSProperties}
      onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onAuxClick={event=>{if(event.button===1){event.preventDefault();props.onClose(s);}}}
      onContextMenu={event=>{event.preventDefault();event.stopPropagation();props.onTabMenu(id,event.clientX,event.clientY);}}
      draggable onDragStart={event=>props.onDragStart(event,id)} onDragEnd={props.onDragEnd} onDragOver={accepts} onDrop={event=>dropOnTab(event,id)}
      className={`tab ${active?'active':''} ${props.dragging===id?'dragging':''} ${color?'grouped':''} ${end?'group-end':''} ${size} ${selection.has(id)?'multi-selected':''}`}>
      <button onClick={event=>click(event,s)} aria-pressed={selection.size?selection.has(id):undefined}><AgentIcon launcher={s.launcher} size={14}/><span className="tab-name">{s.name}</span><ChatStatusIcon session={s}/></button>
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
      className={`tab-group-chip ${folded?'collapsed':''} ${folded&&holds?'holds-active':''}`} style={{'--group-color':info.color} as CSSProperties}
      draggable onDragStart={event=>{event.dataTransfer.setData(GROUP,key);event.dataTransfer.effectAllowed='move';}} onDragOver={accepts} onDrop={event=>dropOnChip(event,key)}
      onContextMenu={event=>{event.preventDefault();event.stopPropagation();props.onGroupMenu(key,event.clientX,event.clientY);}}>
      <span className="chip-pill"><button className="chip-label" aria-expanded={!folded} aria-label={label} title={`${info.name}${info.detail?` · ${info.detail}`:''} · ${ids.length} ${ids.length===1?'chat':'chats'}\n${groups.focus&&selected?(key===selectedKey?'Click to collapse':'Switch to this group'):folded?'Click to expand':'Click to collapse'} · right-click for options`} onClick={toggle}>
        <span className="chip-name">{info.name}</span>{folded&&<span className="chip-count" aria-hidden="true">{ids.length}</span>}
      </button>
      {summary&&<button className="chip-rollup" aria-label={`Open ${summary.item.name}: ${activityLabel[summary.activity as ChatStatus]}`} title={`${activityLabel[summary.activity as ChatStatus]}: ${summary.item.name}${summary.count>1?` (+${summary.count-1} more)`:''}\nClick to open`} onClick={()=>props.onOpen(summary.item)}><StatusIcon activity={summary.activity as ChatStatus}/></button>}</span>
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
  </div>;
}
