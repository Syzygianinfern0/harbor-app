import importlib.util, io, json, pathlib, sqlite3, tempfile, unittest, os
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('bridge',pathlib.Path(__file__).parents[1]/'src/bridge/harbor_bridge.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class BridgeTests(unittest.TestCase):
 def test_runtime_statuses_do_not_guess_idle_or_request_input_for_unknown_flags(self):
  self.assertEqual(bridge.codex_activity({'type':'active','activeFlags':['waitingOnApproval']}),('attention','Approval requested'))
  self.assertEqual(bridge.codex_activity({'type':'active','activeFlags':['waitingOnUserInput']}),('attention','Input requested'))
  self.assertEqual(bridge.codex_activity({'type':'active','activeFlags':['futureFlag']})[0],'working')
  self.assertEqual(bridge.codex_activity({'type':'notLoaded'})[0],'unknown')
  self.assertEqual(bridge.codex_activity({})[0],'unknown')
  self.assertEqual(bridge.codex_activity({'type':'systemError'})[0],'error')
 def test_claude_completion_is_distinct_from_input_and_errors(self):
  event=lambda name,**kw: bridge.claude_activity({'hook_event_name':name,**kw})
  self.assertEqual(event('Notification',notification_type='idle_prompt')[0],'idle')
  self.assertEqual(event('Notification',notification_type='agent_completed')[0],'idle')
  self.assertEqual(event('Notification',notification_type='permission_prompt')[0],'attention')
  self.assertEqual(event('Notification',notification_type='elicitation_url_dialog')[0],'attention')
  self.assertEqual(event('PreToolUse',tool_name='AskUserQuestion')[0],'attention')
  self.assertEqual(event('PostToolUse',tool_name='AskUserQuestion')[0],'working')
  self.assertEqual(event('Stop')[0],'idle')
  self.assertEqual(event('StopFailure',error='rate_limit'),('error','rate_limit'))
  self.assertEqual(event('Notification',notification_type='unknown')[0],None)
 def test_claude_hook_completion_survives_idle_reminder_and_ignores_other_generations(self):
  with tempfile.TemporaryDirectory() as d, patch.object(bridge,'ROOT',pathlib.Path(d)):
   file=pathlib.Path(d)/'chats/chat/metadata.json';file.parent.mkdir(parents=True)
   file.write_text(json.dumps({'generation':'current','activity':'idle'}))
   def send(event,generation='current'):
    with patch.object(bridge.sys,'stdin',io.StringIO(json.dumps(event))): bridge.hook('chat',generation)
    return json.loads(file.read_text())
   self.assertEqual(send({'hook_event_name':'UserPromptSubmit'})['activity'],'working')
   self.assertEqual(send({'hook_event_name':'PreToolUse','tool_name':'AskUserQuestion'})['activity'],'attention')
   self.assertEqual(send({'hook_event_name':'PostToolUse'})['activity'],'working')
   finished=send({'hook_event_name':'Stop'});self.assertEqual(finished['activity'],'idle');self.assertGreater(finished['completedAt'],0)
   reminder=send({'hook_event_name':'Notification','notification_type':'idle_prompt'})
   self.assertEqual(reminder['activity'],'idle');self.assertEqual(reminder['completedAt'],finished['completedAt'])
   self.assertEqual(send({'hook_event_name':'PermissionRequest'},'old')['activity'],'idle')
   self.assertEqual(send({'hook_event_name':'PermissionRequest','agent_id':'child'})['activity'],'idle')
 def test_claude_background_wait_is_not_completion(self):
  with tempfile.TemporaryDirectory() as d, patch.object(bridge,'ROOT',pathlib.Path(d)):
   file=pathlib.Path(d)/'chats/chat/metadata.json';file.parent.mkdir(parents=True)
   file.write_text(json.dumps({'generation':'current','activity':'idle'}))
   def send(event):
    with patch.object(bridge.sys,'stdin',io.StringIO(json.dumps(event))): bridge.hook('chat','current')
    return json.loads(file.read_text())
   send({'hook_event_name':'UserPromptSubmit'})
   task={'id':'b1','type':'shell','status':'running','description':'Run the test suite','command':'npm test'}
   waiting=send({'hook_event_name':'Stop','background_tasks':[task,{'id':'a1','type':'subagent','status':'running','agent_type':'general-purpose'}]})
   self.assertEqual(waiting['activity'],'background');self.assertNotIn('completedAt',waiting);self.assertEqual(waiting['backgroundKinds'],['shell','subagent'])
   self.assertEqual(waiting['reason'],'2 background tasks running: Run the test suite; general-purpose')
   self.assertEqual(send({'hook_event_name':'Notification','notification_type':'idle_prompt'})['activity'],'background')
   self.assertEqual(send({'hook_event_name':'PostToolUse','agent_id':'a1'})['activity'],'background')  # subagent hooks do not flip the chat
   self.assertEqual(send({'hook_event_name':'UserPromptSubmit','prompt':'<task-notification>'})['activity'],'working')
   done=send({'hook_event_name':'Stop','background_tasks':[{**task,'status':'completed'}]})
   self.assertEqual(done['activity'],'idle');self.assertGreater(done['completedAt'],0)
   self.assertEqual(send({'hook_event_name':'Stop','background_tasks':[]})['activity'],'idle')
 def test_background_reason_and_codex_wording(self):
  self.assertEqual(bridge.background_reason([{'command':'sleep 40; echo done\nmore'}],resumes=False),'Turn finished; 1 background terminal still running: sleep 40; echo done')
  self.assertTrue(bridge.background_reason([{'type':'shell'}]*5).endswith('; +2 more'))
 def test_claude_background_idle_ignores_caffeinate(self):
  with patch.object(bridge.subprocess,'check_output',return_value='  10     1 claude\n  11    10 caffeinate -i -t 300\n  12     1 zsh\n'): self.assertTrue(bridge.claude_background_idle(10))
  with patch.object(bridge.subprocess,'check_output',return_value='  11    10 caffeinate -i -t 300\n  13    10 /bin/zsh -c sleep 25\n'): self.assertFalse(bridge.claude_background_idle(10))
 def test_permission_flags(self):
  self.assertEqual(bridge.permission_args('codex','full-access'),['--sandbox','danger-full-access','--ask-for-approval','never'])
  self.assertEqual(bridge.codex_server_permissions('standard'),['-c','sandbox_mode="workspace-write"','-c','approval_policy="on-request"'])
  self.assertEqual(bridge.permission_args('claude','full-access'),['--dangerously-skip-permissions'])
  self.assertEqual(bridge.permission_args('claude','standard','choices: "manual", "plan"'),['--permission-mode','manual'])
  self.assertEqual(bridge.permission_args('claude','standard','choices: "default", "plan"'),['--permission-mode','default'])
 def test_claude_empty_unknown_and_message_scan(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'history.jsonl';self.assertIsNone(bridge.claude_has_messages(p))
   p.write_text(json.dumps({'type':'file-history-snapshot'})+'\n');self.assertFalse(bridge.claude_has_messages(p))
   # The first real message can be outside the old head/tail sampling windows.
   p.write_text(p.read_text()*10000+json.dumps({'type':'user','message':{'content':'hello'}})+'\n'+p.read_text()*10000)
   self.assertTrue(bridge.claude_has_messages(p))
   p.write_text('{broken');self.assertIsNone(bridge.claude_has_messages(p))
 def test_codex_history_uses_actual_user_event_not_title(self):
  with tempfile.TemporaryDirectory() as d, patch.dict(os.environ,{'CODEX_HOME':d}):
   db=sqlite3.connect(str(pathlib.Path(d)/'state_5.sqlite'))
   empty=pathlib.Path(d)/'empty.jsonl';empty.write_text(json.dumps({'type':'session_meta','payload':{}})+'\n')
   db.execute('create table threads(id text,cwd text,title text,created_at integer,updated_at integer,source text,rollout_path text,has_user_event integer)')
   for i,has in enumerate((0,1)):
    db.execute('insert into threads values(?,?,?,?,?,?,?,?)',(str(i),os.path.realpath(d),'Misleading name',1,2,'cli',str(empty),has))
   db.commit();db.close()
   with patch.object(bridge,'conversation_busy',return_value=False):rows=bridge.history('codex',d)
   self.assertEqual([r['hasMessages'] for r in rows],[False,True])
 def test_codex_paginated_history_does_not_trust_zero_flag(self):
  self.assertTrue(bridge.codex_has_messages({'has_user_event':0,'first_user_message':'hello','rollout_path':'missing'}))
  self.assertIsNone(bridge.codex_has_messages({'has_user_event':0,'rollout_path':'missing'}))
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'turn.jsonl';p.write_text(json.dumps({'type':'response_item','payload':{'role':'assistant','content':[{'type':'output_text','text':'hi'}]}})+'\n')
   self.assertTrue(bridge.codex_has_messages({'has_user_event':0,'rollout_path':str(p)}))
 def test_preview_counts_canonical_messages_and_bounds_tail(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'history.jsonl'
   rows=[]
   for i in range(6):
    rows += [{'type':'event_msg','payload':{'type':'agent_message','message':str(i)}},{'type':'response_item','payload':{'type':'message','role':'assistant','content':[{'type':'output_text','text':str(i)}]}}]
   p.write_text('\n'.join(json.dumps(row) for row in rows))
   preview=bridge.transcript_preview(p,'codex');self.assertEqual(preview['messageCount'],6);self.assertEqual([m['text'] for m in preview['messages']],['2','3','4','5'])
   row={'type':'user','uuid':'same','message':{'content':'hello'}}
   p.write_text(json.dumps(row)+'\n'+json.dumps(row))
   self.assertEqual(bridge.transcript_preview(p,'claude')['messageCount'],1)
   self.assertIn('error',bridge.transcript_preview(p.parent/'absent','codex'))
class UsageTests(unittest.TestCase):
 def write(self, path, rows):
  path.write_text('\n'.join(json.dumps(row) for row in rows)+'\n')
 def test_codex_cumulative_snapshots_and_compaction_mirrors(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'a.jsonl'
   def usage(n): return {'timestamp':'2026-09-17T00:00:00Z','type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':n,'cached_input_tokens':n//2,'output_tokens':10,'total_tokens':n+10}}}}
   rows=[usage(100),usage(100),usage(150),{'type':'compacted','payload':{'window_id':'one'}},{'type':'compacted','payload':{'window_id':'one'}},{'type':'event_msg','payload':{'type':'context_compacted'}}]
   self.write(p,rows);result=bridge.usage_record(p,'codex')
   self.assertEqual(result['tokens']['totalTokens'],160);self.assertEqual(result['compactionCount'],1)
   self.assertEqual(sum(e['tokens']['totalTokens'] for e in result['events']),160)
   p.write_text(p.read_text()+'{broken');self.assertTrue(bridge.usage_record(p,'codex')['partial'])
 def test_claude_streaming_deduplication_and_cache_accounting(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'a.jsonl'
   def usage(output): return {'timestamp':'2026-09-17T00:00:00Z','type':'assistant','uuid':str(output),'requestId':'r','message':{'id':'m','usage':{'input_tokens':10,'output_tokens':output,'cache_read_input_tokens':100,'cache_creation_input_tokens':20}}}
   boundary={'type':'system','subtype':'compact_boundary','uuid':'compact'}
   self.write(p,[usage(1),usage(5),usage(5),boundary,boundary]);result=bridge.usage_record(p,'claude')
   self.assertEqual(result['tokens']['totalTokens'],135);self.assertEqual(result['compactionCount'],1);self.assertEqual(len(result['events']),1)
 def test_rolling_windows_use_event_time_and_cache_invalidates(self):
  import datetime
  with tempfile.TemporaryDirectory() as d, patch.dict(os.environ,{'CODEX_HOME':d+'/codex','CLAUDE_CONFIG_DIR':d+'/claude'}), patch.object(bridge,'ROOT',pathlib.Path(d)/'cache'):
   now=1800000000
   directory=pathlib.Path(d)/'codex/sessions';directory.mkdir(parents=True);p=directory/'a.jsonl'
   rows=[]
   for days,n in [(40,10),(20,20),(5,30),(0.5,40)]:
    stamp=datetime.datetime.fromtimestamp(now-days*86400,datetime.timezone.utc).isoformat()
    rows.append({'timestamp':stamp,'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':n,'total_tokens':n}}}})
   self.write(p,rows)
   with patch.object(bridge.time,'time',return_value=now):
    result=bridge.host_usage()['agents'][0]
    self.assertEqual([result['periods'][k]['tokens']['totalTokens'] for k in ('day','week','month')],[10,20,30])
    self.assertEqual(bridge.host_usage()['agents'][0],result)
    rows[-1]['payload']['info']['total_token_usage']={'input_tokens':50,'total_tokens':50};self.write(p,rows)
    self.assertEqual(bridge.host_usage()['agents'][0]['periods']['day']['tokens']['totalTokens'],20)
 def test_unavailable_is_not_zero(self):
  self.assertIsNone(bridge.usage_record('/missing','codex')['tokens'])
  self.assertIsNone(bridge.usage_record('/missing','codex')['compactionCount'])

class CostTests(unittest.TestCase):
 def write(self, path, rows):
  path.write_text("\n".join(json.dumps(row) for row in rows)+"\n")
 def catalog(self):
  return {'models':{'model-a':{'input_cost_per_token':2e-6,'output_cost_per_token':10e-6,'cache_read_input_token_cost':0.2e-6,'cache_creation_input_token_cost':2.5e-6,'cache_creation_input_token_cost_above_1hr':4e-6},'model-b':{'input_cost_per_token':4e-6,'output_cost_per_token':20e-6}}}
 def event(self):
  return {'at':1800000000,'model':'model-a','tokens':{'inputTokens':1000,'outputTokens':100,'cacheReadTokens':500,'cacheWriteTokens':200,'totalTokens':1100}}
 def test_cache_prices_recorded_cost_and_unknown_rates(self):
  event=self.event();event['cacheWrite1h']=100
  cost,kind=bridge.event_cost(event,self.catalog());self.assertAlmostEqual(cost,.00235);self.assertEqual(kind,'estimated')
  event['recordedCost']=.91;self.assertEqual(bridge.event_cost(event,self.catalog()),(.91,'recorded'))
  del event['recordedCost'];event['tier']='priority';self.assertIsNone(bridge.event_cost(event,self.catalog())[0])
  event['model']='missing';self.assertIsNone(bridge.event_cost(event,self.catalog())[0])
  result=bridge.cost_summary([self.event(),event],self.catalog());self.assertEqual(result['unpriced'],1);self.assertEqual(result['estimated'],1);self.assertEqual(len(result['models']),2)
 def test_long_context_uses_request_size_and_priority_rate(self):
  rates=self.catalog();a=rates['models']['model-a'];a.update(input_cost_per_token_priority=4e-6,output_cost_per_token_priority=20e-6,cache_read_input_token_cost_priority=.4e-6,cache_creation_input_token_cost_priority=5e-6,input_cost_per_token_above_200k_tokens=4e-6,input_cost_per_token_above_200k_tokens_priority=8e-6)
  event=self.event();event['tier']='priority';self.assertAlmostEqual(bridge.event_cost(event,rates)[0],.0044)
  event['requestInput']=250000;self.assertAlmostEqual(bridge.event_cost(event,rates)[0],.0056)
 def test_model_switch_resets_and_repeated_latest_usage(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'a.jsonl'
   def row(total,last):return {'timestamp':'2026-09-17T00:00:00Z','type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':total},'last_token_usage':{'input_tokens':last}}}}
   self.write(p,[{'type':'turn_context','payload':{'model':'model-a'}},row(100,100),row(100,100),{'type':'turn_context','payload':{'model':'model-b'}},row(50,50),row(150,100)])
   result=bridge.usage_record(p,'codex');self.assertEqual(result['tokens']['inputTokens'],250)
   cost=bridge.cost_summary(result['events'],self.catalog());self.assertAlmostEqual(cost['usd'],.0008);self.assertEqual(cost['estimated'],3)
 def test_fork_rewritten_parent_history_is_excluded(self):
  with tempfile.TemporaryDirectory() as d, patch.dict(os.environ,{'CODEX_HOME':d}):
   root=pathlib.Path(d)/'sessions';root.mkdir();parent_id='11111111-1111-1111-1111-111111111111'
   def row(total,stamp):return {'timestamp':stamp,'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':total},'last_token_usage':{'input_tokens':100}}}}
   self.write(root/(parent_id+'.jsonl'),[row(100,'2026-09-16T00:00:00Z'),row(200,'2026-09-16T00:01:00Z')])
   child=root/'child.jsonl';self.write(child,[{'type':'session_meta','payload':{'id':'child','forked_from_id':parent_id,'timestamp':'2026-09-17T00:00:00Z'}},row(100,'2026-09-17T00:00:00.001Z'),row(200,'2026-09-17T00:00:00.002Z'),row(300,'2026-09-17T00:01:00Z')])
   result=bridge.usage_record(child,'codex');self.assertEqual(len(result['events']),1);self.assertEqual(result['tokens']['inputTokens'],100)
 def test_claude_one_hour_cache_and_synthetic_events(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'a.jsonl'
   row={'timestamp':'2026-09-17T00:00:00Z','type':'assistant','uuid':'one','message':{'model':'model-a','usage':{'input_tokens':10,'output_tokens':10,'cache_creation_input_tokens':100,'cache_creation':{'ephemeral_1h_input_tokens':100}}}}
   self.write(p,[row,{**row,'uuid':'two','message':{**row['message'],'model':'<synthetic>'}}]);result=bridge.usage_record(p,'claude')
   self.assertEqual(len(result['events']),1);self.assertAlmostEqual(bridge.cost_summary(result['events'],self.catalog())['usd'],.00052)
 def test_fork_launch_arguments_start_a_new_conversation_from_the_original(self):
  src,new='11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'
  self.assertEqual(bridge.session_args('claude',fork=src,identity=new),['--resume',src,'--fork-session','--session-id',new])
  self.assertEqual(bridge.session_args('claude',resume=src,identity=src),['--resume',src])
  self.assertEqual(bridge.session_args('claude',identity=new),['--session-id',new])
  self.assertEqual(bridge.session_args('codex',fork=src),['fork',src]);self.assertEqual(bridge.session_args('codex',resume=src),['resume',src]);self.assertEqual(bridge.session_args('codex'),[])
 def test_codex_fork_monitor_follows_the_fork_never_its_source_or_subagents(self):
  src={'id':'source'};fork={'id':'fork','forkedFromId':'source'};sub={'id':'sub','parentThreadId':'fork'}
  self.assertEqual(bridge.codex_thread([src,sub,fork],None,'source'),fork)
  self.assertIsNone(bridge.codex_thread([src,sub],None,'source'))
  self.assertEqual(bridge.codex_thread([src,fork,{'id':'other'}],'other','source')['id'],'other')
  self.assertEqual(bridge.codex_thread([sub,{'id':'plain'}])['id'],'plain');self.assertIsNone(bridge.codex_thread([]))
 def test_fork_run_rejects_invalid_or_conflicting_sources(self):
  script=str(pathlib.Path(__file__).parents[1]/'src/bridge/harbor_bridge.py');chat='33333333-3333-3333-3333-333333333333'
  for extra in (['--fork','not-a-uuid'],['--fork',chat,'--resume',chat]):
   self.assertEqual(__import__('subprocess').run(['python3',script,'run','claude',chat,chat,*extra],capture_output=True).returncode,2)

if __name__=='__main__':unittest.main()
