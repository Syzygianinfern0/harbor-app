import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('projects take notes, and the notes-only switch filters chats and projects',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-project-notes-'));
  const createdAt=new Date().toISOString();
  const project=(id:string,name:string)=>({id,name,cwd:dir,connection:'local',hostLabel:'This Mac',createdAt});
  const session=(id:string,name:string,projectId:string,note?:string)=>({id,name,projectId,cwd:dir,host:'local',launcher:'codex',hasMessages:true,status:'closed',activity:'closed',tmuxName:`harbor-${id}`,paneId:'%9999',tags:[],group:'',pinned:false,archived:false,createdAt,updatedAt:createdAt,...(note?{note}:{})});
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[project('alpha','Alpha project'),project('beta','Beta project'),project('gamma','Gamma project')],sessions:[session('a1','Alpha noted','alpha','Keep'),session('a2','Alpha plain','alpha'),session('b1','Beta plain','beta')]}));
  const app=await electron.launch({args:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  try {
    const page=await app.firstWindow();
    await app.evaluate(({ipcMain})=>{
      ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));
      ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});
    });
    const sidebar=page.locator('.sidebar');
    const heading=sidebar.locator('.project-heading',{hasText:'Beta project'});
    const marker=heading.locator('.chat-note');
    await expect(marker).toBeHidden();
    await heading.hover();await expect(marker).toBeVisible();
    await marker.hover();await expect(page.getByRole('tooltip')).toHaveText('Add note');
    await marker.click();
    const editor=page.getByRole('dialog',{name:'Note for Beta project'});
    await expect(editor.getByRole('textbox',{name:'Note'})).toBeFocused();
    await page.keyboard.type('Staging box — ask before restarting');
    await page.keyboard.press('Meta+Enter');await expect(editor).toHaveCount(0);
    await expect.poll(async()=>JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8')).projects.find((p:any)=>p.id==='beta').note).toBe('Staging box — ask before restarting');
    await expect(page.locator('.project-overview h1')).not.toHaveText('Beta project'); // the marker must not select the project
    await page.mouse.move(700,400);await expect(heading.locator('.chat-note[data-note="saved"]')).toBeVisible();
    await expect(sidebar.locator('.project-heading',{hasText:'Alpha project'}).locator('.chat-note')).toBeHidden();
    await marker.hover();await expect(page.getByRole('tooltip')).toHaveText('Staging box — ask before restarting');
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/project-note-peek.png'});

    // Context menu edit on another project.
    await sidebar.locator('.project-heading',{hasText:'Gamma project'}).click({button:'right'});
    await page.getByRole('menuitem',{name:'Add note…'}).click();
    await page.getByRole('dialog',{name:'Note for Gamma project'}).getByRole('textbox').fill('Gamma note');
    await page.getByRole('dialog',{name:'Note for Gamma project'}).getByRole('button',{name:'Save'}).click();
    await expect.poll(async()=>JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8')).projects.find((p:any)=>p.id==='gamma').note).toBe('Gamma note');

    // Notes-only switch: noted chats stay, plain chats hide, projects without any note disappear.
    const toggle=sidebar.getByRole('switch',{name:'Only show chats with notes'});
    await expect(toggle).not.toBeChecked();
    await sidebar.getByText('Only show chats with notes').click();await expect(toggle).toBeChecked();
    await expect(sidebar.getByRole('button',{name:'Alpha noted Closed',exact:true})).toBeVisible();
    await expect(sidebar.getByRole('button',{name:'Alpha plain Closed',exact:true})).toHaveCount(0);
    await expect(sidebar.getByRole('button',{name:'Beta plain Closed',exact:true})).toHaveCount(0);
    await expect(heading).toBeVisible();await expect(sidebar.locator('.project-section',{hasText:'Beta project'}).getByText('No chats with notes')).toBeVisible();
    await page.screenshot({path:'test-results/screenshots/notes-only-filter.png'});
    // Removing Beta's note drops the project from the filtered list.
    await heading.click({button:'right'});await page.getByRole('menuitem',{name:'Edit note…'}).click();
    await page.getByRole('dialog',{name:'Note for Beta project'}).getByRole('button',{name:'Remove'}).click();
    await expect(sidebar.locator('.project-heading',{hasText:'Beta project'})).toHaveCount(0);
    // The switch persists across reloads.
    await page.reload();await expect(sidebar.getByRole('switch',{name:'Only show chats with notes'})).toBeChecked();
    await expect(sidebar.getByRole('button',{name:'Alpha plain Closed',exact:true})).toHaveCount(0);
    await sidebar.getByText('Only show chats with notes').click();
    await expect(sidebar.getByRole('button',{name:'Alpha plain Closed',exact:true})).toBeVisible();
    await expect(sidebar.locator('.project-heading',{hasText:'Beta project'})).toBeVisible();
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
