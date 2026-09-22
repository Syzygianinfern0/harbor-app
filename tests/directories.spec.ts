import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('directory quick pick browses, completes, selects, and creates a local project', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-picker-ui-'));
  const root = path.join(dir, 'Projects');
  await mkdir(path.join(root, 'Alpha', 'Nested'), {recursive:true});
  await mkdir(path.join(root, 'Alpine'));
  await mkdir(path.join(root, '.hidden'));
  const app = await electron.launch({args:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  try {
    const page = await app.firstWindow();
    await page.getByRole('button',{name:'Add project',exact:true}).first().click();
    const input = page.getByRole('combobox',{name:'Project directory'});
    await input.fill(root + '/');
    await expect(page.getByRole('option',{name:'Alpha',exact:true})).toBeVisible();
    await expect(page.getByRole('option',{name:'.hidden',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Show hidden folders'}).click();
    await expect(page.getByRole('option',{name:'.hidden',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Show hidden folders'}).press('Escape');
    await expect(input).toHaveAttribute('aria-expanded','false');
    await expect(page.getByRole('dialog',{name:'Add project'})).toBeVisible();
    await input.fill(root + '/Al');
    await expect(page.getByRole('option',{name:'Alpha',exact:true})).toHaveAttribute('aria-selected','true');
    await input.press('Tab');
    await expect(input).toHaveValue(root + '/Alpha/');
    await expect(page.getByRole('option',{name:'Nested',exact:true})).toBeVisible();
    await input.press('ArrowDown'); await input.press('Enter');
    await expect(input).toHaveValue(root + '/Alpha/Nested/');
    await expect(page.getByText('No subfolders in this folder.')).toBeVisible();
    await page.getByRole('button',{name:'Parent folder',exact:true}).click();
    await expect(input).toHaveValue(root + '/Alpha/');
    await expect(page.getByRole('option',{name:'Nested',exact:true})).toBeVisible();
    await input.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded','false');
    await expect(page.getByRole('dialog',{name:'Add project'})).toBeVisible();
    await page.getByRole('button',{name:'Browse folders',exact:true}).click();
    await expect(page.getByRole('option',{name:'Nested',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Use this folder'}).click();
    await expect(input).toHaveAttribute('aria-expanded','false');
    await expect(input).toHaveValue(root + '/Alpha');
    await input.fill(root + '/missing/');
    await expect(page.getByText('Folder not found. Check the path or go to Home.')).toBeVisible();
    await page.getByRole('button',{name:'Home folder'}).click();
    await expect(input).toHaveValue('~/');
    await input.fill(root + '/');
    await expect(page.getByRole('option',{name:'Alpha',exact:true})).toBeVisible();
    await mkdir('test-results/screenshots',{recursive:true});
    await page.screenshot({path:'test-results/screenshots/directory-picker-local.png'});
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(950,640));
    await page.screenshot({path:'test-results/screenshots/directory-picker-compact.png'});
    await page.getByRole('option',{name:'Alpha',exact:true}).click();
    await expect(page.getByRole('option',{name:'Nested',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Use this folder'}).click();
    await page.getByLabel('Project name',{exact:true}).fill('Picker project');
    await page.getByRole('dialog').getByRole('button',{name:'Add project',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const snapshot = await page.evaluate(() => window.harbor.snapshot());
    expect(snapshot.projects[0].cwd).toContain('/Projects/Alpha');
  } finally {await app.close(); await rm(dir,{recursive:true,force:true});}
});

test('remote picker ignores stale host/query responses, surfaces failure, and recovers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-picker-remote-ui-'));
  const app = await electron.launch({args:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
  try {
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      const prefs = (await window.harbor.snapshot()).preferences;
      prefs.hosts.push({id:'remote',label:'Research server',source:'manual',enabled:true,defaultDirectory:'~',connection:{target:'fake-test-host'}});
      await window.harbor.savePreferences(prefs);
    });
    // Simulate slow and failed SSH responses at IPC; the separate engine test verifies host routing.
    await app.evaluate(({ipcMain}) => {
      ipcMain.removeHandler('harbor:listDirectories');
      ipcMain.handle('harbor:listDirectories', async (_event, host, value) => {
        if (value === '/offline/') throw new Error('SSH unavailable');
        await new Promise(resolve => setTimeout(resolve, host === 'local' || value === '/slow/' ? 1000 : 20));
        const directory = value === '~' || value === '~/' ? '/home/research' : value.replace(/\/$/, '');
        return {directory,parent:'/home',home:'/home/research',query:'',truncated:false,entries:[{name:host === 'local' ? 'LOCAL-STALE' : value === '/slow/' ? 'QUERY-STALE' : 'Remote project',path:directory+'/Remote project'}]};
      });
    });
    await page.getByRole('button',{name:'Add project',exact:true}).first().click();
    const input = page.getByRole('combobox',{name:'Project directory'});
    await input.focus(); await page.waitForTimeout(250);
    await page.getByLabel('Host',{exact:true}).selectOption('remote');
    await input.focus();
    await expect(page.getByRole('option',{name:'Remote project'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Choose project folder'})).toHaveCount(0);
    await page.waitForTimeout(1100);
    await expect(page.getByRole('option',{name:'LOCAL-STALE'})).toHaveCount(0);
    await input.fill('/slow/'); await page.waitForTimeout(250);
    await input.fill('/fast/');
    await expect(page.locator('.directory-location')).toHaveText('/fast');
    await page.waitForTimeout(1100);
    await expect(page.getByRole('option',{name:'QUERY-STALE'})).toHaveCount(0);
    await input.fill('/offline/');
    await expect(page.getByText('SSH unavailable',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await expect(page.getByText('SSH unavailable',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Home folder'}).click();
    await expect(page.locator('.directory-location')).toHaveText('/home/research');
    await page.getByRole('option',{name:'Remote project'}).click();
    await expect(input).toHaveValue('/home/research/Remote project/');
    await expect(page.locator('.directory-location')).toHaveText('/home/research/Remote project');
    await page.screenshot({path:'test-results/screenshots/directory-picker-remote.png'});
    await page.getByRole('button',{name:'Use this folder'}).click();
    await expect(input).toHaveValue('/home/research/Remote project');
    await expect(input).toHaveAttribute('aria-expanded','false');
  } finally {await app.close(); await rm(dir,{recursive:true,force:true});}
});
