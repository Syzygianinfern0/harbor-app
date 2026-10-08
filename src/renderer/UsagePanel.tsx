import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronRight, DollarSign, Gauge, Info, RefreshCw, X } from 'lucide-react';
import type { ChatUsage, CostAmount, CostModel, HostUsage, LimitWindow, Session, UsageLimits, UsagePeriod } from '../shared/types';
import { AGENT_NAMES, SHORT_NAMES, agoText, buildAccounts, chatPlan, currentWindows, footerSummary, leftText, level, resetText, tightest, windowLabel, type AccountKind, type UsageAccount } from '../shared/usagePlans';
import { AgentIcon } from './AgentIcon';
import './usage.css';

const count=(value:number)=>value.toLocaleString();
const money=(value:number)=>value>0&&value<0.01?'<$0.01':value.toLocaleString('en-US',{style:'currency',currency:'USD'});
const blank=():CostAmount=>({usd:0,estimated:0,recorded:0,unpriced:0});
const sum=(rows:CostAmount[])=>rows.reduce((a,b)=>({usd:a.usd+b.usd,estimated:a.estimated+b.estimated,recorded:a.recorded+b.recorded,unpriced:a.unpriced+b.unpriced}),blank());
const price=(cost:CostAmount,available=true)=>!available||(!cost.estimated&&!cost.recorded&&cost.unpriced)?'Unavailable':`${cost.estimated?'≈ ':''}${money(cost.usd)}`;
const ranges=[['day','Last 24 hours'],['week','Last week'],['month','Last month']] as const;
const rangeName:Record<UsagePeriod,string>={day:'last 24 hours',week:'last week',month:'last month'};

// One shared copy of usage and limits, so tabs and chat bars read the same data the sidebar polls.
type UsageData={hosts?:HostUsage[];limits?:UsageLimits};
let shared:UsageData={};const listeners=new Set<()=>void>();
const publish=(patch:UsageData)=>{shared={...shared,...patch};for(const listener of listeners)listener();};
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function useUsageData(){return useSyncExternalStore(subscribe,()=>shared);}
function useNow(interval=30000){const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),interval);return()=>clearInterval(timer);},[interval]);return now;}

export function useHostUsage(version:number,configuration:string) {
  const [hosts,setHosts]=useState<HostUsage[]>(); const [limits,setLimits]=useState<UsageLimits>(); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let cancelled=false,pending=false;
    const run=async()=>{if(pending)return;pending=true;setBusy(true);setError('');try{const value=await window.harbor.usage();if(!cancelled){setHosts(value);publish({hosts:value});}}catch(error){if(!cancelled)setError((error as Error).message);}finally{pending=false;if(!cancelled)setBusy(false);}};
    void run();const timer=setInterval(()=>void run(),60000);return()=>{cancelled=true;clearInterval(timer);};
  },[version,configuration,refresh]);
  // Plans and limits are small host-local reads, so they refresh more often than the transcript scan.
  useEffect(()=>{
    let cancelled=false,pending=false;
    const run=async()=>{if(pending)return;pending=true;try{const value=await window.harbor.usageLimits();if(!cancelled){setLimits(value);publish({limits:value});}}catch{/* Limits are optional; costs still show. */}finally{pending=false;}};
    void run();const timer=setInterval(()=>void run(),20000);return()=>{cancelled=true;clearInterval(timer);};
  },[version,configuration,refresh]);
  const accounts=useMemo(()=>buildAccounts(hosts,limits),[hosts,limits]);
  return {hosts,limits,accounts,busy,error,refresh:useCallback(()=>setRefresh(v=>v+1),[])};
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

