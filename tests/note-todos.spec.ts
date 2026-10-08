import { test, expect, _electron as electron, type Locator } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TODO=['# Release','Ship **v2** with `npm run package`.','- [ ] Write changelog','- [ ] Test upgrade','  - [ ] local','  - [ ] devbox','- [ ] Tag release'].join('\n');
const LONG=['<img src=x onerror="window.__pwned=1"> stays text',...Array.from({length:12},(_,i)=>`## Section ${i+1}\nSome **detail** about step ${i+1}, long enough to wrap across the peek at least once or twice.\n- [ ] follow up ${i+1}`)].join('\n');
/** Synthetic drag event at the top or bottom of an element, sharing one DataTransfer per drag; returns whether a drop was accepted. */
const fire=(target:Locator,type:string,spot:'top'|'bottom'|'middle'='middle')=>target.evaluate((el,[type,spot])=>{
  const r=el.getBoundingClientRect(),w=window as any;if(type==='dragstart')w.__transfer=new DataTransfer();
  const y=spot==='top'?r.top+2:spot==='bottom'?r.bottom-2:r.top+r.height/2;
  return !el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:w.__transfer,clientX:r.left+r.width/2,clientY:y}));
},[type,spot] as const);

test('long notes, Markdown rendering, and Todoist-style tasks in the editor and on the project page',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-note-todos-'));
  const createdAt=new Date().toISOString();
  const projects=[{id:'project',name:'Notes project',cwd:dir,connection:'local',hostLabel:'This Mac',createdAt}];
  const session=(id:string,name:string,note?:string)=>({id,name,projectId:'project',cwd:dir,host:'local',launcher:'codex',hasMessages:true,status:'closed',activity:'closed',tmuxName:`harbor-${id}`,paneId:'%9999',tags:[],group:'',pinned:false,archived:false,createdAt,updatedAt:createdAt,...(note?{note}:{})});
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions:[session('aaaa','Todo chat',TODO),session('bbbb','Long chat',LONG),session('cccc','Plain chat')]}));
  const app=await electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  const saved=async(id:string)=>{const data=JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8'));return [...data.sessions,...data.projects].find((s:any)=>s.id===id)?.note;};
  try {
    const page=await app.firstWindow();
    await app.evaluate(({ipcMain})=>{
      ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));
      ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});
    });
    await page.setViewportSize({width:1300,height:820}).catch(()=>{});
    await mkdir('test-results/screenshots',{recursive:true});
    const sidebar=page.locator('.sidebar');
    const viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
    const inside=async(box:Locator)=>{const r=(await box.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(viewport.w);expect(r.y+r.height).toBeLessThanOrEqual(viewport.h);return r;};

    // The peek renders Markdown, is larger than before, and says when the note continues. HTML stays text.
    const long=sidebar.getByRole('button',{name:'Long chat Closed',exact:true}).locator('.chat-note');
    await long.hover();const peek=page.getByRole('tooltip');
    await expect(peek.getByRole('heading',{name:'Section 1',exact:true})).toBeVisible();
    await expect(peek.getByRole('checkbox',{name:'follow up 1',exact:true})).toHaveAttribute('aria-checked','false');
    await expect(peek.locator('strong').first()).toHaveText('detail');
    await expect(peek).toHaveClass(/clipped/);await expect(peek).toContainText('Continues · click to read it all');await expect(peek).toContainText('0 of 12 done');
    await expect(peek).toContainText('<img src=x onerror="window.__pwned=1"> stays text');
    expect(await page.locator('img[src=x]').count()).toBe(0);expect(await page.evaluate(()=>(window as any).__pwned)).toBeUndefined();
    const peekBox=await inside(peek);expect(peekBox.width).toBeGreaterThan(380);expect(peekBox.height).toBeGreaterThan(380);
    await page.waitForTimeout(500);await page.screenshot({path:'test-results/screenshots/70-note-peek-long.png'});

    // The editor is roomy, grows with a long note, stays on screen, and takes far more than the old 4000 characters.
    await long.click();
    const longEditor=page.getByRole('dialog',{name:'Note for Long chat'});const source=longEditor.getByRole('textbox',{name:'Note'});
    await expect(source).toBeFocused();
    const editorBox=await inside(longEditor);expect(editorBox.width).toBeGreaterThanOrEqual(500);
    expect((await source.boundingBox())!.height).toBeGreaterThan(400);
    await page.screenshot({path:'test-results/screenshots/71-note-editor-long.png'});
    const big=Array.from({length:1150},(_,i)=>`- [ ] item ${String(i).padStart(4,'0')}`).join('\n');expect(big.length).toBeGreaterThan(15000);
    await source.fill(big);await inside(longEditor);await page.keyboard.press('Meta+Enter');await expect(longEditor).toHaveCount(0);
    await expect.poll(()=>saved('bbbb')).toBe(big);

    // The Formatted view: checking a task sinks it below its siblings, a checked parent takes (and checks) its subtasks.
    await page.mouse.move(700,400);
    await sidebar.getByRole('button',{name:'Todo chat Closed',exact:true}).locator('.chat-note').click();
    const editor=page.getByRole('dialog',{name:'Note for Todo chat'});
    await expect(editor.getByRole('radio',{name:'Markdown'})).toHaveAttribute('aria-checked','true');
    await editor.getByRole('radio',{name:'Formatted'}).click();
    const view=editor.locator('.chat-note-rendered');const order=()=>view.locator('.note-item-text').allInnerTexts();
    await expect(view.locator('h3',{hasText:'Release'})).toBeVisible();await expect(view.locator('code')).toHaveText('npm run package');
    await view.getByRole('checkbox',{name:'Write changelog'}).click();
    await expect(view.getByRole('checkbox',{name:'Write changelog'})).toHaveAttribute('aria-checked','true');
    expect(await order()).toEqual(['Test upgrade','local','devbox','Tag release','Write changelog']);
    await view.getByRole('checkbox',{name:'Test upgrade'}).click();
    expect(await order()).toEqual(['Tag release','Write changelog','Test upgrade','local','devbox']);
    for(const name of ['local','devbox'])await expect(view.getByRole('checkbox',{name})).toHaveAttribute('aria-checked','true');

    // Priorities: a flag menu on the row sets the checkbox color and a trailing !p1.
    const tag=view.locator('.note-item-row',{hasText:'Tag release'});
    await tag.hover();await tag.getByRole('button',{name:'Priority 4 · change priority'}).click();
    await page.getByRole('menu',{name:'Priority'}).getByRole('menuitemradio',{name:'Priority 1'}).click();
    await expect(page.getByRole('menu',{name:'Priority'})).toHaveCount(0);await expect(editor).toBeVisible(); // choosing did not count as clicking away
    const check=view.getByRole('checkbox',{name:'Tag release'});await expect(check).toHaveClass(/p1/);
    await expect.poll(()=>check.evaluate(el=>getComputedStyle(el).borderTopColor)).toBe('rgb(255, 112, 102)');
    await tag.hover();await tag.getByRole('button',{name:'Priority 1 · change priority'}).click();
    await page.screenshot({path:'test-results/screenshots/72-note-priority-menu.png'});
    await page.keyboard.press('Escape');await expect(page.getByRole('menu',{name:'Priority'})).toHaveCount(0);await expect(editor).toBeVisible();

    // Dragging: a child reorders within its parent; a parent moves with its subtree; no-op and into-itself drops show nothing.
    const row=(name:string)=>view.locator('.note-item-row',{has:page.locator('.note-item-text',{hasText:new RegExp(`^${name}$`)})});
    await fire(row('devbox'),'dragstart');
    expect(await fire(row('local'),'dragover','bottom')).toBe(false);await expect(view.locator('.note-drop-caret')).toHaveCount(0);
    expect(await fire(row('local'),'dragover','top')).toBe(true);await expect(view.locator('.note-drop-caret')).toHaveCount(1);
    await page.screenshot({path:'test-results/screenshots/73-note-drag-cue.png'});
    await fire(row('local'),'drop','top');await fire(row('devbox'),'dragend');
    await expect(view.locator('.note-drop-caret,.drag-source')).toHaveCount(0);
    expect(await order()).toEqual(['Tag release','Write changelog','Test upgrade','devbox','local']);
    await fire(row('Test upgrade'),'dragstart');
    expect(await fire(row('local'),'dragover','top')).toBe(false);
    // A ticked item stays under Completed, so it has no place among the open items.
    expect(await fire(row('Tag release'),'dragover','top')).toBe(false);await expect(view.locator('.note-drop-caret')).toHaveCount(0);
    expect(await fire(row('Write changelog'),'dragover','top')).toBe(true);
    await fire(row('Write changelog'),'drop','top');await fire(row('Test upgrade'),'dragend');
    expect(await order()).toEqual(['Tag release','Test upgrade','devbox','local','Write changelog']);
    await page.screenshot({path:'test-results/screenshots/74-note-formatted.png'});
    await page.keyboard.press('Meta+Enter');await expect(editor).toHaveCount(0);
    await expect.poll(()=>saved('aaaa')).toBe(['# Release','Ship **v2** with `npm run package`.','- [ ] Tag release !p1','- [x] Test upgrade','  - [x] devbox','  - [x] local','- [x] Write changelog'].join('\n'));

    // The chosen view is remembered; ⌘E switches back to the source.
    await sidebar.getByRole('button',{name:'Todo chat Closed',exact:true}).locator('.chat-note').click();
    await expect(editor.getByRole('radio',{name:'Formatted'})).toHaveAttribute('aria-checked','true');
    await page.keyboard.press('Meta+e');await expect(editor.getByRole('textbox',{name:'Note'})).toBeFocused();
    await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);

    // Project page: the project's own note, editable in place, and every noted chat with its rendered note.
    await sidebar.getByRole('button',{name:'Notes project',exact:true}).click();
    const notes=page.locator('.project-notes');
    await expect(notes.getByRole('article')).toHaveCount(3);
    await notes.getByRole('button',{name:'Add a note for this project'}).click();
    const inline=notes.getByRole('dialog',{name:'Note for Notes project'});
    await expect(inline.getByRole('textbox',{name:'Note'})).toBeFocused();
    await page.keyboard.type('## Goals\n- [ ] ship the notes overhaul');
    await page.locator('.project-overview h1').click(); // clicking away saves
    await expect.poll(()=>saved('project')).toBe('## Goals\n- [ ] ship the notes overhaul');
    const projectCard=notes.getByRole('article',{name:'Project note'});
    await expect(projectCard.locator('h4',{hasText:'Goals'})).toBeVisible();
    await projectCard.getByRole('checkbox',{name:'ship the notes overhaul'}).click();
    await expect.poll(()=>saved('project')).toBe('## Goals\n- [x] ship the notes overhaul');
    const todoCard=notes.getByRole('article',{name:'Note for Todo chat'});
    await expect(notes.getByRole('article',{name:'Note for Plain chat'})).toHaveCount(0);
    await todoCard.getByRole('checkbox',{name:'Tag release'}).click();
    await expect.poll(()=>saved('aaaa')).toContain('- [x] Tag release !p1');
    await expect(todoCard.locator('.note-item-text')).toHaveText(['Test upgrade','devbox','local','Write changelog','Tag release']);
    await page.screenshot({path:'test-results/screenshots/75-project-notes.png'});
    // A long note starts folded on the page and unfolds on request.
    const longCard=notes.getByRole('article',{name:'Note for Long chat'});const longBody=longCard.locator('.project-note-body');
    expect((await longBody.boundingBox())!.height).toBeLessThanOrEqual(341);await longCard.screenshot({path:'test-results/screenshots/76-project-note-folded.png'});
    await longCard.getByRole('button',{name:'Show the whole note'}).click();
    expect((await longBody.boundingBox())!.height).toBeGreaterThan(5000);
    await longCard.getByRole('button',{name:'Show less'}).click();await expect(todoCard.getByRole('button',{name:'Show the whole note'})).toHaveCount(0);
    await todoCard.getByRole('button',{name:'Edit note for todo chat'}).click();
    await todoCard.getByRole('textbox',{name:'Note'}).fill('discard me');await page.keyboard.press('Escape');
    await expect(todoCard.getByRole('dialog')).toHaveCount(0);expect(await saved('aaaa')).toContain('Test upgrade');
    await todoCard.getByRole('button',{name:'Open Todo chat'}).click();
    await expect(page.locator('.session-toolbar')).toBeVisible();
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
