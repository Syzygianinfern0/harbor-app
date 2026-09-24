import type { CSSProperties } from 'react';
import type { Project, Session } from '../shared/types';
import { AgentIcon } from './AgentIcon';
import { ChatStatusIcon } from './ChatStatusIcon';
import { chatActivity } from '../shared/chatStatus';
import { ROLLUP_ORDER, type Segment, type TabGroups } from '../shared/tabGroups';
import { groupInfo } from './TabStrip';

// Shown when every open tab is folded away: a zoomed-out view of the working set, most urgent chats first.
export function GroupsOverview({segments,groups,sessions,projects,onOpen,onUnfold}:{segments:Segment[];groups:TabGroups;sessions:Session[];projects:Project[];onOpen:(session:Session)=>void;onUnfold:(key:string)=>void}) {
  const byId=new Map(sessions.map(s=>[s.id,s]));
  const cards=segments.flatMap(s=>s.kind==='group'?[{...groupInfo(s.key,groups,projects),chats:s.tabs.map(id=>byId.get(id)).filter((c):c is Session=>!!c)}]:[]);
  const rank=(s:Session)=>{const i=(ROLLUP_ORDER as readonly string[]).indexOf(chatActivity(s));return i<0?ROLLUP_ORDER.length:i;};
  const waiting=cards.reduce((n,c)=>n+c.chats.filter(s=>chatActivity(s)==='attention').length,0);
  const total=cards.reduce((n,c)=>n+c.chats.length,0);
  return <div className="groups-overview">
    <div className="groups-overview-heading"><div className="eyebrow">ALL GROUPS FOLDED</div><h1>Open chats</h1>
      <p>{total} {total===1?'chat':'chats'} in {cards.length} {cards.length===1?'group':'groups'}{waiting?<> · <span className="attention-text">{waiting} {waiting===1?'needs':'need'} input</span></>:null}. Open a chat, or a group to bring back its tabs.</p></div>
    <div className="group-cards">{cards.map(card=><section key={card.key} className="group-card" style={{'--group-color':card.color} as CSSProperties} aria-label={`${card.name} group`}>
      <button className="group-card-title" onClick={()=>onUnfold(card.key)} title="Unfold this group"><span className="group-card-dot"/><span className="group-card-name">{card.name}</span>{card.detail&&<span className="group-card-detail">{card.detail}</span>}<span className="group-card-count">{card.chats.length}</span></button>
      <div className="group-card-chats">{[...card.chats].sort((a,b)=>rank(a)-rank(b)).map(s=><button key={s.id} className="group-card-chat" onClick={()=>onOpen(s)}><AgentIcon launcher={s.launcher} size={14}/><span className="chat-title">{s.name}</span><ChatStatusIcon session={s}/></button>)}</div>
    </section>)}</div>
  </div>;
}
