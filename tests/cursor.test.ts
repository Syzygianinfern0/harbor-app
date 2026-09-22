import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { cursorArguments } from '../src/desktop/cursor';

test('Cursor local folder URI preserves spaces, punctuation and Unicode without shell evaluation',()=>{
  const args=cursorArguments({connection:'local',cwd:"/tmp/a 'quote' $(literal) #你好"});
  assert.equal(args[0],'--new-window');assert.equal(args[1],'--folder-uri');
  assert.equal(decodeURIComponent(new URL(args[2]).pathname),"/tmp/a 'quote' $(literal) #你好");
  assert.throws(()=>cursorArguments({connection:'local',cwd:'--command'}),/absolute/);
});
test('Cursor remote authorities retain SSH aliases, explicit overrides and literal remote paths',()=>{
  const args=cursorArguments({connection:{target:'old@research',user:'alice',hostname:'gpu.example',port:2222,identityFile:'~/.ssh/a key'},cwd:'/data/My project #1/你好'});
  const url=new URL(args[2]);assert.equal(url.protocol,'vscode-remote:');
  const authority=JSON.parse(Buffer.from(url.host.slice('ssh-remote+'.length),'hex').toString());
  assert.deepEqual(authority,{hostName:'research',user:'alice',port:2222,sshArgs:['-o','Hostname=gpu.example','-i',homedir()+'/.ssh/a key'],userInDestination:true});
  assert.equal(decodeURIComponent(url.pathname),'/data/My project #1/你好');
  const simple=new URL(cursorArguments({connection:'alice@devbox',cwd:'/home/alice'})[2]);
  assert.deepEqual(JSON.parse(Buffer.from(simple.host.slice(11),'hex').toString()),{hostName:'devbox',user:'alice'});
  assert.throws(()=>cursorArguments({connection:{target:'-oProxyCommand=evil'},cwd:'/tmp'}),/valid SSH/);
});
