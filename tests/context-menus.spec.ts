import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHATS=['Tab groups design','Fix SSH reattach','Release notes','Rate limiter','Flaky auth test','Rebuttal draft','Plot ablations','Bottom chat'];
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-context-menus-'));const createdAt=new Date().toISOString();
  const projects=[{id:'app',name:'Agent-Manager',cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt}];
  const sessions=CHATS.map((name,i)=>({id:`c${i}`,tmuxName:`harbor-cccc${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId:'app',hasMessages:true}));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  return {dir,launch:()=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}})};
}
const inViewport=(page:Page,selector:string)=>page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth;});

test('right-click menus near the window edge open fully inside the window',async()=>{
  const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(950,640));
    await expect.poll(()=>page.evaluate(()=>innerHeight)).toBeLessThanOrEqual(640);
    // Mark every chat running so the chat menu is at its longest.
    const snapshot=await page.evaluate(()=>window.harbor.snapshot());
    snapshot.sessions=snapshot.sessions.map(s=>({...s,status:'running',activity:'idle' as any}));
    await app.evaluate(({BrowserWindow,ipcMain},snapshot)=>{
      ipcMain.removeHandler('harbor:snapshot');ipcMain.handle('harbor:snapshot',()=>snapshot);
      // Keep pinning this snapshot over the engine's own updates.
      const contents=BrowserWindow.getAllWindows()[0].webContents;const send=contents.send.bind(contents);
      contents.send=(channel:string,...args:unknown[])=>send(channel,...(channel==='harbor:snapshot-changed'?[snapshot]:args));contents.send('harbor:snapshot-changed',snapshot);
    },snapshot);

    // Right-click the lowest visible chat row near its bottom edge.
    const rows=page.locator('.sidebar .chat-row');await expect(rows.first()).toBeVisible();
    const bottomRow=await rows.evaluateAll(els=>{let best=-1,bottom=-1;els.forEach((el,i)=>{const r=el.getBoundingClientRect();if(r.bottom<=innerHeight&&r.bottom>bottom){bottom=r.bottom;best=i;}});return best;});
    const row=rows.nth(bottomRow);const box=(await row.boundingBox())!;
    await row.click({button:'right',position:{x:box.width/2,y:box.height-4}});
    const menu=page.getByRole('menu',{name:'Chat actions'});await expect(menu).toBeVisible();
    const items=menu.getByRole('menuitem');
    expect(await items.count()).toBeGreaterThanOrEqual(8);
    // Opened downward from the click, the menu would run off the bottom of the window.
    const menuBox=(await menu.boundingBox())!;const height=await page.evaluate(()=>innerHeight);
    expect(box.y+box.height+menuBox.height).toBeGreaterThan(height);
    await expect(menu.getByRole('menuitem',{name:'Remove from sidebar…'})).toBeVisible();
    expect(await inViewport(page,'[role="menu"][aria-label="Chat actions"]')).toBe(true);
    expect(await items.last().evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
    // It flipped up to end above the click point rather than sliding over it.
    expect(menuBox.y+menuBox.height).toBeLessThanOrEqual(box.y+box.height);
    await page.screenshot({path:'test-results/screenshots/context-menu-bottom.png'});
    await page.keyboard.press('Escape');await page.mouse.click(700,40);await expect(menu).toHaveCount(0);

    // A window shorter than the menu (the window has a minimum size, so zoom in) pins it to the top and scrolls.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2.5));
    await expect.poll(()=>page.evaluate(()=>innerHeight)).toBeLessThanOrEqual(260);
    // Zoomed this far, sticky section labels cover the rows, so send the right-click to a row directly.
    await rows.first().dispatchEvent('contextmenu',{clientX:60,clientY:120,bubbles:true,cancelable:true});
    await expect(menu).toBeVisible();
    expect(await inViewport(page,'[role="menu"][aria-label="Chat actions"]')).toBe(true);
    expect(await menu.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
    await items.last().scrollIntoViewIfNeeded();
    expect(await items.last().evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
  } finally { await app.close(); }
});
