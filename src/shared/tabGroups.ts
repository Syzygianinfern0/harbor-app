// Tab groups organize the open tabs (the working set) without ever closing a chat.
// Keys: `p:<projectId>` for automatic project groups, `g:<id>` for custom groups.
import { joinSplits } from './splits';
export const GROUP_COLORS = [
  {name:'Mint',value:'#9be1c4'},{name:'Blue',value:'#8fb4e8'},{name:'Amber',value:'#e2c07f'},{name:'Violet',value:'#b9a3e6'},
  {name:'Rose',value:'#e3a1a8'},{name:'Teal',value:'#7fd0d6'},{name:'Orange',value:'#e5ab80'},{name:'Grey',value:'#a3adbb'},
] as const;
const colorValues:string[]=GROUP_COLORS.map(c=>c.value);

export interface CustomGroup { id:string; name:string; color:string; collapsed:boolean; members:string[] }
export interface TabGroups {
  byProject:boolean; focus:boolean; shrink:boolean;
  custom:CustomGroup[]; projectCollapsed:string[]; projectColors:Record<string,string>; lastActive:Record<string,string>;
}
export type Segment = {kind:'tab';id:string} | {kind:'group';key:string;tabs:string[]};
export type ProjectOf = (id:string)=>string|undefined;

export const defaultTabGroups=():TabGroups=>({byProject:true,focus:false,shrink:true,custom:[],projectCollapsed:[],projectColors:{},lastActive:{}});

const strings=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((v):v is string=>typeof v==='string'))]:[];
const record=(value:unknown)=>Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter((e):e is [string,string]=>typeof e[1]==='string'));
export function restoreTabGroups(value:unknown):TabGroups {
  const base=defaultTabGroups();if(!value||typeof value!=='object')return base;
  const v=value as Partial<TabGroups>;const seen=new Set<string>();
  const custom=(Array.isArray(v.custom)?v.custom:[]).flatMap(g=>{
    if(!g||typeof g!=='object'||typeof g.id!=='string'||seen.has(g.id))return [];seen.add(g.id);
    const members=strings(g.members);return members.length?[{id:g.id,name:typeof g.name==='string'&&g.name.trim()?g.name.trim().slice(0,60):'Group',color:colorValues.includes(g.color)?g.color:colorValues[4],collapsed:g.collapsed===true,members}]:[];
  });
  const colors=Object.fromEntries(Object.entries(record(v.projectColors)).filter(([,c])=>colorValues.includes(c)));
  return {byProject:typeof v.byProject==='boolean'?v.byProject:base.byProject,focus:v.focus===true,shrink:typeof v.shrink==='boolean'?v.shrink:base.shrink,custom,projectCollapsed:strings(v.projectCollapsed),projectColors:colors,lastActive:record(v.lastActive)};
}

/** Group every tab, gathering each group at its first tab's position. Project groups follow the sidebar's project order.
 *  A lone project group (every tab from one project, nothing else) is not shown: a label would add nothing.
 *  A split's tabs are gathered first, so within a group they sit side by side. */
export function layoutTabs(given:string[],state:TabGroups,projectOf:ProjectOf,projectOrder:string[]=[],splits:string[][]=[]) {
  const tabs=joinSplits(given,splits);
  const raw=tabs.map(id=>{const g=state.custom.find(g=>g.members.includes(id));if(g)return `g:${g.id}`;const p=state.byProject?projectOf(id):undefined;return p?`p:${p}`:undefined;});
  const distinct=new Set(raw);const solo=distinct.size===1&&raw[0]?.startsWith('p:');
  const keyOf=new Map<string,string|undefined>(tabs.map((id,i)=>[id,solo?undefined:raw[i]]));
  const segments:Segment[]=[];const index=new Map<string,Extract<Segment,{kind:'group'}>>();
  for(const id of tabs){const key=keyOf.get(id);if(!key){segments.push({kind:'tab',id});continue;}
    let seg=index.get(key);if(!seg){seg={kind:'group',key,tabs:[]};index.set(key,seg);segments.push(seg);}seg.tabs.push(id);}
  const rank=(key:string)=>{const i=projectOrder.indexOf(key.slice(2));return i<0?Number.MAX_SAFE_INTEGER:i;};
  const slots=segments.flatMap((s,i)=>s.kind==='group'&&s.key.startsWith('p:')?[i]:[]);
  const sorted=slots.map(i=>segments[i] as Extract<Segment,{kind:'group'}>).sort((a,b)=>rank(a.key)-rank(b.key));
  slots.forEach((slot,i)=>{segments[slot]=sorted[i];});
  return {segments,keyOf};
}
export const arrangeTabs=(segments:Segment[])=>segments.flatMap(s=>s.kind==='tab'?[s.id]:s.tabs);

