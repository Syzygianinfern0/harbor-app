// Where a dragged item will land. Cues are drawn from these plans, and drops apply the same plans,
// so the insertion line always marks the real landing spot; a drop that would change nothing (or land
// somewhere other than the line) has no plan and shows no cue.
import { reorderTabs } from './panes';
import { addToGroup, arrangeTabs, groupTabs, layoutTabs, removeFromGroups, type ProjectOf, type Segment, type TabGroups } from './tabGroups';

export type DropPlace='before'|'after'|'into';
export interface Box {left:number;top:number;width:number;height:number}
/** Pointer side of a box along the list's axis. */
export const dropSide=(box:Box,x:number,y:number,axis:'x'|'y'):'before'|'after'=>axis==='x'?(x>box.left+box.width/2?'after':'before'):(y>box.top+box.height/2?'after':'before');
/** Move `id` before/after `target`; undefined when that changes nothing. */
export function moveItem(ids:string[],id:string,target:string,after:boolean):string[]|undefined {
  if(id===target||!ids.includes(id)||!ids.includes(target))return;
  const next=ids.filter(v=>v!==id);next.splice(next.indexOf(target)+(after?1:0),0,id);
  return next.every((v,i)=>v===ids[i])?undefined:next;
}

export type StripSource={chat:string}|{group:string};
export type StripTarget={tab:string}|{key:string};
export interface StripState {tabs:string[];groups:TabGroups;projectOf:ProjectOf;projectOrder:string[]}
export interface StripPlan {tabs:string[];groups:TabGroups;projectOrder:string[];project?:{source:string;target:string;after:boolean}}
const segKey=(s:Segment)=>s.kind==='tab'?`t:${s.id}`:s.key;
/** The tab strip's drops: a tab moves beside a tab (joining or leaving a custom group with it), a tab drops into a
 *  group chip, and a group moves as a block beside a tab or another group. */
export function planStripDrop(state:StripState,source:StripSource,target:StripTarget,place:DropPlace):StripPlan|undefined {
  const {groups,projectOf,projectOrder}=state;
  const now=layoutTabs(state.tabs,groups,projectOf,projectOrder),arranged=arrangeTabs(now.segments);
  const relayout=(p:StripPlan)=>layoutTabs(p.tabs,p.groups,projectOf,p.projectOrder);
  if('chat' in source){
    const chat=source.chat;
    if('key' in target){
      if(place!=='into')return;const key=target.key;
      const next=key.startsWith('g:')?addToGroup(groups,key.slice(2),[chat]):projectOf(chat)===key.slice(2)?removeFromGroups(groups,[chat]):undefined;if(!next)return;
      const plan={tabs:state.tabs.includes(chat)?state.tabs:[...state.tabs,chat],groups:next,projectOrder};
      const was=now.keyOf.get(chat),lands=relayout(plan).keyOf.get(chat);
      return state.tabs.includes(chat)&&was===lands?undefined:plan;
    }
    const tab=target.tab;if(place==='into'||chat===tab||!arranged.includes(chat)||!arranged.includes(tab))return;
    const to=now.keyOf.get(tab),from=now.keyOf.get(chat);
    const next=to===from?groups:to?.startsWith('g:')?addToGroup(groups,to.slice(2),[chat]):from?.startsWith('g:')?removeFromGroups(groups,[chat]):groups;
    const plan={tabs:reorderTabs(arranged,chat,tab,place==='after'),groups:next,projectOrder};
    // Neighbors as drawn, chips included: landing across a group boundary is not landing beside the tab.
    const after=relayout(plan),order=arrangeTabs(after.segments),drawn=after.segments.flatMap(s=>s.kind==='tab'?[s.id]:[s.key,...s.tabs]);
    const landed=drawn[drawn.indexOf(tab)+(place==='after'?1:-1)]===chat;
    const changed=order.some((v,i)=>v!==arranged[i])||after.keyOf.get(chat)!==from;
    return landed&&changed?plan:undefined;
  }
  const key=source.group;if(place==='into'||!groupTabs(now.segments,key).length)return;
  const targetKey='key' in target?target.key:now.keyOf.get(target.tab);
  const anchorSeg=targetKey?targetKey:'tab' in target?`t:${target.tab}`:undefined;
  if(!anchorSeg||targetKey===key||!now.segments.some(s=>segKey(s)===anchorSeg))return;
  const after=place==='after';let plan:StripPlan;
  if(key.startsWith('p:')&&targetKey?.startsWith('p:')){
    const order=moveItem(projectOrder,key.slice(2),targetKey.slice(2),after);if(!order)return;
    plan={tabs:arranged,groups,projectOrder:order,project:{source:key.slice(2),target:targetKey.slice(2),after}};
  } else {
    const block=groupTabs(now.segments,key),rest=arranged.filter(id=>!block.includes(id));
    const anchor=targetKey?groupTabs(now.segments,targetKey):[(target as {tab:string}).tab];
    rest.splice(after?rest.indexOf(anchor.at(-1)!)+1:rest.indexOf(anchor[0]),0,...block);
    plan={tabs:rest,groups,projectOrder};
  }
  const keys=relayout(plan).segments.map(segKey),was=now.segments.map(segKey);
  const landed=keys[keys.indexOf(anchorSeg)+(after?1:-1)]===key;
  return landed&&keys.some((v,i)=>v!==was[i])?plan:undefined;
}
