import test from 'node:test';
import assert from 'node:assert/strict';
import { dropSide, moveItem, planStripDrop, type StripState } from '../src/shared/dropCue';
import { arrangeTabs, createGroup, defaultTabGroups, groupKeys, layoutTabs, SETTINGS_TAB } from '../src/shared/tabGroups';

const project:Record<string,string>={a1:'a',a2:'a',a3:'a',b1:'b',b2:'b',c1:'c'};
const projectOf=(id:string)=>project[id];
const base=(tabs:string[],groups=defaultTabGroups()):StripState=>({tabs,groups,projectOf,projectOrder:['a','b','c']});
const shown=(s:StripState)=>{const {segments}=layoutTabs(s.tabs,s.groups,s.projectOf,s.projectOrder);return {tabs:arrangeTabs(segments),keys:groupKeys(segments)};};

test('pointer side splits a box at its midpoint on the list axis',()=>{
  const box={left:100,top:10,width:80,height:30};
  assert.equal(dropSide(box,139,0,'x'),'before');assert.equal(dropSide(box,141,0,'x'),'after');
  assert.equal(dropSide(box,0,24,'y'),'before');assert.equal(dropSide(box,0,26,'y'),'after');
});

test('list moves land beside the target and no-op moves have no plan',()=>{
  const ids=['a','b','c','d'];
  assert.deepEqual(moveItem(ids,'d','b',false),['a','d','b','c']);
  assert.deepEqual(moveItem(ids,'a','c',true),['b','c','a','d']);
  assert.equal(moveItem(ids,'a','b',false),undefined);// already right before b
  assert.equal(moveItem(ids,'c','b',true),undefined);// already right after b
  assert.equal(moveItem(ids,'b','b',true),undefined);assert.equal(moveItem(ids,'x','b',true),undefined);
});

test('a tab lands exactly where the line marks it, or the drop has no plan',()=>{
  const state=base(['a1','a2','a3','b1','b2']);
  const before=planStripDrop(state,{chat:'a3'},{tab:'a1'},'before')!;
  assert.deepEqual(shown({...state,...before}).tabs,['a3','a1','a2','b1','b2']);
  const after=planStripDrop(state,{chat:'a1'},{tab:'a2'},'after')!;
  assert.deepEqual(shown({...state,...after}).tabs,['a2','a1','a3','b1','b2']);
  // Already there, onto itself, or into another project's group (it would snap back to its own): no cue.
  assert.equal(planStripDrop(state,{chat:'a1'},{tab:'a2'},'before'),undefined);
  assert.equal(planStripDrop(state,{chat:'a1'},{tab:'a1'},'after'),undefined);
  assert.equal(planStripDrop(state,{chat:'a1'},{tab:'b1'},'before'),undefined);
  // A chat that is not a tab (dragged from the sidebar) has no place between tabs.
  assert.equal(planStripDrop(state,{chat:'c1'},{tab:'a1'},'before'),undefined);
});

test('a tab dropped beside a custom group member joins it; one dropped out of it leaves',()=>{
  const {state:groups,id}=createGroup(defaultTabGroups(),['b1','c1']);
  const state=base(['a1','a2','b1','c1','b2'],groups);
  const join=planStripDrop(state,{chat:'a2'},{tab:'c1'},'after')!;
  assert.deepEqual(join.groups.custom.find(g=>g.id===id)!.members,['b1','c1','a2']);
  const next=shown({...state,...join});assert.equal(next.tabs[next.tabs.indexOf('c1')+1],'a2');
  const leave=planStripDrop(state,{chat:'c1'},{tab:'a2'},'after');
  assert.equal(leave,undefined);// c1 would leave for project c's group, not land after a2
  const stay=planStripDrop(state,{chat:'b1'},{tab:'c1'},'after')!;
  assert.deepEqual(shown({...state,...stay}).tabs.slice(2,4),['c1','b1']);
});