export function PlanTag({kind,plan}:{kind:AccountKind;plan?:string}) {
  return <span className={`plan-tag ${kind}`}>{kind==='subscription'?plan??'Subscription':kind==='api'?plan??'API key':kind==='down'?'Unavailable':'Plan unknown'}</span>;
}
function Meter({window,now}:{window:LimitWindow;now:number}) {
  const tone=level(window.usedPercent);const reset=resetText(window.resetsAt,now);
  return <div className="limit-meter"><div className="limit-meter-top"><span>{windowLabel(window)}</span><strong className={tone}>{leftText(window)}</strong></div><div className={`limit-track ${tone}`} role="meter" aria-label={`${windowLabel(window)} limit used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(window.usedPercent)}><i style={{width:`${Math.min(100,window.usedPercent)}%`}}/></div><div className="limit-meter-sub"><span>{Math.round(window.usedPercent)}% used</span>{reset&&<span>Resets {reset}</span>}</div></div>;
}
function AccountHead({account,compact}:{account:UsageAccount;compact?:boolean}) {
  const hosts=account.hosts.map(h=>h.label).join(', ');
  return <div className="account-head">{account.agent&&<span className={`account-badge ${account.agent}`}><AgentIcon launcher={account.agent} size={12}/></span>}<strong>{account.agent?AGENT_NAMES[account.agent]:hosts}</strong><PlanTag kind={account.kind} plan={account.plan}/><span className="account-hosts">{account.kind==='down'?'':compact?hosts:`Used on: ${hosts}`}</span></div>;
}
function SpendRows({account,period}:{account:UsageAccount;period:UsagePeriod}) {
  const estimate=account.kind==='unknown';
  return <><div className="account-money"><Amount cost={account.cost[period]} available={account.costAvailable}/><small>{estimate?'if billed per token':rangeName[period]}</small></div>{!estimate&&ranges.filter(([key])=>key!==period).map(([key,label])=><div className="cost-row account-row" key={key}><span>{label}</span><Amount cost={account.cost[key]} available={account.costAvailable}/></div>)}</>;
}
export function AccountCard({account,now,period='day',compact=false}:{account:UsageAccount;now:number;period?:UsagePeriod;compact?:boolean}) {
  const windows=currentWindows(account.limits,now);const worst=tightest(windows);
  const hosts=account.hosts.map(h=>h.label).join(', ');
  const name=account.agent?SHORT_NAMES[account.agent]:'';
  const reached=!!worst&&(worst.usedPercent>=100||!!account.limits?.reached);
  const tone=account.kind==='down'?'warn':worst?level(worst.usedPercent):'';
  let body;
  if(account.kind==='subscription') body=<>{windows.map((w,i)=><Meter key={i} window={w} now={now}/>)}
    {!account.limits&&<div className="usage-callout info"><Info size={13}/><span>{account.agent==='claude'?'Signed in with a subscription. Usage appears after the next reply in a Harbor-launched Claude chat.':'Signed in with ChatGPT. Usage appears after the next Codex reply.'}</span></div>}
    {reached?<div className="usage-callout danger"><AlertTriangle size={13}/><span>{name} is paused{worst?.resetsAt?` until ${resetText(tightest(windows.filter(w=>w.usedPercent>=100))?.resetsAt??worst.resetsAt,now)}`:''}. Chats on this account will wait.</span></div>:worst&&worst.usedPercent>=90?<div className="usage-callout warn"><AlertTriangle size={13}/><span>Almost out.{worst.resetsAt?` Resets ${resetText(worst.resetsAt,now)}.`:''}</span></div>:null}
    <div className="account-foot">{account.costAvailable&&<span>≈ {money(account.cost.week.usd)} at API rates this week, not charged</span>}{account.limits&&<span>Updated {agoText(account.limits.at,now)}{account.limits.source==='log'?' from saved logs':''}{compact&&account.hosts.length>1?` · shared by ${account.hosts.length} hosts`:''}</span>}</div></>;
  else if(account.kind==='api') body=<><SpendRows account={account} period={period}/>{!compact&&<div className="account-foot"><span>Recorded or estimated at model API rates</span></div>}</>;
  else if(account.kind==='unknown') body=<><SpendRows account={account} period={period}/><div className="account-foot"><span>{account.agent==='codex'?`Couldn't tell whether this is an API key or a subscription. Update Codex on ${hosts} to see limits.`:`Couldn't detect the plan on ${hosts}.`}</span></div></>;
  else body=<div className="usage-callout warn"><AlertTriangle size={13}/><span title={account.error}>{hosts} is unreachable. Retrying with backoff.</span></div>;
  return <section className={`account-card ${compact?'compact':''} ${tone}`} aria-label={`${account.agent?AGENT_NAMES[account.agent]:hosts} usage`}><AccountHead account={account} compact={compact}/>{body}</section>;
}

function CostNotes({state,partial}:{state:UsageState;partial:boolean}) {
  const dates=state.hosts?.map(h=>h.pricingUpdatedAt).filter((v):v is string=>!!v).sort();
  return <div className="cost-notes">{state.error&&<p role="alert">{state.error}</p>}{partial&&<p className="cost-warning">Partial coverage · some usage or host data is unavailable.</p>}<p>USD · ≈ marks estimates at model API rates. Recorded costs are used when present. Subscription charges and credits are not included.</p><p>All saved chats and subagents on configured hosts. Copies on separate hosts count on each host.{dates?.length?` Prices updated ${new Date(dates[0]).toLocaleDateString()}.`:''}</p></div>;
}

function footerValue({state,now}:{state:UsageState;now:number}) {
  const summary=footerSummary(state.accounts,now);const star=summary.partial?' *':'';
  if(summary.worst){
    const {account,window}=summary.worst;const tone=level(window.usedPercent);
    const left=window.usedPercent>=100?'Limit reached':`${Math.max(0,Math.floor(100-window.usedPercent))}%`;
    if(summary.spend) return {icon:'gauge',label:'Usage',tone,value:<><span className={tone}>{left}</span> · {price(summary.spend)}{star}</>,title:`${SHORT_NAMES[account.agent!]} ${windowLabel(window).toLowerCase()}: ${leftText(window)} · API spend in the last 24 hours: ${price(summary.spend)}`};
    return {icon:'gauge',label:`${SHORT_NAMES[account.agent!]} ${windowLabel(window).toLowerCase()}`,tone,value:<><span className={tone}>{leftText(window)}</span>{star}</>,title:`${AGENT_NAMES[account.agent!]} ${account.plan??''}: ${leftText(window)} of the ${windowLabel(window).toLowerCase()} limit`};
  }
  if(summary.spend) return {icon:'dollar',label:'24h',tone:'',value:<>{summary.estimate&&!summary.spend.estimated?'≈ ':''}{price(summary.spend)}{star}</>,title:`API spend in the last 24 hours · ${price(summary.spend)}${summary.partial?' · partial coverage':''}`};
  const value=summary.pending?'Waiting…':state.limits?.disabled&&!state.hosts?.length?'Off':!state.hosts&&!state.limits?(state.error?'Unavailable':'…'):'—';
  return {icon:'gauge',label:'Usage',tone:'',value:<>{value}{star}</>,title:state.limits?.disabled??'Usage and limits'};
}
export function SidebarCost({state,onDetails,collapsed=false}:{state:UsageState;onDetails:()=>void;collapsed?:boolean}) {
  const [open,setOpen]=useState(false);const button=useRef<HTMLButtonElement>(null);const popup=useRef<HTMLDivElement>(null);const now=useNow();
  useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!popup.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('mousedown',close);document.addEventListener('keydown',key);popup.current?.focus();return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};},[open]);
  const rect=button.current?.getBoundingClientRect();const footer=footerValue({state,now});const Icon=footer.icon==='dollar'?DollarSign:Gauge;
  return <><button ref={button} className={`sidebar-cost ${collapsed?'sidebar-cost-collapsed':''} ${footer.tone}`} aria-label="Usage and limits" aria-expanded={open} onClick={()=>setOpen(v=>!v)} title={footer.title}><Icon size={13}/>{!collapsed&&<><span>{footer.label}</span><span className="sidebar-cost-value">{footer.value}</span><ChevronRight size={12}/></>}</button>{open&&createPortal(<div ref={popup} tabIndex={-1} className="cost-popover usage-popover" role="dialog" aria-label="Usage" style={{left:Math.min(rect?.left??16,Math.max(8,window.innerWidth-396)),bottom:Math.max(12,window.innerHeight-(rect?.top??window.innerHeight)+8)}}><header><strong>Usage</strong><button className="icon-button" aria-label="Close usage" onClick={()=>{setOpen(false);button.current?.focus();}}><X size={15}/></button></header>{!state.hosts&&!state.limits&&<p role="status">{state.error||'Reading saved usage…'}</p>}{state.limits?.disabled&&!state.accounts.length&&<p className="cost-notes">{state.limits.disabled}</p>}<div className="account-list">{state.accounts.map(account=><AccountCard key={account.key} account={account} now={now} compact/>)}</div><div className="cost-notes"><p>Limits are per account, so a sign-in shared across hosts shows once. $ appears only for API-key accounts; ≈ marks estimates at model API rates.</p></div><button className="cost-details-button" onClick={()=>{setOpen(false);onDetails();}}>View detailed usage<ChevronRight size={14}/></button></div>,document.body)}</>;
}

export function UsagePanel({state}:{state:UsageState}) {
  const [period,setPeriod]=useState<UsagePeriod>('day');const [costPeriod,setCostPeriod]=useState<UsagePeriod>('day');const [group,setGroup]=useState('host');const data=summary(state.hosts,costPeriod);const now=useNow();
  const groups=new Map<string,Row[]>();for(const row of group==='day'?data.days:data.rows){const key=group==='host'?row.hostId:group==='model'?row.model:row.day!;groups.set(key,[...(groups.get(key)??[]),row]);}
  const sorted=[...groups].sort((a,b)=>group==='day'?b[0].localeCompare(a[0]):sum(b[1]).usd-sum(a[1]).usd);
  const subscriptions=state.accounts.filter(a=>a.kind==='subscription');const paying=state.accounts.filter(a=>a.kind!=='subscription');
  return <div className="usage-panel cost-panel"><div className="usage-heading"><h3>Plans &amp; usage</h3><button className="secondary-button" disabled={state.busy} onClick={state.refresh}><RefreshCw size={13} className={state.busy?'spin':''}/>Refresh usage</button></div>
    {state.limits?.disabled&&<p className="preferences-note">{state.limits.disabled}</p>}
    {!!subscriptions.length&&<><div className="usage-subhead">Subscriptions · usage left</div><div className="account-cards">{subscriptions.map(account=><AccountCard key={account.key} account={account} now={now}/>)}</div></>}
    {!!paying.length&&<><div className="usage-subhead">Pay as you go · spend</div><Ranges period={period} onChange={setPeriod}/><div className="account-cards">{paying.map(account=><AccountCard key={account.key} account={account} now={now} period={period}/>)}</div></>}
    <p className="preferences-note">One card per sign-in. A subscription used on several hosts appears once with every host listed. Subscription fees are never shown as spend. Reset times are local.</p>
    <div className="usage-subhead">Token cost at API rates</div><Ranges period={costPeriod} onChange={setCostPeriod}/><div className="cost-total"><div><small>All available hosts{data.partial?' · partial coverage':''}</small><strong><Amount cost={data.total} available={data.available}/></strong></div><span>Rolling {costPeriod==='day'?'24 hours':costPeriod==='week'?'7 days':'30 days'}</span></div>{state.busy&&<p className="preferences-note" role="status">Updating usage…</p>}<label className="cost-group-control">Group by<select aria-label="Group usage by" value={group} onChange={e=>setGroup(e.target.value)}><option value="host">Host → Model</option><option value="model">Model → Host</option><option value="day">Day → Host → Model</option></select></label><div className="cost-table">{sorted.map(([key,rows])=><section key={key}><div className="cost-row cost-group"><strong>{group==='host'?rows[0].host:key}</strong><Amount cost={sum(rows)}/></div>{rows.sort((a,b)=>b.usd-a.usd).map((row,index)=><div className="cost-row cost-model" key={index}><span>{group==='host'?row.model:group==='model'?row.host:`${row.host} · ${row.model}`}<small>{row.agent==='codex'?'Codex':'Claude Code'}</small></span><Amount cost={row}/></div>)}</section>)}</div>{state.hosts?.filter(h=>h.error).map(h=><div className="cost-row cost-unavailable" key={h.hostId}><span>{h.hostLabel}<small>{h.error}</small></span><span>Unavailable</span></div>)}{data.available&&!data.rows.length&&<p className="preferences-note">No usage recorded in this time range.</p>}<CostNotes state={state} partial={data.partial}/><p className="preferences-note">Day groups use UTC. Time ranges are rolling windows. Unpriced records are excluded from the displayed subtotal. Subscription usage is priced here as if it were billed per token.</p></div>;
}

function ChatCost({usage,active}:{usage:ChatUsage;active:boolean}) {
  const [open,setOpen]=useState(false);const button=useRef<HTMLButtonElement>(null);const popup=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!popup.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node))setOpen(false);};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('mousedown',close);document.addEventListener('keydown',key);popup.current?.focus();return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};},[open]);
  useEffect(()=>{if(!active)setOpen(false);},[active]);
  if(!usage.cost)return <span className="chat-cost">Cost unavailable</span>;
  const cost=usage.cost;const rect=button.current?.getBoundingClientRect();
  return <><button ref={button} className="chat-cost" aria-label="Chat total cost" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Amount cost={cost} available={!!(cost.estimated+cost.recorded+cost.unpriced)||usage.tokens?.totalTokens===0}/></button>{open&&createPortal(<div ref={popup} tabIndex={-1} className="cost-popover chat-cost-popover" role="dialog" aria-label="Chat total cost" style={{left:Math.max(8,Math.min(rect?.left??8,window.innerWidth-348)),top:Math.min((rect?.bottom??80)+8,window.innerHeight-260)}}><header><strong>This chat · total cost</strong><button className="icon-button" aria-label="Close chat total cost" onClick={()=>{setOpen(false);button.current?.focus();}}><X size={15}/></button></header>{cost.models.map(model=><div className="cost-row" key={model.model}><span>{model.model}</span><Amount cost={model}/></div>)}<div className="cost-row cost-group"><strong>Total</strong><Amount cost={cost} available={!!(cost.estimated+cost.recorded+cost.unpriced)||usage.tokens?.totalTokens===0}/></div><p className="cost-notes">USD · entire conversation. ≈ indicates an estimate at model API rates.{cost.unpriced?' Some records have no known price.':''}</p></div>,document.body)}</>;
}
function useChatPlan(session:Session,now:number) {
  const data=useUsageData();const accounts=useMemo(()=>buildAccounts(data.hosts,data.limits),[data]);
  return data.limits?chatPlan(session,data.limits,accounts,now):undefined;
}
/** The chat's own billing: what is left of its plan for subscriptions, the estimated cost otherwise. */
function PlanChip({session,usage,active}:{session:Session;usage?:ChatUsage;active:boolean}) {
  const now=useNow();const plan=useChatPlan(session,now);
  const cost=usage&&!usage.error?<ChatCost usage={usage} active={active}/>:null;
  if(!plan) return cost;
  if(plan.kind==='subscription'){
    const tone=plan.window?level(plan.window.usedPercent):'';const reset=resetText(plan.window?.resetsAt,now);
    return <span className={`plan-chip ${tone}`} aria-label="Plan usage" title={plan.limits?`${AGENT_NAMES[plan.agent]} plan limits, updated ${agoText(plan.limits.at,now)}. Shared by every chat on this account.`:'Subscription detected. Remaining usage appears after the next reply.'}><PlanTag kind="subscription" plan={plan.plan}/>{plan.window?<span>{windowLabel(plan.window)} · {leftText(plan.window)}{reset?` · resets ${reset}`:''}</span>:<span>Usage appears after next reply</span>}</span>;
  }
  return <span className="plan-chip" aria-label="Plan usage" title={plan.kind==='unknown'?'Plan unknown: estimate at model API rates':'Billed per token: estimate at model API rates'}><PlanTag kind={plan.kind} plan={plan.plan}/>{cost}</span>;
}
/** A small ring on a tab, only when its account is at 90% or more of a limit. */
export function LimitRing({session}:{session:Session}) {
  const now=useNow(60000);const plan=useChatPlan(session,now);const window=plan?.window;
  if(plan?.kind!=='subscription'||!window||window.usedPercent<90)return null;
  const r=5.5,c=2*Math.PI*r;const label=`${SHORT_NAMES[plan.agent]} ${windowLabel(window).toLowerCase()}: ${leftText(window)}`;
  return <svg className={`limit-ring ${level(window.usedPercent)}`} viewBox="0 0 14 14" role="img" aria-label={label}><title>{label}</title><circle className="bg" cx="7" cy="7" r={r}/><circle className="fg" cx="7" cy="7" r={r} strokeDasharray={`${c*Math.min(100,window.usedPercent)/100} ${c}`} transform="rotate(-90 7 7)"/></svg>;
}
export function ChatUsageBar({session,active,version}:{session:Session;active:boolean;version:number}) {
  const [usage,setUsage]=useState<ChatUsage>();
  useEffect(()=>{if(!active||!['codex','claude'].includes(session.launcher))return;let cancelled=false,pending=false;setUsage(undefined);const refresh=async()=>{if(pending)return;pending=true;try{const value=await window.harbor.chatUsage(session.id);if(!cancelled)setUsage(value);}catch(error){if(!cancelled)setUsage({error:(error as Error).message});}finally{pending=false;}};void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{cancelled=true;clearInterval(timer);};},[session.id,session.conversationId,session.generation,session.launcher,active,version]);
  if(!['codex','claude'].includes(session.launcher))return null;
  const tokens=usage?.tokens;
  return <div className="chat-usage-bar" aria-label="Chat usage" title={usage?.error||'Lifetime totals from this chat’s saved transcript, including its subagent, workflow and spawned-agent logs.'}>{!usage?<span>Loading chat usage…</span>:usage.error?<span>Chat usage unavailable</span>:<><span title={tokens?`Input: ${count(tokens.inputTokens)} · Output: ${count(tokens.outputTokens)} · Cache read: ${count(tokens.cacheReadTokens)} · Cache write: ${count(tokens.cacheWriteTokens)}`:undefined}>{tokens?`${count(tokens.totalTokens)} tokens`:'Tokens unavailable'}</span><span>{usage.compactionCount==null?'Compactions unavailable':`${count(usage.compactionCount)} recorded compactions`}</span>{!!usage.subagents&&<span title="Usage from these subagent logs is included in this chat’s tokens and cost">{`incl. ${count(usage.subagents)} subagent${usage.subagents===1?'':'s'}`}</span>}{usage.partial&&<span>Partial log</span>}</>}<span className="chat-plan"><PlanChip session={session} usage={usage} active={active}/></span></div>;
}
