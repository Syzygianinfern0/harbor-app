// Split views as linked tabs (after Chrome's split view): chats tiled together stay one unit. The view shows one layout;
// splits you switch away from are parked and come back whole when you click any of their tabs. In the strip, a split's
// tabs sit side by side in pane order (left/top first) inside one shared outline.
import { leaf, paneIds, removePane, restorePanes, type PaneNode } from './panes';

/** Every split's chats in pane order: the shown layout (when it is tiled) first, then the parked ones. */
export const splitSets=(layout:PaneNode|null,parked:PaneNode[]):string[][]=>[...(paneIds(layout).length>1?[layout!]:[]),...parked].map(paneIds);
/** Show a tab: within the view it only takes focus; a parked split's tab brings its whole split back; any other tab shows alone.
 *  A tiled view that is left is parked, never broken up. */
export function showTab(layout:PaneNode|null,parked:PaneNode[],id:string):{layout:PaneNode;parked:PaneNode[]} {
  if(layout&&paneIds(layout).includes(id))return {layout,parked};
  const home=parked.find(s=>paneIds(s).includes(id));
  return {layout:home??leaf(id),parked:[...parked.filter(s=>s!==home),...(paneIds(layout).length>1?[layout!]:[])]};
}
/** Parked splits still worth keeping: chats now in the view or no longer open leave them (closing one tab collapses a
 *  pair into a plain tab), and a chat is in one split at most. Returns the same array when nothing changed. */
export function liveParked(parked:PaneNode[],layout:PaneNode|null,open:string[]):PaneNode[] {
  const gone=new Set(paneIds(layout)),openIds=new Set(open);
  const next=parked.flatMap(split=>{
    let tree:PaneNode|null=split;for(const id of paneIds(split))if(gone.has(id)||!openIds.has(id))tree=removePane(tree,id);
    const ids=paneIds(tree);ids.forEach(id=>gone.add(id));return tree&&ids.length>1?[tree]:[];
  });
  return JSON.stringify(next)===JSON.stringify(parked)?parked:next;
}
export function restoreParked(value:unknown,validIds:string[],seen:Set<string>):PaneNode[] {
  return (Array.isArray(value)?value:[]).flatMap(v=>{const tree=restorePanes(v,validIds,seen);return tree&&paneIds(tree).length>1?[tree]:[];});
}
/** Tab order with each split's open tabs gathered, in pane order, where its first tab sits. */
export function joinSplits(tabs:string[],splits:string[][]):string[] {
  let order=tabs;
  for(const set of splits){
    const members=set.filter(id=>order.includes(id));if(members.length<2)continue;
    const start=order.findIndex(id=>members.includes(id)),rest=order.filter(id=>!members.includes(id));
    rest.splice(start,0,...members);order=rest;
  }
  return order;
}
/** Runs of adjacent tabs from one split, keyed by each member. `undefined` in the sequence breaks runs (a group edge). */
export function splitRuns(sequence:(string|undefined)[],splits:string[][]):Map<string,string[]> {
  const setOf=new Map(splits.flatMap((s,i)=>s.map(id=>[id,i] as const)));const runs=new Map<string,string[]>();
  let run:string[]=[],current:number|undefined;
  const flush=()=>{for(const id of run)runs.set(id,run);run=[];};
  for(const id of sequence){const set=id===undefined?undefined:setOf.get(id);if(set!==current)flush();current=set;if(set!==undefined)run.push(id!);}
  flush();return runs;
}