test('dropping a tab into a group chip is valid only when it changes the tab’s group',()=>{
  const {state:groups,id}=createGroup(defaultTabGroups(),['b1']);
  const state=base(['a1','a2','b1','b2'],groups);
  const into=planStripDrop(state,{chat:'a1'},{key:`g:${id}`},'into')!;
  assert.deepEqual(into.groups.custom[0].members,['b1','a1']);
  assert.equal(planStripDrop(state,{chat:'b1'},{key:`g:${id}`},'into'),undefined);// already a member
  assert.equal(planStripDrop(state,{chat:'a1'},{key:'p:a'},'into'),undefined);// already in its project group
  assert.ok(planStripDrop(state,{chat:'b1'},{key:'p:b'},'into'));// back to its project from the custom group
  assert.equal(planStripDrop(state,{chat:'a1'},{key:'p:b'},'into'),undefined);// another project's group
  assert.deepEqual(planStripDrop(state,{chat:'a3'},{key:'p:a'},'into')!.tabs,['a1','a2','b1','b2','a3']);// opened from the sidebar
  assert.equal(planStripDrop(state,{chat:'a1'},{key:`g:${id}`},'before'),undefined);
});

test('a group lands as a block beside the target group, or has no plan',()=>{
  const state=base(['a1','a2','b1','c1']);
  const project=planStripDrop(state,{group:'p:c'},{key:'p:a'},'before')!;
  assert.deepEqual(project.project,{source:'c',target:'a',after:false});
  assert.deepEqual(shown({...state,...project}).keys,['p:c','p:a','p:b']);
  // Hovering a tab inside a group targets that whole group.
  const viaTab=planStripDrop(state,{group:'p:a'},{tab:'b1'},'after')!;
  assert.deepEqual(shown({...state,...viaTab}).keys,['p:b','p:a','p:c']);
  assert.equal(planStripDrop(state,{group:'p:a'},{key:'p:b'},'before'),undefined);// already there
  assert.equal(planStripDrop(state,{group:'p:a'},{tab:'a2'},'after'),undefined);// onto itself
  const {state:groups,id}=createGroup(defaultTabGroups(),['c1']);
  const custom=base(['a1','a2','b1','c1'],groups);
  const block=planStripDrop(custom,{group:`g:${id}`},{key:'p:a'},'before')!;
  assert.deepEqual(shown({...custom,...block}).tabs,['c1','a1','a2','b1']);
  // Project groups keep sidebar order among themselves, so one cannot move past a custom group: no cue.
  assert.equal(planStripDrop(custom,{group:'p:a'},{key:`g:${id}`},'after'),undefined);
});

test('the Settings tab moves beside whole groups and ungrouped tabs, and never joins a group',()=>{
  const S=SETTINGS_TAB,{state:custom,id}=createGroup(defaultTabGroups(),['b1','b2']);
  const state=base(['a1','a2','b1','b2',S],custom);
  assert.deepEqual(shown(state).tabs,['a1','a2','b1','b2',S]);
  // Onto a project group's tab or chip: it lands beside the whole group, ungrouped.
  for(const target of [{tab:'a2'},{tab:'a1'},{key:'p:a'}] as const){
    const plan=planStripDrop(state,{chat:S},target,'before')!;const laid=layoutTabs(plan.tabs,plan.groups,projectOf,plan.projectOrder);
    assert.deepEqual(arrangeTabs(laid.segments),[S,'a1','a2','b1','b2']);assert.equal(laid.keyOf.get(S),undefined);assert.equal(plan.groups,custom);
  }
  // Beside a custom group member it lands beside the group without joining it.
  const between=planStripDrop(state,{chat:S},{tab:'b1'},'before')!;
  assert.deepEqual(shown({...state,...between}).tabs,['a1','a2',S,'b1','b2']);assert.deepEqual(between.groups.custom.find(g=>g.id===id)!.members,['b1','b2']);
  // Never into a chip, and no plan where it already is.
  assert.equal(planStripDrop(state,{chat:S},{key:`g:${id}`},'into'),undefined);
  assert.equal(planStripDrop(state,{chat:S},{tab:'b2'},'after'),undefined);
  // A chat dropped beside Settings leaves its custom group, like beside any ungrouped tab.
  const moved=planStripDrop(base(['a1',S,'b1','b2'],custom),{chat:'b1'},{tab:S},'before')!;
  assert.deepEqual(moved.groups.custom.find(g=>g.id===id)!.members,['b2']);
});

test('Settings beside one project\'s tabs does not make that project\'s label appear',()=>{
  const {segments,keyOf}=layoutTabs(['a1','a2',SETTINGS_TAB],defaultTabGroups(),projectOf,['a']);
  assert.deepEqual(segments.map(s=>s.kind),['tab','tab','tab']);assert.equal(keyOf.get('a1'),undefined);
});
