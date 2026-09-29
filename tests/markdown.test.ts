import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineText, listRegions, parseBlocks, parseInline, scanLines, type List, type ListNode } from '../src/shared/markdown';

const shape=(n:ListNode):unknown=>({line:n.line,end:n.end,content:n.content,...(n.task?{checked:n.checked}:{}),...(n.priority<4?{p:n.priority}:{}),...(n.children.length?{children:n.children.map(shape)}:{})});

test('headings, paragraphs and fenced code',()=>{
  assert.deepEqual(parseBlocks('# Title\n## Sub ##\n### Third\n#### Deep\n#nottag\n\nOne line\nsecond line\n\n```\n- not a list\n# not a heading\n```\nafter'),[
    {t:'heading',level:1,text:'Title'},{t:'heading',level:2,text:'Sub'},{t:'heading',level:3,text:'Third'},{t:'heading',level:3,text:'Deep'},
    {t:'para',lines:['#nottag']},{t:'para',lines:['One line','second line']},{t:'code',v:'- not a list\n# not a heading'},{t:'para',lines:['after']}]);
  assert.deepEqual(parseBlocks('# C#'),[{t:'heading',level:1,text:'C#'}]);
  assert.deepEqual(parseBlocks('```\nunclosed'),[{t:'code',v:'unclosed'}]);
});

test('inline bold, italic and code, with literal fallbacks',()=>{
  assert.deepEqual(parseInline('a **b** *c* _d_ `e*f*` __g__'),[{t:'text',v:'a '},{t:'strong',c:[{t:'text',v:'b'}]},{t:'text',v:' '},{t:'em',c:[{t:'text',v:'c'}]},{t:'text',v:' '},{t:'em',c:[{t:'text',v:'d'}]},{t:'text',v:' '},{t:'code',v:'e*f*'},{t:'text',v:' '},{t:'strong',c:[{t:'text',v:'g'}]}]);
  assert.deepEqual(parseInline('**bold *and italic***'),[{t:'strong',c:[{t:'text',v:'bold '},{t:'em',c:[{t:'text',v:'and italic'}]}]}]);
  assert.deepEqual(parseInline('*a **b** c*'),[{t:'em',c:[{t:'text',v:'a '},{t:'strong',c:[{t:'text',v:'b'}]},{t:'text',v:' c'}]}]);
  assert.deepEqual(parseInline('snake_case_name and 2 * 3 * 4 and **open'),[{t:'text',v:'snake_case_name and 2 * 3 * 4 and **open'}]);
  assert.deepEqual(parseInline('\\*not\\* `unclosed'),[{t:'text',v:'*not* `unclosed'}]);
  assert.equal(inlineText(parseInline('<b>x</b> & **y**')),'<b>x</b> & y');
});

test('HTML in notes stays text',()=>{
  const blocks=parseBlocks('<script>alert(1)</script>\n- <img src=x onerror=alert(1)>');
  assert.deepEqual(blocks[0],{t:'para',lines:['<script>alert(1)</script>']});
  assert.equal((blocks[1] as List).items[0].content,'<img src=x onerror=alert(1)>');
});

test('lists nest by indentation and carry tasks, priorities and continuation lines',()=>{
  const text='- [ ] Parent !p1\n  continued\n  - [x] Child done\n  - Child two !P3\n    1. deep\n    2. deeper\n- [X] Second\n\n1) one\n7) two\n- switch';
  const regions=listRegions(scanLines(text));
  assert.equal(regions.length,2);
  assert.deepEqual(regions[0].roots.map(shape),[
    {line:0,end:6,content:'Parent',checked:false,p:1,children:[{line:2,end:3,content:'Child done',checked:true},{line:3,end:6,content:'Child two',p:3,children:[{line:4,end:5,content:'deep'},{line:5,end:6,content:'deeper'}]}]},
    {line:6,end:7,content:'Second',checked:true}]);
  assert.deepEqual(regions[0].roots[0].more,['continued']);
  const blocks=parseBlocks(text) as List[];
  assert.deepEqual(blocks.map(b=>[b.ordered,b.start,b.items.length]),[[false,1,2],[true,1,2],[false,1,1]]);
  assert.deepEqual(blocks[0].items[0].children.map(c=>c.ordered),[false,false]);
});

test('tabs indent like four spaces; an unindented paragraph ends the list',()=>{
  const regions=listRegions(scanLines('- a\n\t- b\nplain\n-\n- [ ]'));
  assert.deepEqual(regions.map(r=>r.roots.map(shape)),[[{line:0,end:2,content:'a',children:[{line:1,end:2,content:'b'}]}],[{line:3,end:4,content:''},{line:4,end:5,content:'',checked:false}]]);
  assert.equal(scanLines('**bold** start')[0].kind,'text');assert.equal(scanLines('*em* start')[0].kind,'text');assert.equal(scanLines('---')[0].kind,'text');
});
