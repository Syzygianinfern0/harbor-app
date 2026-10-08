import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Projects with closed chats only, so nothing touches tmux.
async function launch(projectNames:string[],chatsPer:number) {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-project-sidebar-'));const createdAt=new Date().toISOString();
  const projects=projectNames.map((name,i)=>({id:`p${i}`,name,cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt}));
  let n=0;const sessions=projects.flatMap(p=>Array.from({length:chatsPer},(_,j)=>({id:`${p.id}c${j}`,tmuxName:`harbor-dddd${(n++).toString(16)}`,paneId:`%${n}`,name:`${p.name} chat ${j+1}`,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-j*1000).toISOString(),status:'closed',projectId:p.id,hasMessages:true})));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  const app=await electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:`harbor-test-sidebar-${process.pid}`}});
  const page=await app.firstWindow();
  await app.evaluate(({ipcMain})=>{
    (globalThis as any).terminated=0;
    ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));
    ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});
    ipcMain.removeHandler('harbor:terminate');ipcMain.handle('harbor:terminate',()=>{(globalThis as any).terminated++;return false;});
  });
  const index=async()=>JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8'));
  return {app,page,dir,index,close:async()=>{await app.close();await rm(dir,{recursive:true,force:true});}};
}
const chat=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name});
const projectName=(page:Page,name:string)=>page.locator('.sidebar .project-name',{hasText:name});

test('the PROJECTS heading and the current project heading stay pinned while the sidebar scrolls',async()=>{
  const h=await launch(['Alpha','Beta','Gamma','Delta','Epsilon','Zeta'],5);
  try {
    const {page,app}=h;
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,640));
    await expect(chat(page,'Zeta chat 5')).toHaveCount(1);
    const list=page.locator('.sidebar .projects-list');
    await expect.poll(()=>list.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(300);
    for(const scroll of [260,520]){
      await list.evaluate((el,top)=>{el.scrollTop=top;},scroll);
      const geometry=await list.evaluate(el=>{
        const listTop=el.getBoundingClientRect().top;const label=el.querySelector('.section-label')!.getBoundingClientRect();
        // The section whose body passes under the pinned label owns the pinned heading.
        const section=[...el.querySelectorAll('.project-section')].find(s=>{const r=s.getBoundingClientRect();return r.top<label.bottom&&r.bottom>label.bottom+40;})!;
        const heading=section.querySelector('.project-heading')!.getBoundingClientRect();
        const hit=document.elementFromPoint(heading.left+heading.width/2,heading.top+heading.height/2);
        // No chat row peeks out anywhere between the top of the list and the bottom of the pinned heading.
        const peeks:number[]=[];for(let y=Math.ceil(listTop)+1;y<heading.bottom-1;y++){const at=document.elementFromPoint(label.left+40,y);if(at?.closest('.chat-row'))peeks.push(y);}
        return {peeks:peeks.length?peeks:undefined,labelTop:label.top-listTop,gap:heading.top-label.bottom,headingOnTop:!!hit?.closest('.project-heading'),labelOnTop:!!document.elementFromPoint(label.left+30,label.top+label.height/2)?.closest('.section-label')};
      });
      expect(geometry.peeks).toBeUndefined();expect(geometry.labelTop).toBeCloseTo(0,0);expect(Math.abs(geometry.gap)).toBeLessThan(2);
      expect(geometry.headingOnTop).toBe(true);expect(geometry.labelOnTop).toBe(true);
    }
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/sidebar-sticky-headings.png'});
  }finally{await h.close();}
});

test('clicking a folded project expands it, and it folds back unless one of its chats was opened',async()=>{
  const h=await launch(['Alpha','Beta','Gamma'],2);
  try {
    const {page}=h;
    await page.getByRole('button',{name:'Collapse all projects',exact:true}).click();
    await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);
    // Showing Alpha's page expands it in the sidebar.
    await projectName(page,'Alpha').click();
    await expect(page.locator('.project-overview h1')).toHaveText('Alpha');
    await expect(chat(page,'Alpha chat 1')).toHaveCount(1);
    // Moving on to Beta without opening anything folds Alpha back.
    await projectName(page,'Beta').click();
    await expect(chat(page,'Alpha chat 1')).toHaveCount(0);await expect(chat(page,'Beta chat 1')).toHaveCount(1);
    // Opening one of Beta's chats keeps Beta expanded after moving on.
    await chat(page,'Beta chat 2').click();await expect(page.locator('[data-tab-id="p1c1"]')).toHaveCount(1);
    await projectName(page,'Gamma').click();
    await expect(chat(page,'Gamma chat 1')).toHaveCount(1);await expect(chat(page,'Beta chat 1')).toHaveCount(1);
    // Opening a chat in another project folds Gamma back.
    await chat(page,'Beta chat 1').click();
    await expect(chat(page,'Gamma chat 1')).toHaveCount(0);
    // A chat opened from the project page counts too.
    await projectName(page,'Alpha').click();
    await page.locator('.project-conversations .chat-row',{hasText:'Alpha chat 2'}).click();
    await chat(page,'Beta chat 1').click();
    await expect(chat(page,'Alpha chat 2')).toHaveCount(1);
    // Toggling the disclosure by hand takes over: Gamma stays expanded when moving on.
    await projectName(page,'Gamma').click();
    await page.getByRole('button',{name:'Collapse project Gamma',exact:true}).click();
    await page.getByRole('button',{name:'Expand project Gamma',exact:true}).click();
    await projectName(page,'Beta').click();
    await expect(chat(page,'Gamma chat 1')).toHaveCount(1);
    // Already-expanded projects are left alone.
    await expect(chat(page,'Beta chat 1')).toHaveCount(1);
  }finally{await h.close();}
});

