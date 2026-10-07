import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TODO=['# Release','Ship **v2** with `npm run package`.','- [ ] Write changelog','- [ ] Test upgrade','  - [ ] local','- [ ] Tag release !p1','- [x] Bump version','','Notes stay below.'].join('\n');

test('the Formatted view is an editable checklist: add, edit, split, delete, reorder and tick items in place',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-note-editing-'));
  const createdAt=new Date().toISOString();
  const projects=[{id:'project',name:'Notes project',cwd:dir,connection:'local',hostLabel:'This Mac',createdAt}];
  const session=(id:string,name:string,note?:string)=>({id,name,projectId:'project',cwd:dir,host:'local',launcher:'codex',hasMessages:true,status:'closed',activity:'closed',tmuxName:`harbor-${id}`,paneId:'%9999',tags:[],group:'',pinned:false,archived:false,createdAt,updatedAt:createdAt,...(note?{note}:{})});
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions:[session('aaaa','Todo chat',TODO),session('cccc','Plain chat')]}));
  const app=await electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  const saved=async(id:string)=>{const data=JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8'));return [...data.sessions,...data.projects].find((s:any)=>s.id===id)?.note;};
  try {
    const page=await app.firstWindow();
    await app.evaluate(({ipcMain})=>{
      ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));
      ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});
    });
    await mkdir('test-results/screenshots',{recursive:true});
    const sidebar=page.locator('.sidebar');

    await sidebar.getByRole('button',{name:'Todo chat Closed',exact:true}).locator('.chat-note').click();
    const editor=page.getByRole('dialog',{name:'Note for Todo chat'});
    await editor.getByRole('radio',{name:'Formatted'}).click();
    const view=editor.locator('.chat-note-rendered');const input=view.getByRole('textbox',{name:'Item text'});
    const order=()=>view.locator('.note-item-text,.note-item-input').evaluateAll(els=>els.map(el=>el instanceof HTMLTextAreaElement?`[${el.value}]`:(el as HTMLElement).innerText));

    // "Add item" adds an unchecked task above the ticked ones and puts the cursor in it; Enter adds the next one.
    await view.getByRole('button',{name:'Add item'}).click();
    await expect(input).toBeFocused();await page.keyboard.type('Draft notes');await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');await page.keyboard.type('Ping devbox');
    expect(await order()).toEqual(['Write changelog','Test upgrade','local','Tag release','Draft notes','[Ping devbox]','Bump version']);
    await page.screenshot({path:'test-results/screenshots/80-note-item-editing.png'});

    // Enter on an empty item ends the list; Backspace on an empty item deletes it and returns to the item above.
    await page.keyboard.press('Enter');await page.keyboard.press('Enter');await expect(input).toHaveCount(0);
    expect(await order()).toEqual(['Write changelog','Test upgrade','local','Tag release','Draft notes','Ping devbox','Bump version']);
    await view.locator('.note-item-text',{hasText:'Ping devbox'}).click();await expect(input).toHaveValue('Ping devbox');
    await page.keyboard.press('Enter');await page.keyboard.press('Backspace');await expect(input).toHaveValue('Ping devbox');
    expect(await order()).toEqual(['Write changelog','Test upgrade','local','Tag release','Draft notes','[Ping devbox]','Bump version']);

    // Clicking an item edits its source in place (priority untouched); Enter mid-text splits it.
    await view.locator('.note-item-text',{hasText:'Tag release'}).click();await expect(input).toHaveValue('Tag release');
    await page.keyboard.press('End');await page.keyboard.type(' and publish');
    for(let i=0;i<' and publish'.length;i++)await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');await expect(input).toHaveValue('and publish');
    await page.keyboard.press('Home');await page.keyboard.type('Then ');
    await page.keyboard.press('Escape');await expect(input).toHaveCount(0);await expect(editor).toBeVisible(); // Esc finished the item, not the note
    expect(await order()).toEqual(['Write changelog','Test upgrade','local','Tag release','Then and publish','Draft notes','Ping devbox','Bump version']);

    // ⌥↑/⌥↓ move an item among its siblings, with its sub-items; ↑ at the start of an item moves the cursor up.
    await view.locator('.note-item-text',{hasText:'Draft notes'}).click();
    await page.keyboard.press('Alt+ArrowUp');await page.keyboard.press('Alt+ArrowUp');await page.keyboard.press('Alt+ArrowUp');
    await expect(input).toHaveValue('Draft notes');await expect(input).toBeFocused();
    expect(await order()).toEqual(['Write changelog','[Draft notes]','Test upgrade','local','Tag release','Then and publish','Ping devbox','Bump version']);
    await page.keyboard.press('Home');await page.keyboard.press('ArrowUp');await expect(input).toHaveValue('Write changelog');
    await page.keyboard.press('Alt+ArrowDown');await page.keyboard.press('Alt+ArrowDown');
    expect(await order()).toEqual(['Draft notes','Test upgrade','local','[Write changelog]','Tag release','Then and publish','Ping devbox','Bump version']);
    await page.keyboard.press('Escape');

    // The × on a row deletes it; ticking moves it into the Completed section below the open items.
    const row=(name:string)=>view.locator('.note-item-row',{has:page.locator('.note-item-text',{hasText:new RegExp(`^${name}$`)})});
    await row('Ping devbox').hover();await page.screenshot({path:'test-results/screenshots/81-note-item-hover.png'});
    await row('Ping devbox').getByRole('button',{name:'Delete Ping devbox'}).click();
    await view.getByRole('checkbox',{name:'Draft notes'}).click();
    expect(await order()).toEqual(['Test upgrade','local','Write changelog','Tag release','Then and publish','Bump version','Draft notes']);

    // Tab nests an item under the one above it; Shift-Tab lifts one out of its parent.
    await view.locator('.note-item-text',{hasText:'Then and publish'}).click();await page.keyboard.press('Tab');
    await expect(input).toBeFocused();await expect(input).toHaveValue('Then and publish');
    await expect(view.locator('li.note-item',{hasText:'Tag release'}).locator('li.note-item')).toHaveText('Then and publish');
    await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await page.keyboard.press('Escape');
    await view.locator('.note-item-text',{hasText:'local'}).click();await page.keyboard.press('Shift+Tab');await expect(input).toHaveValue('local');await page.keyboard.press('Escape');

    // The Completed section folds, and stays folded for this note.
    const completed=view.getByRole('button',{name:'Completed (2)'});
    await expect(completed).toHaveAttribute('aria-expanded','true');await completed.click();
    await expect(completed).toHaveAttribute('aria-expanded','false');
    expect(await order()).toEqual(['Test upgrade','local','Write changelog','Tag release','Then and publish']);
    await page.screenshot({path:'test-results/screenshots/83-note-completed-folded.png'});
    await page.keyboard.press('Meta+Enter');await expect(editor).toHaveCount(0);
    await expect.poll(()=>saved('aaaa')).toBe(['# Release','Ship **v2** with `npm run package`.','- [ ] Test upgrade','- [ ] local','- [ ] Write changelog','- [ ] Tag release !p1','  - [ ] Then and publish','- [x] Bump version','- [x] Draft notes','','Notes stay below.'].join('\n'));
    await sidebar.getByRole('button',{name:'Todo chat Closed',exact:true}).locator('.chat-note').click();
    await expect(view.getByRole('button',{name:'Completed (2)'})).toHaveAttribute('aria-expanded','false');
    await view.getByRole('button',{name:'Completed (2)'}).click();await expect(view.getByRole('checkbox',{name:'Bump version'})).toBeVisible();
    await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);

    // An empty note offers "Add a to-do" in the Formatted view.
    await sidebar.getByRole('button',{name:'Plain chat Closed',exact:true}).hover();
    await sidebar.getByRole('button',{name:'Plain chat Closed',exact:true}).locator('.chat-note').click();
    const plain=page.getByRole('dialog',{name:'Note for Plain chat'});
    await expect(plain.getByRole('radio',{name:'Formatted'})).toHaveAttribute('aria-checked','true'); // remembered
    await plain.getByRole('button',{name:'Add a to-do'}).click();await page.keyboard.type('First thing');
    // An item just added and left empty is never saved, whether the note is saved with ⌘↩ or by clicking away.
    await page.keyboard.press('Enter');await expect(plain.getByRole('textbox',{name:'Item text'})).toHaveValue('');
    await page.keyboard.press('Meta+Enter');await expect(plain).toHaveCount(0);
    await expect.poll(()=>saved('cccc')).toBe('- [ ] First thing');
    await sidebar.getByRole('button',{name:'Plain chat Closed',exact:true}).locator('.chat-note').click();
    await plain.getByRole('button',{name:'Add item'}).click();await expect(plain.getByRole('textbox',{name:'Item text'})).toBeFocused();
    await page.locator('.project-overview h1').click();await expect(plain).toHaveCount(0);
    await page.waitForTimeout(300);expect(await saved('cccc')).toBe('- [ ] First thing');
    await sidebar.getByRole('button',{name:'Plain chat Closed',exact:true}).locator('.chat-note').click();
    await plain.getByRole('button',{name:'Add item'}).click();await page.keyboard.type('Second thing');
    await page.locator('.project-overview h1').click();await expect(plain).toHaveCount(0);
    await expect.poll(()=>saved('cccc')).toBe('- [ ] First thing\n- [ ] Second thing');

    // On the project page the checklist saves as you go.
    await sidebar.getByRole('button',{name:'Notes project',exact:true}).click();
    const card=page.locator('.project-notes').getByRole('article',{name:'Note for Todo chat'});
    await card.getByRole('button',{name:'Add item'}).click();await page.keyboard.type('From the project page');await page.keyboard.press('Enter');
    await page.keyboard.type('Second');await page.locator('.project-overview h1').click();
    await expect(card.getByRole('dialog')).toHaveCount(0); // clicking an item never opened the full editor
    await expect.poll(()=>saved('aaaa')).toContain('- [ ] Then and publish\n- [ ] From the project page\n- [ ] Second\n- [x] Bump version');
    await card.locator('.note-item-text',{hasText:'Second'}).click();await page.keyboard.press('Meta+a');await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');
    await expect.poll(()=>saved('aaaa')).not.toContain('Second');
    await card.screenshot({path:'test-results/screenshots/82-project-note-editing.png'});
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
