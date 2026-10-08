import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('restart-to-update reassures that chats survive, and Test connection sits at the top of each host',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-preferences-'));
  const app=await electron.launch({args:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  try {
    const page=await app.firstWindow();
    await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
    await app.evaluate(({ipcMain,BrowserWindow})=>{
      const ready={current:'1.0.0',latest:'1.1.0',status:'ready',checkedAt:Date.now()};
      ipcMain.removeHandler('harbor:appUpdate');ipcMain.handle('harbor:appUpdate',()=>ready);
      ipcMain.removeHandler('harbor:installAppUpdate');ipcMain.handle('harbor:installAppUpdate',()=>false);
      ipcMain.removeHandler('harbor:diagnose');ipcMain.handle('harbor:diagnose',()=>({ok:true,tmux:'tmux 3.4',codex:true,claude:false}));
      BrowserWindow.getAllWindows()[0].webContents.send('harbor:app-update',ready);
    });
    const safe=/Safe to update now: your chats keep running in tmux, and your tabs and splits reopen where you left them\./;
    const sidebar=page.getByRole('button',{name:'Restart to update to Harbor 1.1.0',exact:true});
    await expect(sidebar).toHaveAttribute('title',safe);

    await page.getByRole('button',{name:'Preferences',exact:true}).click();
    await page.getByRole('button',{name:'Updates',exact:true}).click();
    const note=page.locator('.update-safe');
    await expect(note).toHaveText(safe);
    const restart=await page.locator('.harbor-update').getByRole('button',{name:'Restart to update',exact:true}).boundingBox(),box=await note.boundingBox();
    expect(box!.y).toBeGreaterThan(restart!.y);expect(box!.y-restart!.y).toBeLessThan(120);
    await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/update-safe-note.png'});

    await page.getByRole('button',{name:'Hosts',exact:true}).click();
    await page.getByRole('button',{name:'Add manually',exact:true}).click();
    const editor=page.locator('.host-editor');
    const test=editor.getByRole('button',{name:'Test connection',exact:true});
    const order=async()=>{const t=(await test.boundingBox())!.y,name=(await editor.getByText('Display name',{exact:true}).boundingBox())!.y,remove=(await editor.getByRole('button',{name:'Remove host'}).boundingBox())!.y;return t<name&&name<remove;};
    expect(await order()).toBe(true);
    await test.click();
    const status=editor.getByRole('status');
    await expect(status).toHaveText('Connected · tmux 3.4 · Codex available · Claude Code not found');
    expect((await status.boundingBox())!.y).toBeLessThan((await editor.getByText('Display name',{exact:true}).boundingBox())!.y);
    await page.screenshot({path:'test-results/screenshots/host-test-connection.png'});
    await page.locator('.saved-host-list button').first().click();
    await expect(editor.getByRole('button',{name:'Test connection',exact:true})).toBeVisible();
    await expect(editor.getByRole('button',{name:'Remove host'})).toHaveCount(0);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
