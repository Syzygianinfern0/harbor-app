import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECTS=[['app','Agent-Manager'],['api','tessera-api'],['paper','neurips-paper']] as const;
const CHATS=[['a1','app','Tab groups design'],['a2','app','Fix SSH reattach'],['a3','app','Release notes'],['b1','api','Rate limiter'],['b2','api','Flaky auth test'],['c1','paper','Rebuttal draft'],['c2','paper','Plot ablations']] as const;
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-closed-reveal-'));const createdAt=new Date().toISOString();
  const projects=PROJECTS.map(([id,name])=>({id,name,cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt}));
  const sessions=CHATS.map(([id,projectId,name],i)=>({id,tmuxName:`harbor-cccc${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId,hasMessages:true,...(id==='c1'?{note:'Reviewer 2'}:{})}));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  return {dir,launch:()=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}})};
}
const rows=(page:Page)=>page.locator('.sidebar .chat-row .chat-title').allTextContents();
const overview=(page:Page)=>page.locator('.project-conversations .chat-row .chat-title').allInnerTexts();
const name=(page:Page,project:string)=>page.locator('.sidebar .project-name',{hasText:project});

test('clicking a project name shows its closed chats even while closed chats are hidden',async()=>{
  const data=await fixture();let app=await data.launch();let page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});
    await expect(page.locator('.sidebar .chat-row')).toHaveCount(7);
    const hide=page.getByRole('switch',{name:'Hide all closed chats'});
    await hide.check();await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);

    // The clicked project reveals its closed chats in the sidebar and its overview; other projects obey the toggle.
    await name(page,'tessera-api').click();
    await expect.poll(()=>rows(page)).toEqual(['Rate limiter','Flaky auth test']);
    expect(await overview(page)).toEqual(['Rate limiter','Flaky auth test']);
    await expect(page.locator('.project-heading.reveals-closed')).toHaveCount(1);
    await expect(hide).toBeChecked();
    await page.screenshot({path:'test-results/screenshots/40-closed-reveal-project.png'});

    // Leaving the project page for a chat hands the sidebar back to the toggle: the closed chats hide again.
    await page.locator('.sidebar .chat-row',{hasText:'Rate limiter'}).click();
    await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');
    await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);
    await expect(page.locator('.project-heading.reveals-closed')).toHaveCount(0);
    // Clicking the name returns to the page and reveals them again; clicking it again from there hides them.
    await name(page,'tessera-api').click();await expect(page.locator('.project-overview h1')).toHaveText('tessera-api');
    await expect.poll(()=>rows(page)).toEqual(['Rate limiter','Flaky auth test']);
    await name(page,'tessera-api').click();await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);
    // The project overview itself always lists every chat in the project.
    expect(await overview(page)).toEqual(['Rate limiter','Flaky auth test']);

    // Only one project is revealed at a time.
    await name(page,'tessera-api').click();await name(page,'neurips-paper').click();
    await expect.poll(()=>rows(page)).toEqual(['Rebuttal draft','Plot ablations']);
    // Notes-only still applies to a revealed project.
    const notes=page.getByRole('switch',{name:'Only show chats with notes'});
    await notes.check();await expect.poll(()=>rows(page)).toEqual(['Rebuttal draft']);expect(await overview(page)).toEqual(['Rebuttal draft']);
    await notes.uncheck();await expect.poll(()=>rows(page)).toEqual(['Rebuttal draft','Plot ablations']);
    // Flipping the global toggle ends the reveal.
    await hide.uncheck();await expect(page.locator('.sidebar .chat-row')).toHaveCount(7);
    await hide.check();await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);

    // A folded project stays folded; its overview still shows the closed chats.
    await page.getByRole('button',{name:'Collapse project Agent-Manager'}).click();
    await name(page,'Agent-Manager').click();await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);
    expect(await overview(page)).toEqual(['Tab groups design','Fix SSH reattach','Release notes']);
    await page.getByRole('button',{name:'Expand project Agent-Manager'}).click();
    await expect.poll(()=>rows(page)).toEqual(['Tab groups design','Fix SSH reattach','Release notes']);

    // The reveal is momentary: a relaunch returns to the persisted toggle.
    await app.close();app=await data.launch();page=await app.firstWindow();
    await expect(page.getByRole('switch',{name:'Hide all closed chats'})).toBeChecked();await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);

    // From the collapsed rail, opening a project shows all of its chats in the overview and the peeked sidebar.
    await page.getByRole('button',{name:'Collapse sidebar'}).click();
    // Move the pointer off the dock first: left over the rail, it would peek the sidebar open over the rail's buttons.
    await page.mouse.move(900,500);await expect(page.locator('.sidebar-dock.is-peeking')).toHaveCount(0);
    await page.getByRole('button',{name:'Open project tessera-api'}).click();
    await expect.poll(()=>overview(page)).toEqual(['Rate limiter','Flaky auth test']);
    expect(await rows(page)).toEqual(['Rate limiter','Flaky auth test']);
    await page.screenshot({path:'test-results/screenshots/41-closed-reveal-rail.png'});
  } finally { await app.close(); }
});
