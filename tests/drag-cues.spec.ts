import { test, expect, _electron as electron, type Locator, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECTS=[['app','Agent-Manager'],['api','tessera-api'],['paper','neurips-paper']] as const;
const CHATS=[['a1','app','Tab groups design'],['a2','app','Fix SSH reattach'],['a3','app','Release notes'],['b1','api','Rate limiter'],['b2','api','Flaky auth test'],['c1','paper','Rebuttal draft'],['c2','paper','Plot ablations']] as const;
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-drag-cues-'));const createdAt=new Date().toISOString();
  const projects=PROJECTS.map(([id,name])=>({id,name,cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt}));
  const sessions=CHATS.map(([id,projectId,name],i)=>({id,tmuxName:`harbor-dddd${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId,hasMessages:true}));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  return {dir,launch:()=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}})};
}
const openChat=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name}).click();
const tabOrder=(page:Page)=>page.locator('.session-toolbar [data-tab-id]').evaluateAll(e=>e.map(t=>(t as HTMLElement).dataset.tabId));
const chipOrder=(page:Page)=>page.locator('.session-toolbar [data-group-key]').evaluateAll(e=>e.map(t=>(t as HTMLElement).dataset.groupKey));
type Spot='left'|'right'|'top'|'bottom'|'middle';
/** Synthetic drag event at a spot on the element, sharing one DataTransfer per drag; returns whether a drop was accepted (dragover prevented). */
async function fire(target:Locator,type:string,spot:Spot='middle') {
  return target.evaluate((el,[type,spot])=>{
    const r=el.getBoundingClientRect(),w=window as any;if(type==='dragstart')w.__transfer=new DataTransfer();
    const x=spot==='left'?r.left+3:spot==='right'?r.right-3:r.left+r.width/2,y=spot==='top'?r.top+3:spot==='bottom'?r.bottom-3:r.top+r.height/2;
    return !el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:w.__transfer,clientX:x,clientY:y}));
  },[type,spot] as const);
}
const caretX=(page:Page)=>page.locator('.tab-drop-caret').evaluate(e=>{const r=e.getBoundingClientRect();return r.left+r.width/2;});
const layout=(page:Page)=>page.locator('.session-toolbar .tab-strip').evaluate(strip=>({scroll:strip.scrollWidth,items:Array.from(strip.children,c=>Math.round(c.getBoundingClientRect().left)+':'+Math.round(c.getBoundingClientRect().width))}));

test('drag cues mark exactly where tabs, groups, projects and panes land, and clear with the drag',async()=>{
  const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});
    for(const name of ['Tab groups design','Fix SSH reattach','Release notes','Rate limiter','Rebuttal draft'])await openChat(page,name);
    await expect.poll(()=>tabOrder(page)).toEqual(['a1','a2','a3','b1','c1']);expect(await chipOrder(page)).toEqual(['p:app','p:api','p:paper']);
    const tab=(id:string)=>page.locator(`[data-tab-id="${id}"]`),chip=(key:string)=>page.locator(`[data-group-key="${key}"]`);

    // A tab: the source dims, a line marks the gap it will land in, and the strip's layout never moves.
    expect(await fire(tab('a3'),'dragstart')).toBe(false);await expect(tab('a3')).toHaveClass(/dragging/);
    await expect.poll(()=>tab('a3').evaluate(e=>getComputedStyle(e).opacity)).toBe('0.4');
    await page.waitForTimeout(300);const rest=await layout(page);
    expect(await fire(tab('a1'),'dragover','left')).toBe(true);await expect(page.locator('.tab-drop-caret')).toHaveCount(1);
    const expected=await page.evaluate(()=>{const chip=document.querySelector('[data-group-key="p:app"]')!.getBoundingClientRect(),a1=document.querySelector('[data-tab-id="a1"]')!.getBoundingClientRect();return (chip.right+a1.left)/2;});
    const line=await caretX(page);expect(Math.abs(line-expected)).toBeLessThanOrEqual(1.5);
    expect(await layout(page)).toEqual(rest);
    await page.screenshot({animations:'disabled',path:'test-results/screenshots/60-drag-cue-tab-line.png'});
    // Another project's group, the spot it already holds, and itself are not targets: no line, no drop.
    expect(await fire(tab('b1'),'dragover','left')).toBe(false);await expect(page.locator('.tab-drop-caret')).toHaveCount(0);
    expect(await fire(tab('a2'),'dragover','right')).toBe(false);await expect(page.locator('.tab-drop-caret')).toHaveCount(0);
    expect(await fire(tab('a3'),'dragover','left')).toBe(false);await expect(page.locator('.tab-drop-caret')).toHaveCount(0);
    // The drop lands on the line: the moved tab's left edge is where the line was.
    expect(await fire(tab('a1'),'dragover','left')).toBe(true);expect(Math.abs(await caretX(page)-line)).toBeLessThanOrEqual(.5);
    await fire(tab('a1'),'drop','left');await fire(tab('a3'),'dragend');
    await expect.poll(()=>tabOrder(page)).toEqual(['a3','a1','a2','b1','c1']);
    await expect(page.locator('.tab-drop-caret')).toHaveCount(0);await expect(page.locator('.tab.dragging')).toHaveCount(0);
    await expect.poll(async()=>Math.abs(await tab('a3').evaluate(e=>e.getBoundingClientRect().left)-line)).toBeLessThanOrEqual(1.5);
    // Dropping after a tab: the line is centered in the gap to the next group's chip, and the tab lands in that gap (tabs before it close up first).
    const rightEdge=(id:string)=>tab(id).evaluate(e=>e.getBoundingClientRect().right);
    await fire(tab('a3'),'dragstart');expect(await fire(tab('a2'),'dragover','right')).toBe(true);const gap=await tab('a2').evaluate(e=>(e.getBoundingClientRect().right+e.nextElementSibling!.getBoundingClientRect().left)/2);expect(Math.abs(await caretX(page)-gap)).toBeLessThanOrEqual(1.5);
    await fire(tab('a2'),'drop','right');await fire(tab('a3'),'dragend');await expect.poll(()=>tabOrder(page)).toEqual(['a1','a2','a3','b1','c1']);
    await expect.poll(async()=>Math.abs(await tab('a3').evaluate(e=>e.getBoundingClientRect().left)-await rightEdge('a2'))).toBeLessThanOrEqual(1.5);

    // A group chip moves as a block: the line sits at the edge of the whole target group.
    await fire(chip('p:paper'),'dragstart');await expect(chip('p:paper')).toHaveClass(/drag-source/);
    expect(await fire(tab('c1'),'dragover')).toBe(false);await expect(page.locator('.tab-drop-caret')).toHaveCount(0);
    expect(await fire(tab('a1'),'dragover','left')).toBe(true);// the left half of the app group: before it
    const groupLine=await caretX(page);const appLeft=await chip('p:app').evaluate(e=>e.getBoundingClientRect().left-parseFloat(getComputedStyle(e).marginLeft)/2);
    expect(Math.abs(groupLine-appLeft)).toBeLessThanOrEqual(1.5);
    await page.screenshot({animations:'disabled',path:'test-results/screenshots/61-drag-cue-group-line.png'});
    await fire(tab('a1'),'drop','left');await fire(chip('p:paper'),'dragend');await expect.poll(()=>chipOrder(page)).toEqual(['p:paper','p:app','p:api']);
    await expect(page.locator('.tab-drop-caret')).toHaveCount(0);await expect(page.locator('.drag-source')).toHaveCount(0);

    // Into a group: the chip lights up instead of a line; leaving or ending the drag clears it.
    await tab('c1').locator('button').first().click();await page.keyboard.press('Meta+g');
    const name=page.getByRole('textbox',{name:'Group name',exact:true});await expect(name).toBeFocused();await name.fill('Review');await page.keyboard.press('Enter');
    const custom=page.locator('[data-group-key^="g:"]');await expect(custom).toBeVisible();
    await fire(tab('a2'),'dragstart');expect(await fire(custom,'dragover')).toBe(true);
    await expect(custom).toHaveClass(/drop-into/);await expect(page.locator('.tab-drop-caret')).toHaveCount(0);
    await page.screenshot({animations:'disabled',path:'test-results/screenshots/62-drag-cue-chip-into.png'});
    await fire(custom,'dragleave');await expect(custom).not.toHaveClass(/drop-into/);
    expect(await fire(custom,'dragover')).toBe(true);await expect(custom).toHaveClass(/drop-into/);
    await fire(tab('a2'),'dragend');// what Escape does to a native drag
    await expect(custom).not.toHaveClass(/drop-into/);await expect(page.locator('.tab.dragging')).toHaveCount(0);
    await fire(tab('a2'),'dragstart');await fire(custom,'dragover');await fire(custom,'drop');await fire(tab('a2'),'dragend');
    await expect(page.getByRole('button',{name:/^Review group, 2 chats/})).toBeVisible();await expect(page.locator('.drop-into')).toHaveCount(0);
    // A chat already in the group is not offered it again.
    await fire(tab('a2'),'dragstart');expect(await fire(custom,'dragover')).toBe(false);await expect(page.locator('.drop-into')).toHaveCount(0);await fire(tab('a2'),'dragend');

    // Sidebar projects: a line above or below the whole project, by pointer half.
    const section=(name:string)=>page.locator('.sidebar .project-section',{has:page.locator('.project-name',{hasText:name})});
    const heading=(name:string)=>section(name).locator('.project-heading');
    await expect(page.locator('.sidebar .project-name')).toHaveText(['neurips-paper','Agent-Manager','tessera-api']);
    await fire(heading('tessera-api'),'dragstart');await expect(section('tessera-api')).toHaveClass(/drag-source/);
    expect(await fire(section('tessera-api'),'dragover','top')).toBe(false);await expect(page.locator('.sidebar .drop-before,.sidebar .drop-after')).toHaveCount(0);
    expect(await fire(section('Agent-Manager'),'dragover','bottom')).toBe(false);// already right after it
    expect(await fire(section('Agent-Manager'),'dragover','top')).toBe(true);await expect(section('Agent-Manager')).toHaveClass(/drop-before/);
    expect(await section('Agent-Manager').evaluate(e=>getComputedStyle(e,'::before').height)).toBe('2px');
    await page.screenshot({animations:'disabled',path:'test-results/screenshots/63-drag-cue-sidebar-project.png'});
    await fire(section('Agent-Manager'),'drop','top');await fire(heading('tessera-api'),'dragend');
    await expect(page.locator('.sidebar .project-name')).toHaveText(['neurips-paper','tessera-api','Agent-Manager']);
    await expect(page.locator('.sidebar .drop-before,.sidebar .drop-after,.sidebar .drag-source')).toHaveCount(0);

    // Panes: the hovered zone previews the half a split takes, or the whole pane for a move.
    const first=await page.locator('.workspace-pane').first().getAttribute('data-session-id');
    await fire(tab('b1'),'dragstart');const right=page.locator(`[data-session-id="${first}"] [data-drop-side="right"]`);await expect(right).toBeVisible();
    await fire(right,'dragover');await fire(right,'drop');await fire(tab('b1'),'dragend');await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await expect(page.locator('.pane-drop-targets')).toHaveCount(0);
    await fire(page.locator('[data-session-id="b1"] .pane-heading'),'dragstart');await expect(page.locator('[data-session-id="b1"]')).toHaveClass(/drag-source/);
    const target=page.locator(`[data-session-id="${first}"]`);const left=target.locator('[data-drop-side="left"]');
    await fire(left,'dragover');await expect(left).toHaveClass(/over/);const preview=target.locator('.pane-drop-preview.left');await expect(preview).toBeVisible();
    const [pane,half]=await Promise.all([target.boundingBox(),preview.boundingBox()]);
    expect(Math.abs(half!.x-pane!.x)).toBeLessThan(10);expect(Math.abs(half!.width-pane!.width/2)).toBeLessThan(10);
    await page.screenshot({animations:'disabled',path:'test-results/screenshots/64-drag-cue-pane-split.png'});
    const center=target.locator('[data-drop-side="center"]');await fire(left,'dragleave');await fire(center,'dragover');
    await expect(target.locator('.pane-drop-preview')).toHaveCount(1);await expect(target.locator('.pane-drop-preview.center')).toBeVisible();await expect(left).not.toHaveClass(/over/);
    await page.screenshot({animations:'disabled',path:'test-results/screenshots/65-drag-cue-pane-move.png'});
    await fire(center,'dragleave');await expect(target.locator('.pane-drop-preview')).toHaveCount(0);
    await fire(left,'dragover');await fire(page.locator('[data-session-id="b1"] .pane-heading'),'dragend');
    await expect(page.locator('.pane-drop-targets,.pane-drop-preview,.workspace-pane.drag-source')).toHaveCount(0);
    // A later drag starts clean: no leftover preview from the last one.
    await fire(tab('b1'),'dragstart');await expect(target.locator('.pane-drop-zone').first()).toBeVisible();await expect(page.locator('.pane-drop-preview,.pane-drop-zone.over')).toHaveCount(0);await fire(tab('b1'),'dragend');

    // Preferences project list: same line rules as the sidebar.
    await page.getByRole('button',{name:'Preferences',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).click();
    const rows=page.locator('.managed-project');await expect(rows).toHaveCount(3);
    await fire(rows.nth(2),'dragstart');expect(await fire(rows.nth(2),'dragover','top')).toBe(false);expect(await fire(rows.nth(1),'dragover','bottom')).toBe(false);
    await expect(page.locator('.managed-project.drop-before,.managed-project.drop-after')).toHaveCount(0);
    expect(await fire(rows.first(),'dragover','top')).toBe(true);await expect(rows.first()).toHaveClass(/drop-before/);await expect(rows.nth(2)).toHaveClass(/drag-source/);
    await page.screenshot({animations:'disabled',path:'test-results/screenshots/66-drag-cue-project-manager.png'});
    expect(await fire(rows.first(),'dragover','bottom')).toBe(true);await expect(rows.first()).toHaveClass(/drop-after/);
    await fire(rows.first(),'drop','bottom');await fire(rows.nth(2),'dragend');
    await expect(rows.locator('strong')).toHaveText(['neurips-paper','Agent-Manager','tessera-api']);
    await expect(page.locator('.managed-project.drop-before,.managed-project.drop-after,.managed-project.drag-source')).toHaveCount(0);
  } finally {await app.close();}
});