test('a project hides from its right-click menu, comes back from the hidden list, and deletes only after confirming',async()=>{
  const h=await launch(['Alpha','Beta','Gamma'],2);
  try {
    const {page,app,index}=h;
    const menu=async(name:string)=>{await page.locator('.sidebar .project-heading',{hasText:name}).click({button:'right'});};
    // Hide.
    await menu('Alpha');await page.getByRole('menuitem',{name:'Hide project',exact:true}).click();
    await expect(projectName(page,'Alpha')).toHaveCount(0);await expect(chat(page,'Alpha chat 1')).toHaveCount(0);
    await expect.poll(async()=>(await index()).projects.find((p:any)=>p.id==='p0').hidden).toBe(true);
    // Show hidden projects, then bring Alpha back from its menu.
    const toggle=page.getByRole('button',{name:'Hidden projects (1)',exact:true});await toggle.click();
    const hidden=page.getByRole('group',{name:'Hidden projects'});await expect(hidden).toContainText('Alpha');
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/sidebar-hidden-projects.png'});
    await hidden.locator('.project-heading',{hasText:'Alpha'}).click({button:'right'});
    await page.getByRole('menuitem',{name:'Show project',exact:true}).click();
    await expect(projectName(page,'Alpha')).toHaveCount(1);await expect(hidden).toHaveCount(0);
    await expect(page.getByRole('button',{name:/hidden projects/})).toHaveCount(0);
    await expect.poll(async()=>(await index()).projects.find((p:any)=>p.id==='p0').hidden).toBe(false);
    // Hide again and use the inline Show button.
    await menu('Alpha');await page.getByRole('menuitem',{name:'Hide project',exact:true}).click();
    await page.getByRole('button',{name:'Hidden projects (1)',exact:true}).click();
    await page.getByRole('button',{name:'Show project Alpha',exact:true}).click();
    await expect(projectName(page,'Alpha')).toHaveCount(1);

    // Delete asks first and says exactly what goes; Cancel keeps everything.
    await menu('Beta');await page.getByRole('menuitem',{name:'Delete project…',exact:true}).click();
    const dialog=page.getByRole('alertdialog',{name:'Delete project Beta'});
    await expect(dialog).toContainText('Only Harbor\'s project entry is deleted');
    await expect(dialog).toContainText('and its files are not touched');await expect(dialog).toContainText('Saved Codex and Claude conversations are kept');
    await expect(dialog).toContainText('No chats in this project are running');
    await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
    await page.screenshot({path:'test-results/screenshots/sidebar-delete-project.png'});
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(dialog).toHaveCount(0);await expect(projectName(page,'Beta')).toHaveCount(1);
    // Escape closes it too.
    await menu('Beta');await page.getByRole('menuitem',{name:'Delete project…',exact:true}).click();
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    // Hide instead hides.
    await menu('Gamma');await page.getByRole('menuitem',{name:'Delete project…',exact:true}).click();
    await page.getByRole('button',{name:'Hide instead',exact:true}).click();
    await expect(projectName(page,'Gamma')).toHaveCount(0);
    await expect.poll(async()=>(await index()).projects.find((p:any)=>p.id==='p2')?.hidden).toBe(true);
    // Deleting removes only the project entry: its chats stay in the index, nothing is terminated.
    await menu('Beta');await page.getByRole('menuitem',{name:'Delete project…',exact:true}).click();
    await dialog.getByRole('button',{name:'Delete project',exact:true}).click();
    await expect(dialog).toHaveCount(0);await expect(projectName(page,'Beta')).toHaveCount(0);
    await expect.poll(async()=>(await index()).projects.map((p:any)=>p.id)).toEqual(['p0','p2']);
    const saved=(await index()).sessions.filter((s:any)=>s.id.startsWith('p1'));
    expect(saved).toHaveLength(2);expect(saved.every((s:any)=>s.projectRemoved===true)).toBe(true);
    expect(await app.evaluate(()=>(globalThis as any).terminated)).toBe(0);
    // A hidden project can be deleted from the hidden list.
    await page.getByRole('button',{name:'Hidden projects (1)',exact:true}).click();
    await page.getByRole('group',{name:'Hidden projects'}).locator('.project-heading',{hasText:'Gamma'}).click({button:'right'});
    await page.getByRole('menuitem',{name:'Delete project…',exact:true}).click();
    await page.getByRole('alertdialog',{name:'Delete project Gamma'}).getByRole('button',{name:'Delete project',exact:true}).click();
    await expect.poll(async()=>(await index()).projects.map((p:any)=>p.id)).toEqual(['p0']);
    await expect(page.getByRole('group',{name:'Hidden projects'})).toHaveCount(0);
  }finally{await h.close();}
});

