import { Fragment, useEffect, useState } from 'react';
import { Bell, Check, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import type { AgentUpdate, AgentUpdateState, Preferences } from '../shared/types';

export function NotificationPreferences({value,onChange}:{value:Preferences['notifications'];onChange:(value:Preferences['notifications'])=>void}) {
  const [message,setMessage]=useState('');const [testing,setTesting]=useState(false);
  return <div className="terminal-preferences notification-preferences"><h3>Know when a chat needs you.</h3><p>Harbor can notify you about approvals, questions, errors, and completed work while the app is running.</p>{([['enabled','Enable desktop notifications'],['sound','Play a sound'],['whenFocused','Notify even when Harbor is in front'],['onComplete','Notify when an agent finishes working']] as const).map(([key,label])=><label key={key} className="toggle-field" data-setting={key}><input type="checkbox" checked={value[key]} onChange={e=>onChange({...value,[key]:e.target.checked})}/>{label}</label>)}<div className="notification-actions" data-setting="test"><button className="secondary-button" disabled={testing} onClick={async()=>{setTesting(true);setMessage('Waiting for macOS…');try{setMessage(await window.harbor.testNotification(value.sound));}catch(error){setMessage((error as Error).message);}finally{setTesting(false);}}}><Bell size={14}/>{testing?'Sending…':'Send test notification'}</button><button className="secondary-button" onClick={()=>void window.harbor.openNotificationSettings().catch(error=>setMessage(error.message))}>Open notification settings</button></div>{message&&<p role="status">{message}</p>}<p className="preferences-note">Status comes from the agents’ own runtime events. Older sessions need to be resumed in Harbor to enable live activity. macOS Focus and notification settings still apply.</p></div>;
}
export function UpdatePreferences() {
  const [state,setState]=useState<AgentUpdateState>({updates:[],checking:false,updatingAll:false,results:{}});
  const [requesting,setRequesting]=useState(false);
  const [error,setError]=useState('');
  const {updates,results,running}=state;
  const busy=requesting||state.checking||state.updatingAll||!!running;
  const available=updates.filter(row=>row.status==='available').length;
  const groups=[...new Set(updates.map(u=>u.hostId))];
  useEffect(()=>{
    let active=true;
    const receive=(snapshot:Awaited<ReturnType<typeof window.harbor.snapshot>>)=>{if(active&&snapshot.agentUpdates)setState(snapshot.agentUpdates);};
    const off=window.harbor.onSnapshot(receive);
    void window.harbor.snapshot().then(receive).catch(error=>{if(active)setError(error.message);});
    void window.harbor.checkUpdates(false).catch(error=>{if(active)setError(error.message);});
    return()=>{active=false;off();};
  },[]);
  const check=async()=>{
    setRequesting(true);setError('');
    try {const rows=await window.harbor.checkUpdates();setState(v=>({...v,updates:rows}));}
    catch(error){setError((error as Error).message);}finally{setRequesting(false);}
  };
  const install=async(u:AgentUpdate)=>{
    const key=`${u.hostId}:${u.agent}`;setRequesting(true);
    try {
      const result=await window.harbor.updateAgent(u.hostId,u.agent);
      setState(v=>({...v,updates:v.updates.map(old=>old.hostId===u.hostId&&old.agent===u.agent?result.update:old),results:{...v.results,[key]:{
        message:result.update.status==='current'?`Verified: ${result.update.installed} is up to date.`:`Update finished, but the latest version was not verified. Active version: ${result.update.installed||'unknown'}. ${result.update.error||'Check the output and installation channel.'}`,output:result.output}}}));
    } catch(error) {setState(v=>({...v,results:{...v.results,[key]:{message:`Update failed or could not be confirmed: ${(error as Error).message}. Check versions before retrying.`}}}));}
    finally {setRequesting(false);}
  };
  const updateAll=async()=>{
    setRequesting(true);setError('');
    try {await window.harbor.updateAllAgents();const snapshot=await window.harbor.snapshot();if(snapshot.agentUpdates)setState(snapshot.agentUpdates);}
    catch(error){setError((error as Error).message);}finally{setRequesting(false);}
  };
  const statusLabel=(u:AgentUpdate)=>u.status==='available'?'Update available':u.status==='current'?'Up to date':u.status==='missing'?'Not installed':'Unable to check';
  const agentName=(u:AgentUpdate)=>u.agent==='codex'?'Codex':'Claude Code';
  return <section className="updates-preferences" data-setting="agents">
    <div className="updates-heading"><div><h3>Agents on your machines</h3><p>Checks automatically each day, including when Harbor starts or wakes.{(state.checkedAt||updates[0])&&` Last checked ${new Date(state.checkedAt||updates[0].checkedAt).toLocaleString()}.`}</p></div>
      <div className="updates-actions"><button className="secondary-button" disabled={busy} onClick={()=>void check()}>{state.checking?<LoaderCircle className="spin" size={14}/>:<RefreshCw size={14}/>}Check for updates</button><button className="primary-button" disabled={busy||!available} onClick={()=>void updateAll()}>{state.updatingAll?<LoaderCircle className="spin" size={14}/>:<Download size={14}/>}Update all{available?` (${available})`:''}</button></div></div>
    {state.checking&&<p className="updates-progress" role="status">Checking machines…</p>}{state.updatingAll&&<p className="updates-progress" role="status">Updating agents across your machines: {state.completed} of {state.total} finished. You can leave Settings; updates will continue.</p>}{(error||state.error)&&<p className="form-error" role="alert">{error||state.error}</p>}
    {!updates.length&&!state.checking&&<p className="updates-empty">No version results yet. Check for updates to try again.</p>}
    {updates.length>0&&<div className="settings-rows"><table className="updates-table"><thead><tr><th>Agent</th><th>Installed</th><th>Latest</th><th>Status</th></tr></thead><tbody>{groups.map(hostId=><Fragment key={hostId}><tr className="update-host"><th colSpan={4} scope="rowgroup">{updates.find(u=>u.hostId===hostId)!.hostLabel}</th></tr>{updates.filter(u=>u.hostId===hostId).map(u=>{const key=`${u.hostId}:${u.agent}`;return <tr key={key}><td>{agentName(u)}</td><td>{u.installed||'—'}</td><td>{u.latest||'—'}</td><td className="update-result">
      <div className="update-status-line"><span className={`update-status update-${u.status}`}>{statusLabel(u)}</span>{u.status==='available'&&<button className="secondary-button update-one" aria-label={`Update ${agentName(u)}`} title={`Update ${agentName(u)} on ${u.hostLabel}`} disabled={busy} onClick={()=>void install(u)}>{running===key?<LoaderCircle className="spin" size={12}/>:<RefreshCw size={12}/>}Update</button>}</div>
      {u.error&&<small>{u.error}</small>}{results[key]&&<><small role="status">{results[key].message}</small>{results[key].output&&<details><summary>Update output</summary><pre className="update-output">{results[key].output}</pre></details>}</>}
    </td></tr>;})}</Fragment>)}</tbody></table></div>}
    <p className="preferences-note">Update all updates every agent with a newer release on every listed machine, one by one; a failure is reported on its row and the rest continue. Running chats keep their existing process; new chats use the updated agent. Each installation’s package manager does the update, and the version is checked afterward.</p>
  </section>;
}
