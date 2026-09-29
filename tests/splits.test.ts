import test from 'node:test';
import assert from 'node:assert/strict';
import { leaf, paneIds, type PaneNode } from '../src/shared/panes';
import { joinSplits, liveParked, restoreParked, showTab, splitRuns, splitSets } from '../src/shared/splits';
import { planStripDrop, stripRuns } from '../src/shared/dropCue';
import { arrangeTabs, createGroup, defaultTabGroups, layoutTabs } from '../src/shared/tabGroups';

const pair=(a:string,b:string,axis:'horizontal'|'vertical'='horizontal'):PaneNode=>({kind:'split',id:`${a}${b}`,axis,ratio:.5,first:leaf(a),second:leaf(b)});

test('showing a tab keeps splits whole: focus within, bring a parked split back, park the one left',()=>{
  const view=pair('a','b');
  assert.deepEqual(showTab(view,[],'b'),{layout:view,parked:[]});
  const alone=showTab(view,[],'c');assert.deepEqual(alone.layout,leaf('c'));assert.deepEqual(alone.parked,[view]);
  const back=showTab(alone.layout,alone.parked,'b');assert.equal(back.layout,view);assert.deepEqual(back.parked,[]);
  const other=pair('c','d');const swap=showTab(view,[other],'d');assert.equal(swap.layout,other);assert.deepEqual(swap.parked,[view]);
  assert.deepEqual(showTab(null,[],'a'),{layout:leaf('a'),parked:[]});
  assert.deepEqual(showTab(leaf('a'),[],'c'),{layout:leaf('c'),parked:[]});
  assert.deepEqual(splitSets(view,[pair('d','c')]),[['a','b'],['d','c']]);assert.deepEqual(splitSets(leaf('a'),[]),[]);
});

test('parked splits lose chats that are shown or closed, collapse below two, and restore without duplicates',()=>{
  const parked=[pair('a','b'),{kind:'split',id:'x',axis:'vertical',ratio:.4,first:leaf('c'),second:pair('d','e')} as PaneNode];
  assert.equal(liveParked(parked,leaf('z'),['a','b','c','d','e']),parked);
  assert.deepEqual(liveParked(parked,leaf('a'),['a','b','c','d','e']).map(paneIds),[['c','d','e']]);
  assert.deepEqual(liveParked(parked,null,['a','b','c','e']).map(paneIds),[['a','b'],['c','e']]);
  assert.deepEqual(liveParked([pair('a','b'),pair('b','c')],null,['a','b','c']).map(paneIds),[['a','b']]);
  const seen=new Set(['a']);
  assert.deepEqual(restoreParked([pair('a','b'),pair('c','d'),pair('d','e'),'junk',{kind:'split'}],['a','b','c','d','e'],seen).map(paneIds),[['c','d']]);
  assert.deepEqual(restoreParked(null,[],new Set()),[]);
});

test('a split\'s tabs sit together in pane order, and runs break at group edges',()=>{
  assert.deepEqual(joinSplits(['x','b','y','a','z'],[['a','b']]),['x','a','b','y','z']);
  assert.deepEqual(joinSplits(['x','b','y'],[['a','b']]),['x','b','y']);
  assert.deepEqual(joinSplits(['c','x','a','b'],[['a','b','c']]),['a','b','c','x']);
  const runs=splitRuns(['x','a','b',undefined,'c','d',undefined,'e'],[['a','b'],['c','e'],['d']]);
  assert.deepEqual(runs.get('a'),['a','b']);assert.equal(runs.get('b'),runs.get('a'));
  assert.deepEqual(runs.get('c'),['c']);assert.deepEqual(runs.get('e'),['e']);assert.deepEqual(runs.get('d'),['d']);assert.equal(runs.has('x'),false);
  // Within a project group the pair sits together; across groups each keeps its place.
  const project:Record<string,string>={a1:'a',a2:'a',a3:'a',b1:'b'};const projectOf=(id:string)=>project[id];
  const laid=layoutTabs(['a1','b1','a2','a3'],defaultTabGroups(),projectOf,['a','b'],[['a3','a1']]);
  assert.deepEqual(arrangeTabs(laid.segments),['a3','a1','a2','b1']);
  assert.deepEqual(stripRuns(laid.segments,[['a3','a1']]).get('a1'),['a3','a1']);
  const across=layoutTabs(['a1','b1'],defaultTabGroups(),projectOf,['a','b'],[['b1','a1']]);
  assert.deepEqual(stripRuns(across.segments,[['b1','a1']]).get('a1'),['a1']);
});

test('dragging a split tab moves the split as a unit and nothing lands inside it',()=>{
  const groups={...defaultTabGroups(),byProject:false};const state={tabs:['a','b','c','d','e'],groups,projectOf:()=>undefined,projectOrder:[],splits:[['b','c']]};
  assert.deepEqual(planStripDrop(state,{chat:'b'},{tab:'e'},'after')?.tabs,['a','d','e','b','c']);
  assert.deepEqual(planStripDrop(state,{chat:'c'},{tab:'a'},'before')?.tabs,['b','c','a','d','e']);
  assert.equal(planStripDrop(state,{chat:'b'},{tab:'c'},'after'),undefined);
  assert.equal(planStripDrop(state,{chat:'b'},{tab:'a'},'after'),undefined);
  // Beside a split means beside the whole split, on either of its tabs.
  assert.deepEqual(planStripDrop(state,{chat:'e'},{tab:'b'},'after')?.tabs,['a','b','c','e','d']);
  assert.deepEqual(planStripDrop(state,{chat:'e'},{tab:'c'},'before')?.tabs,['a','e','b','c','d']);
  assert.deepEqual(planStripDrop(state,{chat:'e'},{tab:'c'},'after')?.tabs,['a','b','c','e','d']);
  // Into a custom group, and a group beside a split, move both halves.
  const made=createGroup(groups,['e']);const grouped={...state,groups:made.state};
  const into=planStripDrop(grouped,{chat:'b'},{key:`g:${made.id}`},'into');assert.deepEqual(into?.groups.custom[0].members,['e','b','c']);
  assert.deepEqual(planStripDrop(grouped,{chat:'c'},{tab:'e'},'after')?.groups.custom[0].members,['e','b','c']);
  assert.deepEqual(planStripDrop(grouped,{group:`g:${made.id}`},{tab:'b'},'before')?.tabs,['a','e','b','c','d']);
  assert.equal(planStripDrop(grouped,{group:`g:${made.id}`},{tab:'c'},'before')?.tabs.join(),['a','e','b','c','d'].join());
});
