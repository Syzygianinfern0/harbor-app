import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHATS=[['a1','Tab groups design'],['a2','Fix SSH reattach'],['a3','Release notes']] as const;

test('double-clicking a chat name renames it in place in the sidebar and the tab strip',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-inline-rename-'));const createdAt=new Date().toISOString();
  const projects=[{id:'app',name:'Agent-Manager',cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt}];
  const sessions=CHATS.map(([id,name],i)=>({id,tmuxName:`harbor-cccc${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId:'app',hasMessages:true}));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  const app=await electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:`harbor-test-rename-${process.pid}`}});
  const saved=async(id:string)=>JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8')).sessions.find((s:{id:string})=>s.id===id).name;
  try {
    const page=await app.firstWindow();
    const row=(name:string)=>page.locator('.sidebar .chat-row',{hasText:name});
    const field=page.locator('.inline-rename');
    // A single click still just opens the chat.
    await row('Fix SSH reattach').click();
    await expect(page.locator('[data-tab-id="a2"]')).toHaveCount(1);await expect(field).toHaveCount(0);

    // Sidebar: double-click edits the name with it selected; Enter saves through the normal rename.
    await row('Tab groups design').dblclick();
    await expect(field).toHaveCount(1);await expect(field).toBeFocused();await expect(field).toHaveValue('Tab groups design');
    expect(await field.evaluate((el:HTMLInputElement)=>[el.selectionStart,el.selectionEnd])).toEqual([0,'Tab groups design'.length]);
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/inline-rename-sidebar.png'});
    await page.keyboard.type('Tab folding');await page.keyboard.press('Enter');
    await expect(field).toHaveCount(0);await expect(row('Tab folding')).toHaveCount(1);
    await expect.poll(()=>saved('a1')).toBe('Tab folding');
    // The double-click's own clicks opened the chat, as a single click does.
    await expect(page.locator('[data-tab-id="a1"]')).toHaveCount(1);

    // Escape cancels without saving, and doesn't leak to other Escape handlers.
    await row('Release notes').dblclick();await page.keyboard.type('Discarded');await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);await expect(row('Release notes')).toHaveCount(1);expect(await saved('a3')).toBe('Release notes');

    // Clicking away saves; a blank name is ignored.
    await row('Release notes').dblclick();await page.keyboard.type('Changelog');await page.locator('.brand').click();
    await expect(row('Changelog')).toHaveCount(1);await expect.poll(()=>saved('a3')).toBe('Changelog');
    await row('Changelog').dblclick();await page.keyboard.press('Backspace');await page.keyboard.press('Enter');
    await expect(row('Changelog')).toHaveCount(1);expect(await saved('a3')).toBe('Changelog');

    // Tab strip: double-click a tab's name to rename it there; the sidebar follows.
    const tab=page.locator('[data-tab-id="a2"]');
    await tab.locator('.tab-name').dblclick();
    await expect(tab.locator('.inline-rename')).toBeFocused();await expect(tab).not.toHaveAttribute('draggable','true');
    await page.screenshot({path:'test-results/screenshots/inline-rename-tab.png'});
    await page.keyboard.type('Reattach over SSH');await page.keyboard.press('Enter');
    await expect(tab.locator('.tab-name')).toHaveText('Reattach over SSH');await expect(row('Reattach over SSH')).toHaveCount(1);
    await expect.poll(()=>saved('a2')).toBe('Reattach over SSH');
    // Escape in a tab cancels too, and the tab stays open.
    await tab.locator('.tab-name').dblclick();await page.keyboard.type('Nope');await page.keyboard.press('Escape');
    await expect(tab.locator('.tab-name')).toHaveText('Reattach over SSH');await expect(page.locator('[data-tab-id]')).toHaveCount(3);
    // ⌘-double-click is still tab multi-selection, not rename.
    await tab.locator('.tab-name').dblclick({modifiers:['Meta']});await expect(field).toHaveCount(0);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
