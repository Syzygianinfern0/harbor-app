import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('refresh is aligned and clickable, and local/remote project menus hand off to the default Open in app',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-project-actions-'));
  const createdAt=new Date().toISOString();
  const projects=[{id:'local-project',name:'Local project',cwd:dir,connection:'local',hostLabel:'This Mac',createdAt},{id:'remote-project',name:'Remote project',cwd:'/data/Project #1',connection:{target:'research',port:2222},hostLabel:'Research server',createdAt}];
  const session={id:'closed',name:'Saved conversation',projectId:'local-project',cwd:dir,host:'local',launcher:'codex',hasMessages:true,status:'closed',activity:'closed',tmuxName:'harbor-aaaa',paneId:'%9999',tags:[],group:'',pinned:false,archived:false,createdAt,updatedAt:createdAt};
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions:[session]}));
  const app=await electron.launch({args:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  try {
    const page=await app.firstWindow();
    await app.evaluate(({ipcMain})=>{
      (globalThis as any).openedProjects=[];(globalThis as any).refreshClicks=0;
      ipcMain.removeHandler('harbor:openInApps');ipcMain.handle('harbor:openInApps',()=>['finder','cursor']);
      ipcMain.removeHandler('harbor:openIn');ipcMain.handle('harbor:openIn',(_e,target,app)=>{(globalThis as any).openedProjects.push([target.id,app]);});
      ipcMain.removeHandler('harbor:refresh');ipcMain.handle('harbor:refresh',()=>{(globalThis as any).refreshClicks++;});
      ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));
      ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});
    });
    for(const [name,item] of [['Local project','Open in Finder'],['Remote project','Open in Cursor']]){
      await page.getByRole('button',{name,exact:true}).click({button:'right'});
      await page.getByRole('menuitem',{name:item,exact:true}).click();
      await expect(page.getByRole('menu',{name:'Project actions'})).toHaveCount(0);
    }
    expect(await app.evaluate(()=>(globalThis as any).openedProjects)).toEqual([['local-project','finder'],['remote-project','cursor']]);
    const refresh=page.getByRole('button',{name:'Refresh all chats and status'});
    await expect(refresh).toHaveAttribute('title',/⌘ R/);
    await refresh.click();await expect.poll(()=>app.evaluate(()=>(globalThis as any).refreshClicks)).toBe(1);
    await page.getByRole('button',{name:'Saved conversation Closed',exact:true}).first().click();
    const actions=page.getByRole('button',{name:'Chat actions',exact:true});
    const a=await actions.boundingBox(),b=await refresh.boundingBox();
    expect(Math.abs((a!.y+a!.height/2)-(b!.y+b!.height/2))).toBeLessThan(1);
    expect(await refresh.evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
    expect(await refresh.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
    await expect(refresh).toBeEnabled();await refresh.click();await expect.poll(()=>app.evaluate(()=>(globalThis as any).refreshClicks)).toBe(2);
    await expect(refresh).toBeEnabled();await page.keyboard.press('Meta+r');await expect.poll(()=>app.evaluate(()=>(globalThis as any).refreshClicks)).toBe(3);
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/refresh-toolbar.png'});
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('update settings show cached automatic results and bulk progress survives closing Settings',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-bulk-ui-'));
  const app=await electron.launch({args:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  try {
    const page=await app.firstWindow();
    await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
    await app.evaluate(async ({ipcMain,BrowserWindow})=>{
      const original=await new Promise<any>(resolve=>{const window=BrowserWindow.getAllWindows()[0];window.webContents.executeJavaScript('window.harbor.snapshot()').then(resolve);});
      const row=(hostId:string,agent:string)=>({hostId,hostLabel:hostId,agent,status:'available',installed:'1.0.0',latest:'1.1.0',checkedAt:new Date().toISOString()});
      const state:any={updates:[row('This Mac','codex'),row('Research server','claude')],checking:false,updatingAll:false,checkedAt:Date.now(),results:{}};
      const contents=BrowserWindow.getAllWindows()[0].webContents;const send=contents.send.bind(contents);
      contents.send=(channel,...args)=>{if(channel==='harbor:snapshot-changed')args[0]={...args[0],agentUpdates:structuredClone(state)};send(channel,...args);};
      const publish=()=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:snapshot-changed',{...original,agentUpdates:structuredClone(state)});
      ipcMain.removeHandler('harbor:snapshot');ipcMain.handle('harbor:snapshot',()=>({...original,agentUpdates:structuredClone(state)}));
      ipcMain.removeHandler('harbor:checkUpdates');ipcMain.handle('harbor:checkUpdates',()=>state.updates);
      ipcMain.removeHandler('harbor:updateAllAgents');ipcMain.handle('harbor:updateAllAgents',async()=>{
        state.updatingAll=true;state.total=2;state.completed=0;publish();
        await new Promise(resolve=>setTimeout(resolve,1500));
        state.updates[0]={...state.updates[0],status:'current',installed:'1.1.0'};state.completed=2;state.updatingAll=false;
        state.results={'This Mac:codex':{message:'Verified: 1.1.0 is up to date.'},'Research server:claude':{message:'Update failed: SSH unavailable'}};publish();
      });
    });
    const open=async()=>{await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Updates',exact:true}).click();};
    await open();await expect(page.locator('.update-host')).toHaveCount(2);
    await page.getByRole('button',{name:'Update all (2)',exact:true}).click();
    await expect(page.getByText(/Updating agents across your machines/)).toBeVisible();
    await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Close Settings'}).click();await expect(page.locator('.settings-view')).toHaveCount(0);await open();
    await expect(page.locator('.updates-table')).toContainText('Verified: 1.1.0');
    await expect(page.locator('.updates-table')).toContainText('SSH unavailable');
    await expect(page.getByRole('button',{name:'Update all (1)',exact:true})).toBeEnabled();
    await page.screenshot({path:'test-results/screenshots/bulk-agent-updates.png'});
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('projects heading toggles between collapsing and expanding every project',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-fold-all-'));
  const createdAt=new Date().toISOString();
  const projects=[{id:'alpha',name:'Alpha project',cwd:dir,connection:'local',hostLabel:'This Mac',createdAt},{id:'beta',name:'Beta project',cwd:dir,connection:'local',hostLabel:'This Mac',createdAt}];
  const session=(id:string,projectId:string,name:string)=>({id,name,projectId,cwd:dir,host:'local',launcher:'codex',hasMessages:true,status:'closed',activity:'closed',tmuxName:`harbor-${id}`,paneId:'%9999',tags:[],group:'',pinned:false,archived:false,createdAt,updatedAt:createdAt});
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions:[session('a1','alpha','Alpha chat'),session('b1','beta','Beta chat')]}));
  const app=await electron.launch({args:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  try {
    const page=await app.firstWindow();
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});});
    const chat=(name:string)=>page.getByRole('complementary').getByRole('button',{name:`${name} Closed`,exact:true});
    await expect(chat('Alpha chat')).toBeVisible();await expect(chat('Beta chat')).toBeVisible();
    // A partially folded list still collapses everything first.
    await page.getByRole('button',{name:'Collapse project Alpha project',exact:true}).click();
    await expect(chat('Alpha chat')).toHaveCount(0);
    await page.getByRole('button',{name:'Collapse all projects',exact:true}).click();
    await expect(chat('Beta chat')).toHaveCount(0);await expect(chat('Alpha chat')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Expand project Beta project',exact:true})).toBeVisible();
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/projects-collapsed.png'});
    await page.getByRole('button',{name:'Expand all projects',exact:true}).click();
    await expect(chat('Alpha chat')).toBeVisible();await expect(chat('Beta chat')).toBeVisible();
    await expect(page.getByRole('button',{name:'Collapse all projects',exact:true})).toBeVisible();
    await page.screenshot({path:'test-results/screenshots/projects-expanded.png'});
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
