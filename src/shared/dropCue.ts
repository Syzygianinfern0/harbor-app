// Where a dragged item will land. Cues are drawn from these plans, and drops apply the same plans,
// so the insertion line always marks the real landing spot; a drop that would change nothing (or land
// somewhere other than the line) has no plan and shows no cue.
import { splitRuns } from './splits';
import { addToGroup, arrangeTabs, groupTabs, layoutTabs, removeFromGroups, SETTINGS_TAB, type ProjectOf, type Segment, type TabGroups } from './tabGroups';

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
export interface StripState {tabs:string[];groups:TabGroups;projectOf:ProjectOf;projectOrder:string[];splits?:string[][]}
export interface StripPlan {tabs:string[];groups:TabGroups;projectOrder:string[];project?:{source:string;target:string;after:boolean}}
const segKey=(s:Segment)=>s.kind==='tab'?`t:${s.id}`:s.key;
/** A split's tabs as they sit together in the strip; they move as one. */
export const stripRuns=(segments:Segment[],splits:string[][]=[])=>splitRuns(segments.flatMap(s=>s.kind==='tab'?[s.id]:[undefined,...s.tabs,undefined]),splits);
/** The tab strip's drops: a tab moves beside a tab (joining or leaving a custom group with it), a tab drops into a
 *  group chip, and a group moves as a block beside a tab or another group. A split's tabs move (and join groups) together,
 *  and nothing lands between them. */
/** Settings never joins a group: like a group, it lands beside a whole group (its chip or any of its tabs) or beside an ungrouped tab. */
function placeSettings(state:StripState,target:StripTarget,place:DropPlace):StripPlan|undefined {
  const {groups,projectOf,projectOrder}=state;if(place==='into')return;
  const now=layoutTabs(state.tabs,groups,projectOf,projectOrder,state.splits),arranged=arrangeTabs(now.segments);if(!arranged.includes(SETTINGS_TAB))return;
  const runs=stripRuns(now.segments,state.splits);
  const targetKey='key' in target?target.key:now.keyOf.get(target.tab),after=place==='after';
  const anchor=targetKey?groupTabs(now.segments,targetKey):runs.get((target as {tab:string}).tab)??[(target as {tab:string}).tab];
  if(!anchor.length||anchor.includes(SETTINGS_TAB))return;
  const anchorSeg=targetKey??`t:${after?anchor.at(-1):anchor[0]}`;
  const rest=arranged.filter(id=>id!==SETTINGS_TAB);if(!anchor.every(id=>rest.includes(id)))return;
  rest.splice(after?rest.indexOf(anchor.at(-1)!)+1:rest.indexOf(anchor[0]),0,SETTINGS_TAB);
  const plan={tabs:rest,groups,projectOrder};
  const keys=layoutTabs(rest,groups,projectOf,projectOrder,state.splits).segments.map(segKey),was=now.segments.map(segKey);
  return keys[keys.indexOf(anchorSeg)+(after?1:-1)]===`t:${SETTINGS_TAB}`&&keys.some((v,i)=>v!==was[i])?plan:undefined;
}
export function planStripDrop(state:StripState,source:StripSource,target:StripTarget,place:DropPlace):StripPlan|undefined {
  const {groups,projectOf,projectOrder}=state;
  const now=layoutTabs(state.tabs,groups,projectOf,projectOrder,state.splits),arranged=arrangeTabs(now.segments);
  const relayout=(p:StripPlan)=>layoutTabs(p.tabs,p.groups,projectOf,p.projectOrder,state.splits);
  const runs=stripRuns(now.segments,state.splits),runOf=(id:string)=>runs.get(id)??[id];
  if('chat' in source){
    const chat=source.chat,block=runOf(chat);
    if(chat===SETTINGS_TAB)return placeSettings(state,target,place);
    if('key' in target){
      if(place!=='into')return;const key=target.key,open=state.tabs.includes(chat),moving=open?block:[chat],own=moving.filter(id=>projectOf(id)===key.slice(2));
      const next=key.startsWith('g:')?addToGroup(groups,key.slice(2),moving):own.length?removeFromGroups(groups,own):undefined;if(!next)return;
      const plan={tabs:open?state.tabs:[...state.tabs,chat],groups:next,projectOrder};
      const lands=relayout(plan).keyOf;
      return open&&moving.every(id=>now.keyOf.get(id)===lands.get(id))?undefined:plan;
    }
    const tab=target.tab;if(place==='into'||block.includes(tab)||!arranged.includes(chat)||!arranged.includes(tab))return;
    const to=now.keyOf.get(tab),anchor=runOf(tab),after=place==='after';
    const next=block.reduce((g,id)=>{const from=now.keyOf.get(id);return to===from?g:to?.startsWith('g:')?addToGroup(g,to.slice(2),[id]):from?.startsWith('g:')?removeFromGroups(g,[id]):g;},groups);
    const rest=arranged.filter(id=>!block.includes(id));rest.splice(after?rest.indexOf(anchor.at(-1)!)+1:rest.indexOf(anchor[0]),0,...block);
    const plan={tabs:rest,groups:next,projectOrder};
    // Neighbors as drawn, chips included: landing across a group boundary is not landing beside the tab.
    const laid=relayout(plan),order=arrangeTabs(laid.segments),drawn=laid.segments.flatMap(s=>s.kind==='tab'?[s.id]:[s.key,...s.tabs]);
    const landed=drawn[drawn.indexOf(after?anchor.at(-1)!:anchor[0])+(after?1:-1)]===(after?block[0]:block.at(-1));
    const changed=order.some((v,i)=>v!==arranged[i])||block.some(id=>laid.keyOf.get(id)!==now.keyOf.get(id));
    return landed&&changed?plan:undefined;
  }
  const key=source.group;if(place==='into'||!groupTabs(now.segments,key).length)return;
  const targetKey='key' in target?target.key:now.keyOf.get(target.tab);
  const lone='tab' in target&&!targetKey?runOf(target.tab):undefined;
  const anchorSeg=targetKey?targetKey:lone?`t:${place==='after'?lone.at(-1):lone[0]}`:undefined;
  if(!anchorSeg||targetKey===key||!now.segments.some(s=>segKey(s)===anchorSeg))return;
  const after=place==='after';let plan:StripPlan;
  if(key.startsWith('p:')&&targetKey?.startsWith('p:')){
    const order=moveItem(projectOrder,key.slice(2),targetKey.slice(2),after);if(!order)return;
    plan={tabs:arranged,groups,projectOrder:order,project:{source:key.slice(2),target:targetKey.slice(2),after}};
  } else {
    const block=groupTabs(now.segments,key),rest=arranged.filter(id=>!block.includes(id));
    const anchor=targetKey?groupTabs(now.segments,targetKey):lone!;
    rest.splice(after?rest.indexOf(anchor.at(-1)!)+1:rest.indexOf(anchor[0]),0,...block);
    plan={tabs:rest,groups,projectOrder};
  }
  const keys=relayout(plan).segments.map(segKey),was=now.segments.map(segKey);
  const landed=keys[keys.indexOf(anchorSeg)+(after?1:-1)]===key;
  return landed&&keys.some((v,i)=>v!==was[i])?plan:undefined;
}
