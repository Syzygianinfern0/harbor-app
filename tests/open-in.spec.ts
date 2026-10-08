import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Open in menus offer installed apps, hide Finder for SSH, and follow Preferences → Open in',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-open-in-'));
  const createdAt=new Date().toISOString();
  const projects=[{id:'local-project',name:'Local project',cwd:dir,connection:'local',hostLabel:'This Mac',createdAt},{id:'remote-project',name:'Remote project',cwd:'/srv/app',connection:{target:'devbox'},hostLabel:'devbox',createdAt}];
  const chat=(id:string,name:string,projectId:string,extra:object)=>({id,name,projectId,launcher:'codex',hasMessages:true,status:'closed',activity:'closed',tmuxName:`harbor-${id}`,paneId:'%9999',tags:[],group:'',pinned:false,archived:false,createdAt,updatedAt:createdAt,...extra});
  const sessions=[chat('aaaa1','Local chat','local-project',{cwd:dir,host:'local'}),chat('bbbb2','Remote chat','remote-project',{cwd:'/srv/app',host:'devbox',connection:{target:'devbox'}})];
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  const app=await electron.launch({args:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:`harbor-open-in-${process.pid}`}});
  try {
    let page=await app.firstWindow();
    await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
    // Never launch real apps: record requests instead, and pretend Zed is not installed.
    await app.evaluate(({ipcMain})=>{
      (globalThis as any).opened=[];
      ipcMain.removeHandler('harbor:openInApps');ipcMain.handle('harbor:openInApps',()=>['finder','terminal','iterm','vscode','cursor']);
      ipcMain.removeHandler('harbor:openIn');ipcMain.handle('harbor:openIn',(_e,target,app)=>{(globalThis as any).opened.push([target.kind,target.id,app??null]);});
      ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));
      ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});
    });
    await page.reload();page=await app.firstWindow();
    const opened=()=>app.evaluate(()=>(globalThis as any).opened);
    const menu=page.getByRole('menu',{name:'Project actions'});

    // Local project: the default (first installed) app, then the rest behind "Open in…".
    await page.getByRole('button',{name:'Local project',exact:true}).click({button:'right'});
    await expect(menu.getByRole('menuitem',{name:'Open in Finder',exact:true})).toBeVisible();
    await expect(menu.getByRole('menuitem',{name:'Open in VS Code',exact:true})).toHaveCount(0);
    await menu.getByRole('menuitem',{name:'Open in…',exact:true}).click();
    await expect(menu.locator('.open-in-others [role=menuitem]')).toHaveText(['Open in Terminal','Open in iTerm2','Open in VS Code','Open in Cursor']);
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/open-in-menu.png'});
    await menu.getByRole('menuitem',{name:'Open in VS Code',exact:true}).click();
    await expect(menu).toHaveCount(0);
    await expect.poll(opened).toEqual([['project','local-project','vscode']]);

    // SSH project: Finder cannot open it, so Terminal leads and Finder is nowhere in the menu.
    await page.getByRole('button',{name:'Remote project',exact:true}).click({button:'right'});
    await expect(menu.getByRole('menuitem',{name:'Open in Terminal',exact:true})).toBeVisible();
    await menu.getByRole('menuitem',{name:'Open in…',exact:true}).click();
    await expect(menu.getByRole('menuitem',{name:'Open in Finder'})).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Preferences: hide Finder, make VS Code the default, add a custom command. Zed is offered but not installed.
    await page.getByRole('button',{name:'Preferences',exact:true}).click();
    await page.getByRole('button',{name:'Open in',exact:true}).click();
    await expect(page.getByLabel('Show Zed')).toBeDisabled();
    await expect(page.locator('.open-in-app',{hasText:'Zed'})).toContainText('Not installed');
    await expect(page.getByLabel('Use Finder by default')).toBeChecked();
    await expect(page.getByLabel('Show Custom command')).toBeDisabled();
    await page.getByLabel('Show Finder').uncheck();
    await expect(page.getByLabel('Use Finder by default')).toBeDisabled();
    await expect(page.getByLabel('Use Terminal by default')).toBeChecked();
    await page.getByLabel('Use VS Code by default').check();
    await page.getByLabel('Custom command name').fill('Sublime');
    await page.getByLabel('Custom command',{exact:true}).fill('open -a "Sublime Text" "$HARBOR_DIR"');
    await expect(page.getByLabel('Show Custom command')).toBeEnabled();
    await expect(page.getByLabel('Show Custom command')).toBeChecked();
    await page.locator('.preferences-modal').screenshot({path:'test-results/screenshots/open-in-preferences.png'});
    await page.getByRole('button',{name:'Save preferences'}).click();
    await expect(page.getByRole('dialog',{name:'Preferences'})).toHaveCount(0);
    expect((await page.evaluate(()=>window.harbor.snapshot())).preferences.openIn).toEqual({hidden:['finder'],defaultApp:'vscode',customLabel:'Sublime',customCommand:'open -a "Sublime Text" "$HARBOR_DIR"'});

    // A chat: one-click toolbar button and ⌘⇧O open its folder in the default app; its menu lists the custom command.
    await page.getByRole('button',{name:'Local chat Closed',exact:true}).first().click();
    const button=page.getByRole('button',{name:'Open folder in VS Code',exact:true});
    await expect(button).toBeVisible();await button.hover();await page.screenshot({path:'test-results/screenshots/open-in-toolbar.png'});
    await button.click();
    await expect.poll(opened).toEqual([['project','local-project','vscode'],['chat','aaaa1',null]]);
    await page.keyboard.press('Meta+Shift+O');
    await expect.poll(async()=>(await opened()).length).toBe(3);
    await page.getByRole('button',{name:'Local chat Closed',exact:true}).first().click({button:'right'});
    await expect(page.getByRole('menuitem',{name:/^Open in VS Code/})).toBeVisible();
    await page.getByRole('menuitem',{name:'Open in…',exact:true}).click();
    await expect(page.locator('.open-in-others [role=menuitem]')).toHaveText(['Open in Terminal','Open in iTerm2','Open in Cursor','Open in Sublime']);
    await page.getByRole('menuitem',{name:'Open in Sublime',exact:true}).click();
    await expect.poll(async()=>(await opened()).at(-1)).toEqual(['chat','aaaa1','custom']);

    // The remote chat's toolbar button follows the same default through Remote-SSH.
    await page.getByRole('button',{name:'Remote chat Closed',exact:true}).first().click();
    await expect(page.getByRole('button',{name:'Open folder in VS Code',exact:true})).toBeVisible();
  } finally { await app.close(); await rm(dir,{recursive:true,force:true}); }
});
