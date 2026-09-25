import test from 'node:test';
import assert from 'node:assert/strict';
import { chatVisible, nextReveal } from '../src/shared/chatFilter';
import type { Session } from '../src/shared/types';

const chat=(id:string,projectId:string,extra:Partial<Session>={})=>({id,projectId,launcher:'codex',status:'closed',hasMessages:true,...extra}) as Session;
const closed=chat('a','p'),other=chat('b','q'),live=chat('c','q',{status:'running',activity:'idle'}),shell=chat('d','p',{launcher:'shell'}),noted=chat('e','p',{note:'todo'});

test('a revealed project shows its closed chats while every other project obeys the hide-closed toggle',()=>{
 const shown=(filter:Parameters<typeof chatVisible>[1])=>[closed,other,live,shell,noted].filter(s=>chatVisible(s,filter)).map(s=>s.id);
 assert.deepEqual(shown({hideClosed:false,notesOnly:false}),['a','b','c','e']);
 assert.deepEqual(shown({hideClosed:true,notesOnly:false}),['c']);
 assert.deepEqual(shown({hideClosed:true,notesOnly:false,reveal:'p'}),['a','c','e']);
 // Revealing does not bypass the notes-only filter, shell rows, or empty chats.
 assert.deepEqual(shown({hideClosed:true,notesOnly:true,reveal:'p'}),['e']);
 assert.equal(chatVisible(chat('f','p',{hasMessages:false}),{hideClosed:true,notesOnly:false,reveal:'p'}),false);
 assert.equal(chatVisible(chat('f','p',{hasMessages:false}),{hideClosed:true,notesOnly:false,reveal:'p',fresh:new Set(['f'])}),true);
 // A chat running outside Harbor is not "closed" and stays visible either way.
 assert.equal(chatVisible(chat('g','q',{externalActive:true}),{hideClosed:true,notesOnly:false}),true);
});

test('clicking a project name reveals it; clicking again from its overview hands it back to the toggle',()=>{
 assert.equal(nextReveal(undefined,'p',false),'p');
 assert.equal(nextReveal('p','p',true),undefined);
 assert.equal(nextReveal('p','p',false),'p');
 assert.equal(nextReveal('p','q',false),'q');
 assert.equal(nextReveal('p','q',true),'q');
});
