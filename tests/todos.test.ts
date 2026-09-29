import test from 'node:test';
import assert from 'node:assert/strict';
import { moveTask, renumber, setPriority, toggleTask } from '../src/shared/todos';

const note=(...lines:string[])=>lines.join('\n');

test('checking a task sinks it below its siblings; unchecking lifts it above the checked ones',()=>{
  const text=note('# Plan','- [ ] a','- [ ] b','- [x] c','- [ ] d','','after');
  const checked=toggleTask(text,1);
  assert.equal(checked,note('# Plan','- [ ] b','- [x] c','- [ ] d','- [x] a','','after'));
  assert.equal(toggleTask(checked,4),note('# Plan','- [ ] b','- [ ] a','- [x] c','- [ ] d','','after'));
  assert.equal(toggleTask(note('- [ ] only'),0),'- [x] only');
  assert.equal(toggleTask(note('- plain','- [ ] t'),0),note('- plain','- [ ] t')); // not a task
  assert.equal(toggleTask(note('text'),0),'text');
  assert.equal(toggleTask(note('* [X] upper','* [ ] two'),0),note('* [ ] upper','* [ ] two')); // already above any checked sibling
});

test('a checked parent takes its subtree and checks its subtasks; children sort within their parent',()=>{
  const text=note('- [ ] parent','  - [ ] kid 1','    detail','  - [ ] kid 2','    - [ ] grandkid','- [ ] next','- [x] done');
  assert.equal(toggleTask(text,0),note('- [ ] next','- [x] done','- [x] parent','  - [x] kid 1','    detail','  - [x] kid 2','    - [x] grandkid'));
  assert.equal(toggleTask(text,1),note('- [ ] parent','  - [ ] kid 2','    - [ ] grandkid','  - [x] kid 1','    detail','- [ ] next','- [x] done'));
  assert.equal(toggleTask(text,4),text.replace('- [ ] grandkid','- [x] grandkid')); // already last among its siblings
  // Unchecking the parent keeps its subtasks' state.
  const done=toggleTask(text,0);assert.equal(toggleTask(done,2),note('- [ ] next','- [ ] parent','  - [x] kid 1','    detail','  - [x] kid 2','    - [x] grandkid','- [x] done'));
});

test('numbered lists renumber after a task moves',()=>{
  assert.equal(toggleTask(note('1. [ ] a','2. [ ] b','3. [ ] c'),0),note('1. [ ] b','2. [ ] c','3. [x] a'));
  assert.equal(moveTask(note('1. a','2. b','3. c','','- x'),0,4,true),note('1. b','2. c','','- x','- a'));
  assert.equal(moveTask(note('4. a','5. b','','- x'),3,0,false),note('4. x','5. a','6. b',''));
  assert.equal(renumber(note('3) x','3) y','- z','1. w','1. v')),note('3) x','4) y','- z','1. w','2. v'));
});

test('priorities are a trailing token; P4 removes it',()=>{
  assert.equal(setPriority('- [ ] ship it',0,1),'- [ ] ship it !p1');
  assert.equal(setPriority('- [ ] ship it !p1',0,3),'- [ ] ship it !p3');
  assert.equal(setPriority('- [ ] ship it !P2  ',0,4),'- [ ] ship it');
  assert.equal(setPriority(note('x','- a','  - b'),2,2),note('x','- a','  - b !p2'));
  assert.equal(setPriority('not an item',0,1),'not an item');
});

test('moving an item carries its subtree and lands before or after the target subtree',()=>{
  const text=note('- a','  - a1','- b','- c','  - c1');
  assert.equal(moveTask(text,0,3,true),note('- b','- c','  - c1','- a','  - a1'));
  assert.equal(moveTask(text,3,0,false),note('- c','  - c1','- a','  - a1','- b'));
  assert.equal(moveTask(text,2,0,false),note('- b','- a','  - a1','- c','  - c1'));
  // No-ops and moves into itself have no plan.
  assert.equal(moveTask(text,2,0,true),undefined);assert.equal(moveTask(text,2,3,false),undefined);
  assert.equal(moveTask(text,0,1,true),undefined);assert.equal(moveTask(text,0,0,true),undefined);
  assert.equal(moveTask(text,0,9,true),undefined);
});

test('moving across depths re-indents the subtree and adopts the target list style',()=>{
  const text=note('- [ ] a','  - [ ] a1','    - [ ] a1x','- [ ] b','1. one','2. two');
  // Out of its parent to the top level.
  assert.equal(moveTask(text,1,3,true),note('- [ ] a','- [ ] b','- [ ] a1','  - [ ] a1x','1. one','2. two'));
  // Into another item's children, deeper.
  assert.equal(moveTask(text,3,2,false),note('- [ ] a','  - [ ] a1','    - [ ] b','    - [ ] a1x','1. one','2. two'));
  // Into a numbered list, renumbered.
  assert.equal(moveTask(text,3,4,true),note('- [ ] a','  - [ ] a1','    - [ ] a1x','1. one','2. [ ] b','3. two'));
  // Tabs are normalized to spaces when the depth changes.
  assert.equal(moveTask(note('- a','\t- b','- c'),1,2,true),note('- a','- c','- b'));
});

test('lists split by a blank line are separate, but items can move between them',()=>{
  const text=note('- [ ] a','- [ ] b','','- [ ] c');
  assert.equal(toggleTask(text,0),note('- [ ] b','- [x] a','','- [ ] c'));
  assert.equal(moveTask(text,3,0,false),note('- [ ] c','- [ ] a','- [ ] b',''));
});
