import test from 'node:test';
import assert from 'node:assert/strict';
import { addToGroup, arrangeTabs, assignProjectColors, createGroup, defaultTabGroups, groupEntry, groupKeys, isCollapsed, layoutTabs, pruneGroups, removeFromGroups, restoreTabGroups, rollup, setCollapsed, stripTabs, ungroup, updateGroup, GROUP_COLORS } from '../src/shared/tabGroups';
import { groupShortcut } from '../src/shared/shortcuts';

const project:Record<string,string>={a1:'a',a2:'a',a3:'a',b1:'b',b2:'b',c1:'c'};
const projectOf=(id:string)=>project[id];
const tabs=['a1','b1','a2','c1','b2','a3'];

test('project groups gather tabs, follow sidebar order, and hide a lone project label',()=>{
  const state=defaultTabGroups();
  const {segments}=layoutTabs(tabs,state,projectOf,['c','a','b']);
  assert.deepEqual(groupKeys(segments),['p:c','p:a','p:b']);
  assert.deepEqual(arrangeTabs(segments),['c1','a1','a2','a3','b1','b2']);
  const unordered=layoutTabs(tabs,state,projectOf);
  assert.deepEqual(groupKeys(unordered.segments),['p:a','p:b','p:c']);
  const solo=layoutTabs(['a1','a2'],state,projectOf);
  assert.deepEqual(solo.segments,[{kind:'tab',id:'a1'},{kind:'tab',id:'a2'}]);
  const off=layoutTabs(tabs,{...state,byProject:false},projectOf);
  assert.deepEqual(off.segments.map(s=>s.kind),Array(6).fill('tab'));
});

test('custom groups take precedence, can mix projects, and keep a single project labelled',()=>{
  const {state,id}=createGroup(defaultTabGroups(),['a3','b2']);
  const {segments,keyOf}=layoutTabs(tabs,state,projectOf);
  assert.equal(keyOf.get('a3'),`g:${id}`);assert.equal(keyOf.get('a1'),'p:a');
  assert.deepEqual(groupKeys(segments),['p:a','p:b','p:c',`g:${id}`]);
  const solo=layoutTabs(['a1','a2','a3'],createGroup(defaultTabGroups(),['a3']).state,projectOf);
  assert.deepEqual(groupKeys(solo.segments).length,2);
  const moved=addToGroup(state,id,['c1']);assert.deepEqual(moved.custom[0].members,['a3','b2','c1']);
  const second=createGroup(moved,['c1']);assert.deepEqual(second.state.custom.map(g=>g.members),[['a3','b2'],['c1']]);
  assert.notEqual(second.state.custom[0].color,second.state.custom[1].color);
  assert.equal(updateGroup(state,id,{name:'  Release 0.6  '}).custom[0].name,'Release 0.6');
  assert.equal(updateGroup(state,id,{name:'   '}).custom[0].name,state.custom[0].name);
  assert.deepEqual(removeFromGroups(state,['a3','b2']).custom,[]);
  assert.deepEqual(ungroup(state,id).custom,[]);
});

test('folding keeps the selected tab visible, and focus mode opens only the selected group',()=>{
  let state=setCollapsed(defaultTabGroups(),'p:a',true);
  const {segments}=layoutTabs(tabs,state,projectOf);
  assert.deepEqual(stripTabs(segments,state,'b1'),['b1','b2','c1']);
  assert.deepEqual(stripTabs(segments,state,'a2'),['a2','b1','b2','c1']);
  state={...setCollapsed(state,'p:a',false),focus:true};
  assert.deepEqual(stripTabs(segments,state,'b2'),['b1','b2']);
  assert.equal(isCollapsed(state,'p:a','p:b'),true);assert.equal(isCollapsed(state,'p:b','p:b'),false);
  assert.equal(groupEntry(state,segments,'p:a'),'a1');
  assert.equal(groupEntry({...state,lastActive:{'p:a':'a3'}},segments,'p:a'),'a3');
  assert.equal(groupEntry({...state,lastActive:{'p:a':'gone'}},segments,'p:a'),'a1');
});

test('rollup reports the most urgent status first',()=>{
  const items=[{s:'idle'},{s:'working'},{s:'completed'},{s:'attention'},{s:'attention'}];
  assert.deepEqual(rollup(items,i=>i.s),{activity:'attention',item:items[3],count:2});
  assert.equal(rollup([{s:'working'},{s:'completed'}],i=>i.s)?.activity,'completed');
  assert.equal(rollup([{s:'idle'},{s:'closed'}],i=>i.s),undefined);
});

