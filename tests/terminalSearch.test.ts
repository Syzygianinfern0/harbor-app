import test from 'node:test';
import assert from 'node:assert/strict';
import { findShortcut, findStatus, groupShortcut, tabShortcut } from '../src/shared/shortcuts';
import { terminalSearchColors } from '../src/shared/terminalTheme';

const key=(key:string,mods:Partial<Record<'metaKey'|'ctrlKey'|'shiftKey'|'altKey',boolean>>={})=>({key,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...mods});

test('Command-F alone opens find and does not collide with tab or group shortcuts',()=>{
  assert.equal(findShortcut(key('f',{metaKey:true})),true);assert.equal(findShortcut(key('F',{metaKey:true})),true);
  for(const event of [key('f'),key('f',{ctrlKey:true}),key('f',{metaKey:true,shiftKey:true}),key('f',{metaKey:true,altKey:true}),key('g',{metaKey:true})])assert.equal(findShortcut(event),false);
  assert.equal(tabShortcut(key('f',{metaKey:true})),undefined);assert.equal(groupShortcut(key('f',{metaKey:true})),undefined);
  // ⌘G/⌘⇧G stay with tab groups.
  assert.equal(groupShortcut(key('g',{metaKey:true})),'group-selected');assert.equal(groupShortcut(key('g',{metaKey:true,shiftKey:true})),'toggle-project-groups');
});

test('find status reports position, totals, misses and the highlight cap',()=>{
  assert.equal(findStatus('',-1,0,1000),'');
  assert.equal(findStatus('x',-1,0,1000),'No results');
  assert.equal(findStatus('x',2,12,1000),'3 of 12');
  assert.equal(findStatus('x',-1,1,1000),'1 match');assert.equal(findStatus('x',-1,12,1000),'12 matches');
  assert.equal(findStatus('x',4,1000,1000),'5 of 1000+');
});

test('search highlight colors use the #RRGGBB form the addon requires',()=>{
  for(const color of Object.values(terminalSearchColors))assert.match(color,/^#[0-9a-f]{6}$/);
});
