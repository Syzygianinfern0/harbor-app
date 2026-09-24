import { leaf, paneIds, removePane, type PaneNode } from './panes';

/** The view after folding groups: their panes leave the layout, and the selection moves to the most recently
 *  used chat still on screen, else still in the strip. `null` means nothing is left to show (the groups overview). */
export function foldView(layout:PaneNode|null,selected:string|undefined,hidden:string[],shown:string[],recent:string[]):{layout:PaneNode|null;selected?:string} {
  let tree=layout;for(const id of hidden)tree=removePane(tree,id);
  const panes=paneIds(tree);const pick=(ids:string[])=>recent.find(id=>ids.includes(id))??ids[0];
  if(selected&&panes.includes(selected))return {layout:tree,selected};
  if(panes.length)return {layout:tree,selected:pick(panes)};
  const next=pick(shown.filter(id=>!hidden.includes(id)));
  return next?{layout:leaf(next),selected:next}:{layout:null};
}
/** The part of a layout made of the given chats, kept so a folded group can restore its split. */
export function splitFor(layout:PaneNode|null,ids:string[]):PaneNode|null {
  let tree=layout;for(const id of paneIds(layout))if(!ids.includes(id))tree=removePane(tree,id);
  return tree;
}
