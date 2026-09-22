import { useEffect, useState } from 'react';
import type { ChatPreview, Session } from '../shared/types';
export function ChatPreviewPanel({session,version}:{session:Session;version:number}) {
  const [preview,setPreview]=useState<ChatPreview>();
  useEffect(()=>{let cancelled=false;setPreview(undefined);void window.harbor.chatPreview(session.id).then(value=>{if(!cancelled)setPreview(value);}).catch(error=>{if(!cancelled)setPreview({messages:[],error:error.message});});return()=>{cancelled=true;};},[session.id,session.conversationId,version]);
  if(session.launcher==='shell')return null;
  return <section className="chat-preview" aria-label="Conversation preview"><header><strong>Conversation preview</strong><span>{preview?.messageCount!==undefined?`${preview.messageCount} messages`:''}</span></header>{!preview?<p>Loading saved messages…</p>:preview.error?<p>{preview.error}</p>:preview.messages.length?preview.messages.map((message,i)=><article key={i}><strong>{message.role==='user'?'You':'Assistant'}</strong><p>{message.text}</p></article>):<p>No text messages saved yet.</p>}</section>;
}