test('the eye button opens the hidden projects right under the PROJECTS heading, even with the list scrolled',async()=>{
  const names=Array.from({length:14},(_,i)=>`Project ${String.fromCharCode(65+i)}`);
  const h=await launch(names,4);
  try {
    const {page,app}=h;
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,640));
    const menu=async(name:string)=>{await page.locator('.sidebar .project-section .project-heading',{hasText:name}).click({button:'right'});};
    for(const name of ['Project B','Project C']){await menu(name);await page.getByRole('menuitem',{name:'Hide project',exact:true}).click();await expect(projectName(page,name)).toHaveCount(0);}
    const list=page.locator('.sidebar .projects-list');
    await expect.poll(()=>list.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(600);
    await list.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const toggle=page.getByRole('button',{name:'Hidden projects (2)',exact:true});
    await expect(toggle).toHaveAttribute('aria-expanded','false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    const panel=page.getByRole('group',{name:'Hidden projects'});
    await expect(panel).toContainText('Project B');await expect(panel).toContainText('Project C');
    // The panel sits directly under the pinned heading and nothing covers it, although the list is scrolled to the bottom.
    const geometry=await list.evaluate(el=>{
      const label=el.querySelector('.section-label')!.getBoundingClientRect();const box=el.querySelector('.hidden-projects')!.getBoundingClientRect();
      const show=el.querySelector('.hidden-projects .text-button')!.getBoundingClientRect();
      return {scrolled:el.scrollTop,gap:box.top-label.bottom,listTop:el.getBoundingClientRect().top,labelTop:label.top,showOnTop:!!document.elementFromPoint(show.left+show.width/2,show.top+show.height/2)?.closest('.hidden-projects')};
    });
    expect(geometry.scrolled).toBeGreaterThan(600);expect(Math.abs(geometry.gap)).toBeLessThan(3);expect(geometry.labelTop-geometry.listTop).toBeCloseTo(0,0);expect(geometry.showOnTop).toBe(true);
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/sidebar-hidden-projects-scrolled.png'});
    // Close button and Escape both close it and hand focus back to the eye button.
    await panel.getByRole('button',{name:'Close hidden projects',exact:true}).click();
    await expect(panel).toHaveCount(0);await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
    await toggle.click();await panel.getByRole('button',{name:'Show project Project B',exact:true}).focus();
    await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(toggle).toBeFocused();
    // Showing projects one by one keeps the panel open until none are left.
    await toggle.click();
    await panel.getByRole('button',{name:'Show project Project B',exact:true}).click();
    await expect(projectName(page,'Project B')).toHaveCount(1);await expect(panel).toContainText('Project C');
    await expect(page.getByRole('button',{name:'Hidden projects (1)',exact:true})).toHaveAttribute('aria-expanded','true');
    await panel.getByRole('button',{name:'Show project Project C',exact:true}).click();
    await expect(panel).toHaveCount(0);await expect(page.getByRole('button',{name:/^Hidden projects/})).toHaveCount(0);
  }finally{await h.close();}
});

test('every item in the project and chat right-click menus has an icon',async()=>{
  const h=await launch(['Alpha','Beta'],2);
  try {
    const {page}=h;
    const icons=async(label:string)=>{const m=page.getByRole('menu',{name:label});await expect(m).toBeVisible();return m.getByRole('menuitem').evaluateAll(items=>items.map(i=>({text:i.textContent,icon:!!i.querySelector('svg')})));};
    await page.locator('.sidebar .project-heading',{hasText:'Alpha'}).click({button:'right'});
    const project=await icons('Project actions');expect(project.map(i=>i.text)).toContain('Rename project…');
    expect(project.filter(i=>!i.icon)).toEqual([]);
    await page.keyboard.press('Escape');await page.mouse.click(600,400);
    await chat(page,'Alpha chat 1').click({button:'right'});
    const chatItems=await icons('Chat actions');expect(chatItems.map(i=>i.text)).toContain('Rename chat…');
    expect(chatItems.filter(i=>!i.icon)).toEqual([]);
  }finally{await h.close();}
});
