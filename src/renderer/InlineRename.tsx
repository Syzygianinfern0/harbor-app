import { useRef } from 'react';

// An in-place name field: Enter or clicking away saves, Escape cancels. onDone gets the new name, or undefined when cancelled.
export function InlineRename({initial,label,onDone}:{initial:string;label:string;onDone:(name?:string)=>void}) {
  const done=useRef(false);
  const finish=(name?:string)=>{if(done.current)return;done.current=true;onDone(name);};
  const stop=(event:{stopPropagation:()=>void})=>event.stopPropagation();
  return <input className="inline-rename" aria-label={label} defaultValue={initial} maxLength={100} autoFocus spellCheck={false}
    onFocus={event=>event.currentTarget.select()} onBlur={event=>finish(event.currentTarget.value)}
    onKeyDown={event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();finish(event.currentTarget.value);}else if(event.key==='Escape'){event.preventDefault();finish();}}}
    onClick={stop} onDoubleClick={stop} onMouseDown={stop} onContextMenu={stop}/>;
}

// Saves an inline rename through the same update call as the Rename dialog; blank or unchanged names are left alone.
export async function saveChatName(id:string,current:string,name:string|undefined,report:(message:string)=>void) {
  const next=name?.trim();if(!next||next===current)return;
  try{await window.harbor.update(id,{name:next});}catch(error){report((error as Error).message);}
}
