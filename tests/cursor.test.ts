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

const encodedFolder = (authority: object, folder = '/data/project') =>
  `vscode-remote://ssh-remote%2B${Buffer.from(JSON.stringify(authority)).toString('hex')}${folder}`;

test('Cursor reuses the exact existing SSH folder URI when resolved defaults match Harbor overrides',()=>{
  const existing='vscode-remote://ssh-remote%2Bresearch/data/project';
  const project={connection:{target:'research',hostname:'gpu.example',user:'alice',port:2222},cwd:'/data/project/'};
  const args=cursorArguments(project,[existing],{hostname:'gpu.example',user:'alice',port:2222});
  assert.equal(args[2],existing);
  // New-window is intentional: Cursor matches an existing folder first; an
  // unopened project must not replace a different project's active window.
  assert.equal(args[0],'--new-window');
});

test('Cursor matches equivalent encoded SSH authorities regardless of JSON field order',()=>{
  const existing=encodedFolder({port:2222,user:'alice',hostName:'research'});
  assert.equal(cursorArguments({connection:'research',cwd:'/data/project'},[existing],{user:'alice',port:2222})[2],existing);
});

test('Cursor does not focus a different SSH destination, user, port, key, alias or folder',()=>{
  const project={connection:{target:'research',hostname:'gpu.example',user:'alice',port:2222},cwd:'/data/project'};
  const defaults={hostname:'gpu.example',user:'alice',port:2222};
  for (const authority of [
    {hostName:'other'}, {hostName:'research',user:'bob'}, {hostName:'research',port:22},
    {hostName:'research',sshArgs:['-o','Hostname=other.example']},
    {hostName:'research',sshArgs:['-i','/tmp/other-key']},
    {hostName:'research',sshArgs:['-o','ProxyCommand=other']},
    {hostName:'research',sshArgs:['-i']},
  ]) {
    const existing=encodedFolder(authority);
    assert.notEqual(cursorArguments(project,[existing],defaults)[2],existing);
  }
  const otherFolder=encodedFolder({hostName:'research'},'/data/other');
  assert.notEqual(cursorArguments(project,[otherFolder],defaults)[2],otherFolder);
  const unknownDefaults=encodedFolder({hostName:'research'});
  assert.notEqual(cursorArguments(project,[unknownDefaults])[2],unknownDefaults);
});

test('Cursor tolerates malformed window state and preserves literal remote folder names',()=>{
  const existing=encodedFolder({hostName:'research'},'/data/My%20project%20%231/%E4%BD%A0%E5%A5%BD');
  assert.equal(cursorArguments({connection:'research',cwd:'/data/My project #1/你好'},['invalid',existing])[2],existing);
  const args=cursorArguments({connection:'research',cwd:'/data/project/'},['not a uri','vscode-remote://ssh-remote%2Bzz/data/project']);
  assert.equal(new URL(args[2]).pathname,'/data/project');
});