test('pruning, colors and restore validate persisted state',()=>{
  const {state}=createGroup(defaultTabGroups(),['a1','b1']);
  assert.equal(pruneGroups(state,['a1','b1','c1']),state);
  assert.deepEqual(pruneGroups(state,['a1']).custom[0].members,['a1']);
  assert.deepEqual(pruneGroups(state,['c1']).custom,[]);
  const colored=assignProjectColors(defaultTabGroups(),['a','b','c']);
  assert.deepEqual(Object.values(colored.projectColors),GROUP_COLORS.slice(0,3).map(c=>c.value));
  assert.equal(assignProjectColors(colored,['a','b']),colored);
  const nine=assignProjectColors(defaultTabGroups(),Array.from({length:9},(_,i)=>`p${i}`));
  assert.equal(nine.projectColors.p8,GROUP_COLORS[0].value);
  const restored=restoreTabGroups({byProject:false,focus:'yes',custom:[{id:'x',name:'',color:'red',members:['a1',4,'a1']},{id:'x',members:['b1']},{id:'y',members:[]}],projectColors:{a:'#9be1c4',b:'red'},projectCollapsed:['a',3]});
  assert.equal(restored.byProject,false);assert.equal(restored.focus,false);assert.equal(restored.shrink,true);
  assert.deepEqual(restored.custom,[{id:'x',name:'Group',color:GROUP_COLORS[4].value,collapsed:false,members:['a1']}]);
  assert.deepEqual(restored.projectColors,{a:'#9be1c4'});assert.deepEqual(restored.projectCollapsed,['a']);
  assert.deepEqual(restoreTabGroups('junk'),defaultTabGroups());
});

test('group shortcuts use key codes so Option does not change digits',()=>{
  const k=(key:string,code:string,mods:Partial<Record<'metaKey'|'ctrlKey'|'shiftKey'|'altKey',boolean>>)=>groupShortcut({key,code,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...mods});
  assert.equal(k('g','KeyG',{metaKey:true}),'group-selected');
  assert.equal(k('G','KeyG',{metaKey:true,shiftKey:true}),'toggle-project-groups');
  assert.equal(k('j','KeyJ',{metaKey:true}),'next-attention');
  assert.equal(k('ArrowRight','ArrowRight',{metaKey:true,altKey:true}),'next-group');
  assert.equal(k('ArrowLeft','ArrowLeft',{metaKey:true,altKey:true}),'previous-group');
  assert.equal(k('¡','Digit1',{metaKey:true,altKey:true}),1);
  assert.equal(k('ArrowLeft','ArrowLeft',{metaKey:true}),undefined);
  assert.equal(k('g','KeyG',{ctrlKey:true}),undefined);
  assert.equal(k('1','Digit1',{metaKey:true}),undefined);
});

test('folding moves the view to the most recent chat still shown, else to the overview',async()=>{
  const {foldView,splitFor}=await import('../src/shared/folding');
  const {leaf,dropPane,paneIds}=await import('../src/shared/panes');
  const split=dropPane(dropPane(leaf('a1'),'a1','a2','right'),'a2','b1','bottom');
  assert.deepEqual(paneIds(split),['a1','a2','b1']);
  // Folding a group that shares the screen keeps the other pane, selecting it.
  assert.deepEqual(foldView(split,'a1',['a1','a2'],['b1','b2'],['a1','b2','b1']),{layout:leaf('b1'),selected:'b1'});
  // Folding the only group on screen switches to the most recently used chat still in the strip.
  assert.deepEqual(foldView(leaf('a1'),'a1',['a1','a2'],['b1','b2','c1'],['a1','c1','b1']),{layout:leaf('c1'),selected:'c1'});
  assert.deepEqual(foldView(leaf('a1'),'a1',['a1'],['b1'],[]),{layout:leaf('b1'),selected:'b1'});
  // A selection outside the folded group stays.
  assert.deepEqual(foldView(split,'b1',['a1','a2'],['b1'],[]),{layout:leaf('b1'),selected:'b1'});
  // Nothing left: the overview.
  assert.deepEqual(foldView(leaf('a1'),'a1',['a1'],[],['a1']),{layout:null});
  assert.deepEqual(paneIds(splitFor(split,['a1','a2'])),['a1','a2']);
  assert.equal(splitFor(split,['c1']),null);
});
