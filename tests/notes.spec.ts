import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('chat notes are added on hover, previewed on hover, edited on click, and managed from the context menu',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-notes-'));
  const createdAt=new Date().toISOString();
  const projects=[{id:'project',name:'Notes project',cwd:dir,connection:'local',hostLabel:'This Mac',createdAt}];
  const session=(id:string,name:string)=>({id,name,projectId:'project',cwd:dir,host:'local',launcher:'codex',hasMessages:true,status:'closed',activity:'closed',tmuxName:`harbor-${id}`,paneId:'%9999',tags:[],group:'',pinned:false,archived:false,createdAt,updatedAt:createdAt});
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions:[session('aaaa','First chat'),session('bbbb','Second chat')]}));
  const app=await electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  try {
    const page=await app.firstWindow();
    await app.evaluate(({ipcMain})=>{
      ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));
      ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});
    });
    const sidebar=page.locator('.sidebar');
    const first=sidebar.getByRole('button',{name:'First chat Closed',exact:true});
    const marker=first.locator('.chat-note');
    await expect(marker).toBeHidden();
    await first.hover();await expect(marker).toBeVisible();
    expect(Number(await marker.evaluate(el=>getComputedStyle(el).opacity))).toBeLessThan(.6);
    await marker.hover();await expect(page.getByRole('tooltip')).toHaveText('Add note');
    await marker.click();
    const editor=page.getByRole('dialog',{name:'Note for First chat'});
    await expect(editor.getByRole('textbox',{name:'Note'})).toBeFocused();
    await expect(page.locator('.session-toolbar')).toHaveCount(0); // clicking the marker must not open the chat
    await page.keyboard.type('Check the migration\nthen deploy');
    await page.keyboard.press('Meta+Enter');await expect(editor).toHaveCount(0);
    await expect.poll(async()=>JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8')).sessions.find((s:any)=>s.id==='aaaa').note).toBe('Check the migration\nthen deploy');
    await page.mouse.move(600,400);await expect(marker).toBeVisible();await expect(first.locator('.chat-note[data-note="saved"]')).toHaveCount(1);
    await expect(sidebar.getByRole('button',{name:'Second chat Closed',exact:true}).locator('.chat-note')).toBeHidden();
    await marker.hover();await expect(page.getByRole('tooltip')).toHaveText('Check the migration\nthen deploy');
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/chat-note-peek.png'});
    await marker.click();await editor.getByRole('textbox',{name:'Note'}).fill('Edited note');
    await page.screenshot({path:'test-results/screenshots/chat-note-editor.png'});
    await page.mouse.click(700,300);await expect(editor).toHaveCount(0); // clicking away keeps the edit
    await expect.poll(async()=>JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8')).sessions.find((s:any)=>s.id==='aaaa').note).toBe('Edited note');
    await marker.click();await editor.getByRole('textbox',{name:'Note'}).fill('Discard me');await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);await page.mouse.move(600,400);await marker.hover();await expect(page.getByRole('tooltip')).toHaveText('Edited note');
    await first.click({button:'right'});await page.getByRole('menuitem',{name:'Edit note…'}).click();
    await editor.getByRole('button',{name:'Remove'}).click();await expect(editor).toHaveCount(0);
    await page.mouse.move(600,400);await expect(marker).toBeHidden();
    const second=sidebar.getByRole('button',{name:'Second chat Closed',exact:true});
    await second.click({button:'right'});await page.getByRole('menuitem',{name:'Add note…'}).click();
    await page.getByRole('dialog',{name:'Note for Second chat'}).getByRole('textbox').fill('From the menu');
    await page.getByRole('dialog',{name:'Note for Second chat'}).getByRole('button',{name:'Save'}).click();
    await page.mouse.move(600,400);await expect(second.locator('.chat-note[data-note="saved"]')).toBeVisible();
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
