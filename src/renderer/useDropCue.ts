import { useEffect, useState, type DragEvent } from 'react';
import { dropSide, moveItem } from '../shared/dropCue';

/** Drag source and drop cue that clear together whenever a drag ends anywhere (drop, dragend, Escape). */
export function useDropCue<S,C>() {
  const [source,setSource]=useState<S>();const [cue,setCue]=useState<C>();
  useEffect(()=>{
    const end=()=>{setSource(undefined);setCue(undefined);};
    addEventListener('drop',end,true);addEventListener('dragend',end,true);
    return()=>{removeEventListener('drop',end,true);removeEventListener('dragend',end,true);};
  },[]);
  const show=(next?:C)=>setCue(v=>JSON.stringify(v)===JSON.stringify(next)?v:next);
  /** Leaving for a child keeps the cue; leaving the target clears it if it is still this target's. */
  const leave=(event:DragEvent,match:(cue:C)=>boolean)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setCue(v=>v!==undefined&&match(v)?undefined:v);};
  return {source,setSource,cue,show,leave};
}

/** A vertical list reordered by dragging: the source dims, a line marks the edge it will land on, and a drop that
 *  would change nothing shows nothing. `ids` is the order as shown; `onMove` applies the same move. */
export function useListReorder(type:string,ids:string[],onMove:(source:string,target:string,after:boolean)=>void) {
  const {source,setSource,cue,show,leave}=useDropCue<string,{id:string;after:boolean}>();
  const after=(event:DragEvent)=>{const r=event.currentTarget.getBoundingClientRect();return dropSide(r,event.clientX,event.clientY,'y')==='after';};
  return {
    source:(id:string)=>({draggable:true,
      onDragStart:(event:DragEvent)=>{event.dataTransfer.setData(type,id);event.dataTransfer.effectAllowed='move';setSource(id);},
      onDragEnd:()=>setSource(undefined)}),
    target:(id:string)=>({
      onDragOver:(event:DragEvent)=>{
        if(!event.dataTransfer.types.includes(type))return;const a=after(event);
        if(!source||!moveItem(ids,source,id,a)){show(undefined);return;}
        event.preventDefault();event.dataTransfer.dropEffect='move';show({id,after:a});
      },
      onDragLeave:(event:DragEvent)=>leave(event,c=>c.id===id),
      onDrop:(event:DragEvent)=>{
        if(!event.dataTransfer.types.includes(type))return;event.preventDefault();
        const from=event.dataTransfer.getData(type),a=after(event);if(moveItem(ids,from,id,a))onMove(from,id,a);
      }}),
    className:(id:string)=>`${source===id?'drag-source':''} ${cue?.id===id?(cue.after?'drop-after':'drop-before'):''}`,
  };
}
