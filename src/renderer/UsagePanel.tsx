import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, DollarSign, RefreshCw, X } from 'lucide-react';
import type { ChatUsage, CostAmount, CostModel, HostUsage, Session, UsagePeriod } from '../shared/types';

const count=(value:number)=>value.toLocaleString();
const money=(value:number)=>value>0&&value<0.01?'<$0.01':value.toLocaleString('en-US',{style:'currency',currency:'USD'});
const blank=():CostAmount=>({usd:0,estimated:0,recorded:0,unpriced:0});
const sum=(rows:CostAmount[])=>rows.reduce((a,b)=>({usd:a.usd+b.usd,estimated:a.estimated+b.estimated,recorded:a.recorded+b.recorded,unpriced:a.unpriced+b.unpriced}),blank());
const price=(cost:CostAmount,available=true)=>!available||(!cost.estimated&&!cost.recorded&&cost.unpriced)?'Unavailable':`${cost.estimated?'≈ ':''}${money(cost.usd)}`;
const ranges=[['day','Last 24 hours'],['week','Last week'],['month','Last month']] as const;
export function useHostUsage(version:number,configuration:string) {
  const [hosts,setHosts]=useState<HostUsage[]>(); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let cancelled=false,pending=false;
    const run=async()=>{if(pending)return;pending=true;setBusy(true);setError('');try{const value=await window.harbor.usage();if(!cancelled)setHosts(value);}catch(error){if(!cancelled)setError((error as Error).message);}finally{pending=false;if(!cancelled)setBusy(false);}};
    void run();const timer=setInterval(()=>void run(),60000);return()=>{cancelled=true;clearInterval(timer);};
  },[version,configuration,refresh]);
  return {hosts,busy,error,refresh:useCallback(()=>setRefresh(v=>v+1),[])};
}
export type UsageState=ReturnType<typeof useHostUsage>;
type Row=CostModel&{host:string;hostId:string;agent:string;day?:string};
function summary(hosts:HostUsage[]|undefined,period:UsagePeriod) {
  const rows:Row[]=[];const days:Row[]=[];
  for(const host of hosts??[])for(const agent of host.agents){
    const cost=agent.periods[period]?.cost;
    for(const model of cost?.models??[])rows.push({...model,host:host.hostLabel,hostId:host.hostId,agent:agent.agent});
    for(const day of cost?.days??[])days.push({...day,host:host.hostLabel,hostId:host.hostId,agent:agent.agent});
  }
  const available=!!hosts?.some(h=>!h.error&&h.agents.some(a=>!!a.periods[period]?.cost));
  const total=sum(rows);
  const partial=!!hosts?.some(h=>h.error||h.agents.some(a=>a.partial||a.recordedSessions<a.sessions))||total.unpriced>0;
  return {rows,days,total,partial,available};
}
function Ranges({period,onChange}:{period:UsagePeriod;onChange:(period:UsagePeriod)=>void}) {
  return <div className="cost-ranges" role="group" aria-label="Usage time range">{ranges.map(([key,label])=><button key={key} aria-pressed={period===key} onClick={()=>onChange(key)}>{label}</button>)}</div>;
}
function Amount({cost,available=true}:{cost:CostAmount;available?:boolean}) {return <span className="cost-amount" title={cost.unpriced?`${cost.unpriced} usage records have no known price`:cost.estimated?'Estimated from saved usage and model API prices':'Recorded cost'}>{price(cost,available)}{cost.unpriced>0&&(cost.estimated+cost.recorded)>0?' + unknown':''}</span>;}
function CostNotes({state,partial}:{state:UsageState;partial:boolean}) {
  const dates=state.hosts?.map(h=>h.pricingUpdatedAt).filter((v):v is string=>!!v).sort();
  return <div className="cost-notes">{state.error&&<p role="alert">{state.error}</p>}{partial&&<p className="cost-warning">Partial coverage · some usage or host data is unavailable.</p>}<p>USD · ≈ marks estimates at model API rates. Recorded costs are used when present. Subscription charges and credits are not included.</p><p>All saved chats and subagents on configured hosts. Copies on separate hosts count on each host.{dates?.length?` Prices updated ${new Date(dates[0]).toLocaleDateString()}.`:''}</p></div>;
}
function HostRows({hosts,period}:{hosts:HostUsage[];period:UsagePeriod}) {
  return <div className="cost-hosts">{hosts.map(host=>{
    const costs=host.agents.map(a=>a.periods[period]?.cost).filter((c):c is NonNullable<typeof c>=>!!c);
    const models=new Map<string,CostAmount>();for(const cost of costs)for(const model of cost.models)models.set(model.model,sum([models.get(model.model)??blank(),model]));
    return <section key={host.hostId}><div className="cost-row cost-host"><strong>{host.hostLabel}</strong><Amount cost={sum(costs)} available={!host.error&&!!costs.length}/></div>{host.error?<p className="cost-warning" title={host.error}>Host unavailable</p>:<>{[...models].sort((a,b)=>b[1].usd-a[1].usd).map(([model,cost])=><div className="cost-row cost-model" key={model}><span>{model}</span><Amount cost={cost}/></div>)}{host.agents.some(a=>a.partial||a.recordedSessions<a.sessions)&&<p className="cost-warning">Some saved usage is unavailable</p>}</>}</section>;
  })}</div>;
}
export function SidebarCost({state,onDetails,collapsed=false}:{state:UsageState;onDetails:()=>void;collapsed?:boolean}) {
  const [open,setOpen]=useState(false); const [period,setPeriod]=useState<UsagePeriod>('day');const button=useRef<HTMLButtonElement>(null);const popup=useRef<HTMLDivElement>(null);
  const day=summary(state.hosts,'day');const selected=summary(state.hosts,period);
  useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!popup.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('mousedown',close);document.addEventListener('keydown',key);popup.current?.focus();return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};},[open]);
  const rect=button.current?.getBoundingClientRect();
  return <><button ref={button} className={`sidebar-cost ${collapsed?'sidebar-cost-collapsed':''}`} aria-label="Usage cost in the last 24 hours" aria-expanded={open} onClick={()=>setOpen(v=>!v)} title={`Last 24 hours · ${state.hosts?price(day.total,day.available):'Loading usage'}${day.partial?' · partial coverage':''}`}><DollarSign size={13}/>{!collapsed&&<><span>24h</span><span className="sidebar-cost-value">{state.hosts?price(day.total,day.available):state.error?'Unavailable':'…'}{day.partial?' *':''}</span><ChevronRight size={12}/></>}</button>{open&&createPortal(<div ref={popup} tabIndex={-1} className="cost-popover" role="dialog" aria-label="Usage cost" style={{left:Math.min(rect?.left??16,Math.max(8,window.innerWidth-396)),bottom:Math.max(12,window.innerHeight-(rect?.top??window.innerHeight)+8)}}><header><strong>Usage cost</strong><button className="icon-button" aria-label="Close usage cost" onClick={()=>{setOpen(false);button.current?.focus();}}><X size={15}/></button></header><Ranges period={period} onChange={setPeriod}/><div className="cost-popover-total"><Amount cost={selected.total} available={selected.available}/><small>All available hosts{selected.partial?' · partial':''}</small></div>{!state.hosts&&<p role="status">{state.error||'Reading saved usage…'}</p>}<HostRows hosts={state.hosts??[]} period={period}/><CostNotes state={state} partial={selected.partial}/><button className="cost-details-button" onClick={()=>{setOpen(false);onDetails();}}>View detailed usage<ChevronRight size={14}/></button></div>,document.body)}</>;
}
export function UsagePanel({state}:{state:UsageState}) {
  const [period,setPeriod]=useState<UsagePeriod>('day');const [group,setGroup]=useState('host');const data=summary(state.hosts,period);
  const groups=new Map<string,Row[]>();for(const row of group==='day'?data.days:data.rows){const key=group==='host'?row.hostId:group==='model'?row.model:row.day!;groups.set(key,[...(groups.get(key)??[]),row]);}
  const sorted=[...groups].sort((a,b)=>group==='day'?b[0].localeCompare(a[0]):sum(b[1]).usd-sum(a[1]).usd);
  return <div className="usage-panel cost-panel"><div className="usage-heading"><h3>Usage cost</h3><button className="secondary-button" disabled={state.busy} onClick={state.refresh}><RefreshCw size={13} className={state.busy?'spin':''}/>Refresh usage</button></div><Ranges period={period} onChange={setPeriod}/><div className="cost-total"><div><small>All available hosts{data.partial?' · partial coverage':''}</small><strong><Amount cost={data.total} available={data.available}/></strong></div><span>Rolling {period==='day'?'24 hours':period==='week'?'7 days':'30 days'}</span></div>{state.busy&&<p className="preferences-note" role="status">Updating usage…</p>}<label className="cost-group-control">Group by<select aria-label="Group usage by" value={group} onChange={e=>setGroup(e.target.value)}><option value="host">Host → Model</option><option value="model">Model → Host</option><option value="day">Day → Host → Model</option></select></label><div className="cost-table">{sorted.map(([key,rows])=><section key={key}><div className="cost-row cost-group"><strong>{group==='host'?rows[0].host:key}</strong><Amount cost={sum(rows)}/></div>{rows.sort((a,b)=>b.usd-a.usd).map((row,index)=><div className="cost-row cost-model" key={index}><span>{group==='host'?row.model:group==='model'?row.host:`${row.host} · ${row.model}`}<small>{row.agent==='codex'?'Codex':'Claude Code'}</small></span><Amount cost={row}/></div>)}</section>)}</div>{state.hosts?.filter(h=>h.error).map(h=><div className="cost-row cost-unavailable" key={h.hostId}><span>{h.hostLabel}<small>{h.error}</small></span><span>Unavailable</span></div>)}{data.available&&!data.rows.length&&<p className="preferences-note">No usage recorded in this time range.</p>}<CostNotes state={state} partial={data.partial}/><p className="preferences-note">Day groups use UTC. Time ranges are rolling windows. Unpriced records are excluded from the displayed subtotal.</p></div>;
}
function ChatCost({usage,active}:{usage:ChatUsage;active:boolean}) {
  const [open,setOpen]=useState(false);const button=useRef<HTMLButtonElement>(null);const popup=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!popup.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node))setOpen(false);};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('mousedown',close);document.addEventListener('keydown',key);popup.current?.focus();return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};},[open]);
  useEffect(()=>{if(!active)setOpen(false);},[active]);
  if(!usage.cost)return <span className="chat-cost">Cost unavailable</span>;
  const cost=usage.cost;const rect=button.current?.getBoundingClientRect();
  return <><button ref={button} className="chat-cost" aria-label="Chat total cost" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Amount cost={cost} available={!!(cost.estimated+cost.recorded+cost.unpriced)||usage.tokens?.totalTokens===0}/></button>{open&&createPortal(<div ref={popup} tabIndex={-1} className="cost-popover chat-cost-popover" role="dialog" aria-label="Chat total cost" style={{left:Math.max(8,Math.min(rect?.left??8,window.innerWidth-348)),top:Math.min((rect?.bottom??80)+8,window.innerHeight-260)}}><header><strong>This chat · total cost</strong><button className="icon-button" aria-label="Close chat total cost" onClick={()=>{setOpen(false);button.current?.focus();}}><X size={15}/></button></header>{cost.models.map(model=><div className="cost-row" key={model.model}><span>{model.model}</span><Amount cost={model}/></div>)}<div className="cost-row cost-group"><strong>Total</strong><Amount cost={cost} available={!!(cost.estimated+cost.recorded+cost.unpriced)||usage.tokens?.totalTokens===0}/></div><p className="cost-notes">USD · entire conversation. ≈ indicates an estimate at model API rates.{cost.unpriced?' Some records have no known price.':''}</p></div>,document.body)}</>;
}
export function ChatUsageBar({session,active,version}:{session:Session;active:boolean;version:number}) {
  const [usage,setUsage]=useState<ChatUsage>();
  useEffect(()=>{if(!active||!['codex','claude'].includes(session.launcher))return;let cancelled=false,pending=false;setUsage(undefined);const refresh=async()=>{if(pending)return;pending=true;try{const value=await window.harbor.chatUsage(session.id);if(!cancelled)setUsage(value);}catch(error){if(!cancelled)setUsage({error:(error as Error).message});}finally{pending=false;}};void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{cancelled=true;clearInterval(timer);};},[session.id,session.conversationId,session.generation,session.launcher,active,version]);
  if(!['codex','claude'].includes(session.launcher))return null;
  const tokens=usage?.tokens;
  return <div className="chat-usage-bar" aria-label="Chat usage" title={usage?.error||'Lifetime totals from this chat’s saved transcript, including its subagent, workflow and spawned-agent logs.'}>{!usage?'Loading chat usage…':usage.error?'Chat usage unavailable':<><span title={tokens?`Input: ${count(tokens.inputTokens)} · Output: ${count(tokens.outputTokens)} · Cache read: ${count(tokens.cacheReadTokens)} · Cache write: ${count(tokens.cacheWriteTokens)}`:undefined}>{tokens?`${count(tokens.totalTokens)} tokens`:'Tokens unavailable'}</span><span>{usage.compactionCount==null?'Compactions unavailable':`${count(usage.compactionCount)} recorded compactions`}</span>{!!usage.subagents&&<span title="Usage from these subagent logs is included in this chat’s tokens and cost">{`incl. ${count(usage.subagents)} subagent${usage.subagents===1?'':'s'}`}</span>}<ChatCost usage={usage} active={active}/>{usage.partial&&<span>Partial log</span>}</>}</div>;
}
