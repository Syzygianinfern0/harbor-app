import test from 'node:test';
import assert from 'node:assert/strict';
import { addTask, deleteTask, editTask, indentTask, insertTask, itemLines, outdentTask, moveTask, nudgeTask, renumber, setPriority, toggleTask } from '../src/shared/todos';

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

test('editing an item rewrites only its own text, keeping marker, checkbox, priority and the rest of the note',()=>{
  const text=note('# Plan','- [ ] old !p2','  more detail','* [x] done','1. step','after');
  assert.equal(editTask(text,1,'new **text**'),text.replace('- [ ] old !p2','- [ ] new **text** !p2'));
  assert.equal(editTask(text,3,'finished'),text.replace('* [x] done','* [x] finished'));
  assert.equal(editTask(text,4,'first\nsecond'),text.replace('1. step','1. first second'));
  assert.equal(editTask(text,1,''),text.replace('- [ ] old !p2','- [ ] !p2'));
  assert.equal(editTask(note('- [ ]'),0,'x'),'- [ ] x');
  assert.equal(editTask(text,0,'nope'),text); // a heading is not an item
});

test('Enter inserts the next item of the same kind, or a first child above existing children',()=>{
  const text=note('- [x] a','- [ ] b','  - [ ] b1','- plain','','1. one','2. two');
  assert.deepEqual(insertTask(text,0,'new'),{text:note('- [x] a','- [ ] new','- [ ] b','  - [ ] b1','- plain','','1. one','2. two'),line:1});
  assert.deepEqual(insertTask(text,1),{text:note('- [x] a','- [ ] b','  - [ ] ','  - [ ] b1','- plain','','1. one','2. two'),line:2});
  assert.deepEqual(insertTask(text,3),{text:note('- [x] a','- [ ] b','  - [ ] b1','- plain','- ','','1. one','2. two'),line:4});
  assert.deepEqual(insertTask(text,5,'half'),{text:note('- [x] a','- [ ] b','  - [ ] b1','- plain','','1. one','2. half','3. two'),line:6});
  assert.equal(insertTask(text,4),undefined);
});

test('Add item appends an unchecked task above the checked ones, or starts a checklist',()=>{
  assert.deepEqual(addTask(note('- [ ] a','  - [ ] a1','- [x] b','','tail'),0,'c'),{text:note('- [ ] a','  - [ ] a1','- [ ] c','- [x] b','','tail'),line:2});
  assert.deepEqual(addTask(note('- [ ] a','- [ ] b','','tail'),1),{text:note('- [ ] a','- [ ] b','- [ ] ','','tail'),line:2});
  assert.deepEqual(addTask(note('1. [x] a','2. [x] b'),0),{text:note('1. [ ] ','2. [x] a','3. [x] b'),line:0});
  // Only the run of the same list style: bullets after a numbered run are another list.
  assert.deepEqual(addTask(note('1. [ ] a','- [ ] b'),0),{text:note('1. [ ] a','2. [ ] ','- [ ] b'),line:1});
  assert.deepEqual(addTask('',undefined,'first'),{text:'- [ ] first',line:0});
  assert.deepEqual(addTask('# Plan\nSome text\n\n',undefined),{text:note('# Plan','Some text','','- [ ] '),line:3});
});

test('deleting an item removes its subtree and tidies the numbers and blank lines around it',()=>{
  const text=note('# Plan','- [ ] a','  - [ ] a1','    detail','- [ ] b','','after');
  assert.equal(deleteTask(text,1),note('# Plan','- [ ] b','','after'));
  assert.equal(deleteTask(text,2),note('# Plan','- [ ] a','- [ ] b','','after'));
  assert.equal(deleteTask(note('1. a','2. b','3. c'),0),note('1. b','2. c'));
  assert.equal(deleteTask(note('4. a','5. b'),1),'4. a');
  assert.equal(deleteTask(note('Intro','','- [ ] only','','after'),2),note('Intro','','after'));
  assert.equal(deleteTask(note('- [ ] only','','after'),0),'after');
  assert.equal(deleteTask(note('Intro','','- [ ] only'),2),'Intro');
  assert.equal(deleteTask('- [ ] only',0),'');
  assert.equal(deleteTask(text,0),text);
});

test('nudging moves an item one place among its siblings with its subtree',()=>{
  const text=note('- a','  - a1','- b','- c');
  assert.deepEqual(nudgeTask(text,2,-1),{text:note('- b','- a','  - a1','- c'),line:0});
  assert.deepEqual(nudgeTask(text,0,1),{text:note('- b','- a','  - a1','- c'),line:1});
  assert.deepEqual(nudgeTask(text,2,1),{text:note('- a','  - a1','- c','- b'),line:3});
  assert.equal(nudgeTask(text,0,-1),undefined);assert.equal(nudgeTask(text,3,1),undefined);assert.equal(nudgeTask(text,1,1),undefined);
  assert.deepEqual(nudgeTask(note('1. x','2. y'),1,-1),{text:note('1. y','2. x'),line:0});
  assert.deepEqual(itemLines(note('# h','- a','  text','  - b','','c','1. d')),[1,3,6]);
});

test('Tab nests an item under the one above; Shift-Tab lifts it out after its parent',()=>{
  const text=note('- [ ] a','- [ ] b','  - [ ] b1','- [ ] c','  more','  - [ ] c1');
  assert.deepEqual(indentTask(text,1),{text:note('- [ ] a','  - [ ] b','    - [ ] b1','- [ ] c','  more','  - [ ] c1'),line:1});
  assert.deepEqual(indentTask(text,3),{text:note('- [ ] a','- [ ] b','  - [ ] b1','  - [ ] c','    more','    - [ ] c1'),line:3});
  assert.equal(indentTask(text,0),undefined);assert.equal(indentTask(text,2),undefined);
  assert.deepEqual(indentTask(note('1. one','2. two','3. three'),1),{text:note('1. one','   1. two','2. three'),line:1});
  assert.deepEqual(indentTask(note('- a','  * a1','- b'),2),{text:note('- a','  * a1','  * b'),line:2});
  assert.deepEqual(outdentTask(text,2),{text:note('- [ ] a','- [ ] b','- [ ] b1','- [ ] c','  more','  - [ ] c1'),line:2});
  assert.deepEqual(outdentTask(note('- p','  - x','  - y','- q'),1),{text:note('- p','  - y','- x','- q'),line:2});
  assert.equal(outdentTask(text,0),undefined);
  // Round trip.
  assert.equal(outdentTask(indentTask(text,1)!.text,1)!.text,text);
});
