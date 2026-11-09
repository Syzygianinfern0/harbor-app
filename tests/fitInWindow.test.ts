import test from 'node:test';
import assert from 'node:assert/strict';
import { fitInWindow } from '../src/renderer/fitInWindow';

const view={width:1000,height:600};

test('a menu opens at the click point when it fits',()=>{
  assert.deepEqual(fitInWindow({left:100,top:100},240,300,view),{left:100,top:100,maxHeight:undefined});
});

test('a menu flips above and to the left of a click near the bottom-right corner',()=>{
  assert.deepEqual(fitInWindow({left:900,top:500},240,350,view),{left:660,top:150,maxHeight:undefined});
});

test('a menu with room on neither side slides to fit inside the margin',()=>{
  // 400 tall at y=250: below would end at 650, above would start at -150; it ends at the bottom margin instead.
  assert.deepEqual(fitInWindow({left:100,top:250},240,400,view),{left:100,top:192,maxHeight:undefined});
});

test('a menu taller than the window pins to the top and scrolls',()=>{
  assert.deepEqual(fitInWindow({left:100,top:400},240,700,view),{left:100,top:8,maxHeight:584});
});

test('a button menu opens below it, flips above it, and can align to its right edge',()=>{
  const button={left:500,right:520,top:200,bottom:220};
  assert.deepEqual(fitInWindow({...button,align:'end'},150,170,view),{left:370,top:220,maxHeight:undefined});
  assert.deepEqual(fitInWindow({...button,top:500,bottom:520},150,170,view),{left:500,top:330,maxHeight:undefined});
});
