import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteMarkdown, taskCounts } from '../src/renderer/NoteMarkdown';

const html=(text:string,interactive=false)=>renderToStaticMarkup(createElement(NoteMarkdown,{text,onChange:interactive?()=>{}:undefined}));

test('rendered notes escape everything a note contains',()=>{
  const out=html('<script>alert(1)</script> & "q"\n- **<b onmouseover=x>b</b>** `<i>`\n# <h1>');
  assert.doesNotMatch(out,/<script|<b |<i>|<h1>/);
  assert.match(out,/&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; (&quot;|")q(&quot;|")/);
  assert.match(out,/<strong>&lt;b onmouseover=x&gt;b&lt;\/b&gt;<\/strong>/);assert.match(out,/<code>&lt;i&gt;<\/code>/);
});

test('structure: headings, nested lists, tasks with priorities, ordered start',()=>{
  const out=html('## Plan\n3. three\n4. four\n- [x] done !p2\n  - [ ] sub !p1');
  assert.match(out,/<h4 class="note-h2">Plan<\/h4>/);assert.match(out,/<ol class="note-list" start="3">/);
  assert.match(out,/class="note-check p2" role="checkbox" aria-checked="true" aria-label="done"/);
  assert.match(out,/<ul class="note-list"><li class="note-item task  p1/); // nested inside the parent item
  assert.doesNotMatch(out,/!p[12]/);
  const live=html('- [ ] t',true);assert.match(live,/<button type="button" role="checkbox"/);assert.match(live,/draggable="true"/);assert.match(live,/aria-label="Priority 4 · change priority"/);
  assert.deepEqual(taskCounts('- [x] a\n  - [ ] b\n* [X] c\n- d\n1. [ ] e\n[ ] no'),[2,4]);
});