export function isCollapsed(state:TabGroups,key:string,selectedKey?:string) {
  if(state.focus)return key!==selectedKey;
  return key.startsWith('g:')?!!state.custom.find(g=>`g:${g.id}`===key)?.collapsed:state.projectCollapsed.includes(key.slice(2));
}
/** Tabs as shown in the strip: expanded groups, plus the selected tab beside its folded group. */
export function stripTabs(segments:Segment[],state:TabGroups,selected?:string) {
  const selectedKey=segments.find((s):s is Extract<Segment,{kind:'group'}>=>s.kind==='group'&&!!selected&&s.tabs.includes(selected))?.key;
  return segments.flatMap(s=>s.kind==='tab'?[s.id]:!isCollapsed(state,s.key,selectedKey)?s.tabs:selected&&s.tabs.includes(selected)?[selected]:[]);
}
export function groupKeys(segments:Segment[]) {return segments.flatMap(s=>s.kind==='group'?[s.key]:[]);}
export function groupTabs(segments:Segment[],key:string) {const s=segments.find(s=>s.kind==='group'&&s.key===key);return s?.kind==='group'?s.tabs:[];}
/** The tab to open when switching to a group: the last one used there, else its first. */
export function groupEntry(state:TabGroups,segments:Segment[],key:string) {const tabs=groupTabs(segments,key);const last=state.lastActive[key];return last&&tabs.includes(last)?last:tabs[0];}

export function setCollapsed(state:TabGroups,key:string,collapsed:boolean):TabGroups {
  if(key.startsWith('g:'))return {...state,custom:state.custom.map(g=>`g:${g.id}`===key?{...g,collapsed}:g)};
  const id=key.slice(2);const rest=state.projectCollapsed.filter(p=>p!==id);
  return {...state,projectCollapsed:collapsed?[...rest,id]:rest};
}
export function removeFromGroups(state:TabGroups,ids:string[]):TabGroups {
  return {...state,custom:state.custom.map(g=>({...g,members:g.members.filter(m=>!ids.includes(m))})).filter(g=>g.members.length)};
}
export function createGroup(state:TabGroups,ids:string[],avoid:string[]=[]):{state:TabGroups;id:string} {
  const cleared=removeFromGroups(state,ids);const used=new Set([...cleared.custom.map(g=>g.color),...avoid]);
  const color=colorValues.find(c=>!used.has(c))??colorValues.find(c=>!cleared.custom.some(g=>g.color===c))??colorValues[4];
  const id=Math.random().toString(36).slice(2,10);let n=cleared.custom.length+1;const names=new Set(cleared.custom.map(g=>g.name));while(names.has(`Group ${n}`))n++;
  return {id,state:{...cleared,custom:[...cleared.custom,{id,name:`Group ${n}`,color,collapsed:false,members:[...new Set(ids)]}]}};
}
export function addToGroup(state:TabGroups,groupId:string,ids:string[]):TabGroups {
  const cleared=removeFromGroups(state,ids.filter(id=>!state.custom.find(g=>g.id===groupId)?.members.includes(id)));
  return {...cleared,custom:cleared.custom.map(g=>g.id===groupId?{...g,members:[...new Set([...g.members,...ids])]}:g)};
}
export function updateGroup(state:TabGroups,groupId:string,patch:Partial<Pick<CustomGroup,'name'|'color'>>):TabGroups {
  return {...state,custom:state.custom.map(g=>g.id===groupId?{...g,...patch,name:patch.name!==undefined?(patch.name.trim().slice(0,60)||g.name):g.name}:g)};
}
export function ungroup(state:TabGroups,groupId:string):TabGroups {return {...state,custom:state.custom.filter(g=>g.id!==groupId)};}
/** Drop closed tabs from custom groups. Returns the same object when nothing changed. */
export function pruneGroups(state:TabGroups,tabs:string[]):TabGroups {
  const open=new Set(tabs);if(state.custom.every(g=>g.members.every(m=>open.has(m))))return state;
  return {...state,custom:state.custom.map(g=>({...g,members:g.members.filter(m=>open.has(m))})).filter(g=>g.members.length)};
}
/** Give every project a stable color, least-used first. Returns the same object when nothing changed. */
export function assignProjectColors(state:TabGroups,projectIds:string[]):TabGroups {
  const missing=projectIds.filter(id=>!state.projectColors[id]);if(!missing.length)return state;
  const colors={...state.projectColors};
  for(const id of missing){const count=(c:string)=>Object.values(colors).filter(v=>v===c).length;colors[id]=[...colorValues].sort((a,b)=>count(a)-count(b)||colorValues.indexOf(a)-colorValues.indexOf(b))[0];}
  return {...state,projectColors:colors};
}
/** The one status worth reporting for a folded group: the most urgent, then the item that has it. */
export const ROLLUP_ORDER=['attention','error','completed','background','working','starting'] as const;
export function rollup<T>(items:T[],activity:(item:T)=>string) {
  for(const status of ROLLUP_ORDER){const hits=items.filter(i=>activity(i)===status);if(hits.length)return {activity:status,item:hits[0],count:hits.length};}
  return undefined;
}
