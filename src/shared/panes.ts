export type DropSide = 'left'|'right'|'top'|'bottom'|'center';
export type PaneNode = {kind:'pane';sessionId:string} | {kind:'split';id:string;axis:'horizontal'|'vertical';ratio:number;first:PaneNode;second:PaneNode};
export const leaf=(sessionId:string):PaneNode=>({kind:'pane',sessionId});
export function paneIds(node:PaneNode|null):string[] {return !node?[]:node.kind==='pane'?[node.sessionId]:[...paneIds(node.first),...paneIds(node.second)];}
export function removePane(node:PaneNode|null,id:string):PaneNode|null {
  if(!node)return null;
  if(node.kind==='pane')return node.sessionId===id?null:node;
  const first=removePane(node.first,id),second=removePane(node.second,id);
  return first&&second?{...node,first,second}:first??second;
}
export function replacePane(node:PaneNode|null,target:string|undefined,id:string):PaneNode {
  if(!node)return leaf(id);
  if(node.kind==='pane')return node.sessionId===target?leaf(id):node;
  return {...node,first:replacePane(node.first,target,id),second:replacePane(node.second,target,id)};
}
export function dropPane(node:PaneNode|null,target:string,id:string,side:DropSide):PaneNode|null {
  if(target===id||!paneIds(node).includes(target))return node;
  const cleaned=removePane(node,id);
  const insert=(part:PaneNode):PaneNode=>{
    if(part.kind==='split')return {...part,first:insert(part.first),second:insert(part.second)};
    if(part.sessionId!==target)return part;
    if(side==='center')return leaf(id);
    const before=side==='left'||side==='top';
    return {kind:'split',id:crypto.randomUUID(),axis:side==='left'||side==='right'?'horizontal':'vertical',ratio:.5,first:before?leaf(id):part,second:before?part:leaf(id)};
  };
  return cleaned?insert(cleaned):node;
}
export function resizePane(node:PaneNode,id:string,ratio:number):PaneNode {
  if(node.kind==='pane')return node;
  if(node.id===id)return {...node,ratio:Math.max(.05,Math.min(.95,ratio))};
  return {...node,first:resizePane(node.first,id,ratio),second:resizePane(node.second,id,ratio)};
}
export function restorePanes(value:unknown,validIds:string[],seen=new Set<string>()):PaneNode|null {
  if(!value||typeof value!=='object')return null;
  const n=value as PaneNode;
  if(n.kind==='pane') {if(!validIds.includes(n.sessionId)||seen.has(n.sessionId))return null;seen.add(n.sessionId);return leaf(n.sessionId);}
  if(n.kind!=='split'||!['horizontal','vertical'].includes(n.axis))return null;
  const first=restorePanes(n.first,validIds,seen),second=restorePanes(n.second,validIds,seen);
  return first&&second?{kind:'split',id:typeof n.id==='string'?n.id:crypto.randomUUID(),axis:n.axis,ratio:Number.isFinite(n.ratio)?Math.max(.05,Math.min(.95,n.ratio)):.5,first,second}:first??second;
}
export function reorderTabs(tabs:string[],id:string,target:string,after:boolean):string[] {
  if(id===target||!tabs.includes(id)||!tabs.includes(target))return tabs;
  const next=tabs.filter(t=>t!==id);next.splice(next.indexOf(target)+(after?1:0),0,id);return next;
}
