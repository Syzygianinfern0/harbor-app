// Landing page interactivity: copying the install command, the "close the lid" simulator and the tab demo.
// Everything here is simulated in the browser; nothing talks to a real Harbor.
(() => {
'use strict';
const $ = (sel, root = document) => root.querySelector(sel);

// ---- Toasts and the install command ---------------------------------------------------------
const toast = $('.toast');
let toastTimer;
function say(text) { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2600); }
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => {
  const text = $(button.dataset.copy).textContent;
  navigator.clipboard.writeText(text).then(() => say('Copied. Paste it into Terminal.'), () => say('Select the command and copy it.'));
}));

// ---- Close-the-lid simulator ---------------------------------------------------------------
const sim = $('#lid-sim');
if (sim) {
  const jobs = { mac: { p: 22, remote: false }, build: { p: 48, remote: true }, gpu: { p: 9, remote: true } };
  const notes = {
    open: 'Harbor is attached to all three chats.',
    quit: 'Harbor is closed. Every chat keeps running.',
    offline: 'Offline. The servers keep going, and Harbor reattaches when you’re back.',
    lid: 'Your Mac is asleep, so its chat pauses. The servers keep going.',
  };
  let event = 'open';
  const running = host => !(event === 'lid' && !jobs[host].remote);
  const state = host => {
    if (event === 'open') return 'Attached';
    if (event === 'quit') return 'Running · Harbor closed';
    if (event === 'offline') return jobs[host].remote ? 'Running · offline' : 'Attached';
    return jobs[host].remote ? 'Running' : 'Paused';
  };
  function draw() {
    for (const host of Object.keys(jobs)) {
      const el = sim.querySelector(`[data-job="${host}"]`); const on = running(host);
      el.className = 'job' + (on ? '' : ' paused');
      el.innerHTML = `<i class="st ${on ? 'working' : 'paused'}" aria-hidden="true"></i><span class="bar"><i style="width:${jobs[host].p}%"></i></span>`;
      let label = el.nextElementSibling;
      if (!label) { label = document.createElement('span'); label.className = 'link-state'; el.after(label); }
      label.textContent = state(host);
    }
    sim.querySelector('[data-host=mac]').classList.toggle('dim', event === 'lid');
    sim.querySelector('.sim-note').textContent = notes[event];
    sim.querySelectorAll('[data-event]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.event === event)));
  }
  sim.addEventListener('click', e => { const b = e.target.closest('[data-event]'); if (b) { event = b.dataset.event; draw(); } });
  setInterval(() => {
    for (const host of Object.keys(jobs)) {
      if (running(host)) { jobs[host].p += 0.7 + Math.random() * 1.1; if (jobs[host].p >= 100) jobs[host].p = 4; }
      const bar = sim.querySelector(`[data-job="${host}"] .bar i`); if (bar) bar.style.width = jobs[host].p + '%';
    }
  }, 600);
  draw();
}

// ---- Tab demo: three groups, fold / split / focus ------------------------------------------
const root = $('#demo');
if (!root) return;

const GROUPS = [
  { id: 'app', name: 'harbor-app', host: 'This Mac', color: '#9be1c4' },
  { id: 'api', name: 'tessera-api', host: 'build-01', color: '#8fb4e8' },
  { id: 'ml', name: 'vision-train', host: 'gpu-box', color: '#e3c27d' },
];
const CHATS = {
  a1: { group: 'app', name: 'Tab polish', agent: 'claude', status: 'working', lines: ['<span class="u">></span> Tighten tab spacing', '', '<span class="ok">⏺ Read</span> TabStrip.tsx', '<span class="ok">⏺ Update</span> styles.css <span class="ok">(+6 -2)</span>', '', '<span class="warn">✻</span> Working…'] },
  a2: { group: 'app', name: 'Release notes', agent: 'codex', status: 'done', lines: ['<span class="u">›</span> Draft the 0.5 release notes', '', '• Ran git log v0.4.0..HEAD', '• Edited CHANGELOG.md <span class="ok">(+41)</span>', '', 'Done. Grouped into Features and Fixes.'] },
  b1: { group: 'api', name: 'Rate limiter', agent: 'codex', status: 'working', lines: ['<span class="u">›</span> Add a rate limiter to the API', '', '• Edited rateLimit.ts <span class="ok">(+64)</span>', '• Ran npm test <span class="dim">· 12 passing</span>', '', '<span class="dim">◦</span> Working…'] },
  b2: { group: 'api', name: 'Auth flake', agent: 'claude', status: 'attention', lines: ['<span class="u">></span> Why does the login test flake?', '', '⏺ It’s a race on the session cookie.', '', '<span class="warn">Do you want to make this edit?</span>', '❯ 1. Yes   2. No'] },
  c1: { group: 'ml', name: 'LR sweep', agent: 'codex', status: 'background', lines: ['<span class="u">›</span> Sweep learning rates on 4 GPUs', '', '• Ran sweep.py <span class="dim">(background)</span>', '  run 3/8 · val_loss 0.412', '', 'I’ll summarize when the runs finish.'] },
};
const ORDER = Object.keys(CHATS);
const RANK = { attention: 4, done: 3, background: 2, working: 1 };
const LABEL = { working: 'Working', attention: 'Needs input', done: 'Done', background: 'Background job' };
const AGENT = {
  claude: '<svg class="d-agent" viewBox="0 0 16 16" aria-label="Claude Code"><path d="M8 1.8v12.4M1.8 8h12.4M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  codex: '<svg class="d-agent" viewBox="0 0 16 16" aria-label="Codex"><path d="M8 1.6l5.5 3.2v6.4L8 14.4l-5.5-3.2V4.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};
const icon = s => `<i class="st ${s}" role="img" aria-label="${LABEL[s]}" title="${LABEL[s]}"></i>`;
const group = id => GROUPS.find(g => g.id === id);
const touch = matchMedia('(pointer: coarse)').matches;
const groupOf = id => CHATS[id].group;

let S;
function reset() { S = { folded: new Set(), saved: null, focus: false, panes: ['a1'], focused: 'a1', split: null, last: { app: 'a1', api: 'b1', ml: 'c1' }, done: new Set() }; }
reset();

const folded = g => S.focus ? g !== (S.focused && groupOf(S.focused)) : S.folded.has(g);
function show(id) {
  const g = groupOf(id); S.folded.delete(g); S.last[g] = id; S.focused = id;
  S.panes = S.split && S.split.includes(id) ? S.split.slice() : [id];
}
// Take a group's chats off screen; the view moves to another open group, or to the folded overview.
function hide(g) {
  if (S.split && S.split.some(id => groupOf(id) === g)) S.split = null;
  S.panes = S.panes.filter(id => groupOf(id) !== g);
  if (S.panes.length) { S.focused = S.panes[0]; return; }
  const next = GROUPS.find(x => !folded(x.id) && x.id !== g);
  if (next) show(S.last[next.id]); else S.focused = null;
}
function toggleGroup(g) {
  if (S.focus) {
    if (S.focused && g === groupOf(S.focused)) { S.split = null; S.panes = []; S.focused = null; }
    else show(S.last[g]);
    return;
  }
  if (S.folded.has(g)) { S.folded.delete(g); if (!S.panes.length) show(S.last[g]); return; }
  S.folded.add(g); S.done.add('fold'); hide(g);
}
function setFocus(on) {
  S.focus = on;
  if (on) {
    S.done.add('focus'); S.saved = new Set(S.folded);
    if (!S.focused) show(S.last[GROUPS.find(g => !S.folded.has(g.id))?.id || 'app']);
    const g = groupOf(S.focused);
    // Only the current group stays open, so a split with another group's chat comes apart.
    if (S.split && S.split.some(id => groupOf(id) !== g)) { S.split = null; S.panes = [S.focused]; }
  } else {
    S.folded = S.saved || new Set(); S.saved = null;
    if (S.focused) S.folded.delete(groupOf(S.focused));
  }
}
function splitWith(id, side) {
  const base = S.focused; if (!base || id === base) return;
  S.split = side === 'left' ? [id, base] : [base, id];
  S.folded.delete(groupOf(id)); S.panes = S.split.slice(); S.focused = id; S.last[groupOf(id)] = id; S.done.add('split');
}
function unsplit(id) { S.split = null; S.panes = S.panes.filter(x => x !== id); S.focused = S.panes[0]; }

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPLIT_MARK = '<svg class="d-split-mark" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 3v10" stroke="currentColor" stroke-width="1.4"/></svg>';
const TASKS = [['fold', 'Fold a group'], ['split', 'Split'], ['focus', 'Focus mode']];

// The skeleton is built once; render() updates its parts so switches and checks can transition.
root.innerHTML = `
  <div class="d-tasks">${TASKS.map(([k, t]) => `<button type="button" class="d-task" data-task="${k}" title="Show me"><i>✓</i><b>${t}</b></button>`).join('')}<button type="button" class="d-reset" data-reset hidden>↺ Start over</button></div>
  <div class="d-window">
    <div class="d-bar"><div class="d-strip"></div><button class="d-focus" data-focus aria-label="Focus mode"><span class="d-switch"></span><span class="d-focus-label">Focus mode</span></button></div>
    <div class="d-main"></div>
  </div>
  <div class="d-coach" aria-hidden="true"><div class="d-coach-zone"></div><div class="d-coach-ghost"></div><div class="d-coach-ring"></div><svg class="d-coach-hand" viewBox="0 0 24 24"><path d="M5 3l14 7.5-6.2 1.6L9.6 18z" fill="#fff" stroke="#0d0f13" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="d-coach-label"></span></div>`;
const strip = $('.d-strip', root), bar = $('.d-bar', root), main = $('.d-main', root), focusBtn = $('[data-focus]', root);

function stripHTML() {
  const visible = GROUPS.flatMap(g => folded(g.id) ? [] : ORDER.filter(id => groupOf(id) === g.id));
  const splitView = S.panes.length > 1;
  return GROUPS.map(g => {
    const ids = ORDER.filter(id => groupOf(id) === g.id); const f = folded(g.id);
    const top = ids.reduce((a, b) => RANK[CHATS[b].status] > RANK[CHATS[a].status] ? b : a);
    const chip = `<div class="d-chipw${f ? ' collapsed' : ''}" data-key="g:${g.id}" style="--c:${g.color}"><button class="d-chip" data-group="${g.id}" aria-expanded="${!f}">${g.name}${f ? `<span class="d-count">${ids.length}</span>${icon(CHATS[top].status)}` : ''}</button></div>`;
    const tabs = f ? '' : ids.map((id, i) => {
      const c = CHATS[id]; const active = id === S.focused && S.panes.length > 0;
      const inSplit = S.split && S.split.includes(id); const at = visible.indexOf(id);
      const cls = ['d-tab', active && 'active', i === ids.length - 1 && 'group-end', S.panes.includes(id) && 'in-view',
        inSplit && 'split', inSplit && splitView && S.panes.includes(id) && 'split-view',
        inSplit && !S.split.includes(visible[at - 1]) && 'split-start', inSplit && !S.split.includes(visible[at + 1]) && 'split-end'].filter(Boolean).join(' ');
      const flares = active && !inSplit ? '<i class="d-flare l"></i><i class="d-flare r"></i>' : '';
      return `<button class="${cls}" style="--c:${g.color}" draggable="true" data-tab="${id}" data-key="t:${id}">${inSplit ? SPLIT_MARK : ''}${AGENT[c.agent]}<span class="d-name">${c.name}</span>${icon(c.status)}${flares}</button>`;
    }).join('');
    return chip + tabs;
  }).join('');
}

// FLIP, as in the app's useTabMotion: items that stay slide from where they were, new ones fade and scale in,
// removed ones leave a fading ghost.
const EASE = 'cubic-bezier(.2,0,0,1)';
function drawStrip() {
  const motion = !reduced(); const origin = bar.getBoundingClientRect();
  const before = new Map([...strip.querySelectorAll('[data-key]')].map(el => [el.dataset.key, { el, rect: el.getBoundingClientRect() }]));
  bar.querySelectorAll('.d-ghost').forEach(g => g.remove());
  strip.innerHTML = stripHTML();
  if (!motion || !before.size) return;
  const after = new Set();
  strip.querySelectorAll('[data-key]').forEach(el => {
    const key = el.dataset.key; after.add(key); const old = before.get(key); const rect = el.getBoundingClientRect();
    if (!old) { el.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 150, easing: EASE }); return; }
    const dx = old.rect.left - rect.left;
    if (Math.abs(dx) > .5) el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 170, easing: EASE });
  });
  for (const [key, { el, rect }] of before) {
    if (after.has(key) || !rect.width) continue;
    el.classList.remove('active', 'in-view', 'split-view'); el.querySelectorAll('.d-flare').forEach(f => f.remove());
    el.classList.add('d-ghost'); el.removeAttribute('data-tab'); el.removeAttribute('data-key'); el.inert = true;
    Object.assign(el.style, { position: 'absolute', left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: 0 });
    bar.appendChild(el);
    const exit = el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.92)' }], { duration: 120, easing: EASE, fill: 'forwards' });
    exit.onfinish = () => el.remove();
  }
}

let shownPanes = '';
function drawMain() {
  const key = S.panes.join(',');
  const panes = S.panes.map(id => { const c = CHATS[id]; const g = group(c.group);
    return `<div class="d-pane${id === S.focused ? ' focused' : ''}" style="--c:${g.color}" data-pane="${id}"><div class="d-pane-head">${AGENT[c.agent]}<b>${c.name}</b>${icon(c.status)}<span class="d-where">${g.host}</span>${S.panes.length > 1 ? `<button class="d-pane-btn" data-unsplit="${id}" aria-label="Close this pane">×</button>` : `<button class="d-pane-btn" data-quicksplit title="Split view">Split ⧉</button>`}</div><div class="d-term">${c.lines.join('\n')}</div></div>`; }).join('');
  main.innerHTML = S.panes.length
    ? `<div class="d-panes${S.panes.length > 1 ? ' split' : ''}">${panes}<div class="d-drop"><div class="d-zone" data-zone="left">Split left</div><div class="d-zone" data-zone="right">Split right</div></div></div>`
    : '<div class="d-empty">All groups folded. Each chip still shows its most urgent status.<br>Click one to open it.</div>';
  if (key === shownPanes || reduced()) { shownPanes = key; return; }
  const prev = shownPanes.split(',').filter(Boolean); shownPanes = key;
  const added = S.panes.filter(id => !prev.includes(id));
  // A new split pane grows in beside the one already there; anything else fades in, like the app's pane workspace.
  if (S.panes.length === 2 && added.length === 1 && S.panes.some(id => prev.includes(id))) {
    main.querySelector(`[data-pane="${added[0]}"]`).animate([{ flexGrow: .001, opacity: 0 }, { flexGrow: 1, opacity: 1 }], { duration: 220, easing: EASE });
  } else if (!S.panes.length) main.firstElementChild.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: EASE });
  else main.firstElementChild.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 140, easing: EASE });
}

function render() {
  root.querySelectorAll('[data-task]').forEach(el => {
    const done = S.done.has(el.dataset.task);
    if (done && !el.classList.contains('done') && !reduced()) el.querySelector('i').animate([{ transform: 'scale(.4)' }, { transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 320, easing: EASE });
    el.classList.toggle('done', done);
  });
  $('[data-reset]', root).hidden = !S.done.size;
  focusBtn.classList.toggle('on', S.focus); focusBtn.setAttribute('aria-pressed', String(S.focus));
  drawStrip(); drawMain(); coach.arm();
}

// ---- Coach: after a pause, a pointer shows how to do the next task (or the one whose pill was clicked). ----------
const coach = (() => {
  const layer = $('.d-coach', root), hand = $('.d-coach-hand', layer), ring = $('.d-coach-ring', layer), label = $('.d-coach-label', layer);
  const zone = $('.d-coach-zone', layer), ghost = $('.d-coach-ghost', layer);
  let timer, running = [], seen = false;
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; if (seen) arm(); else stop(); }, { threshold: .5 }).observe(root);
  const at = el => { const r = el.getBoundingClientRect(), o = root.getBoundingClientRect(); return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2, r }; };
  function stop() { clearTimeout(timer); running.forEach(a => a.cancel()); running = []; layer.classList.remove('on', 'drag'); }
  function arm(task, delay = 1400) {
    stop(); task ??= TASKS.map(t => t[0]).find(k => !S.done.has(k));
    if (!task || !seen || root.classList.contains('dragging')) return;
    timer = setTimeout(() => play(task), delay);
  }
  function target(task) {
    const chip = GROUPS.find(g => !folded(g.id)) ? strip.querySelector(`.d-chipw:not(.collapsed) .d-chip`) : strip.querySelector('.d-chip');
    if (task === 'fold') return { el: chip, text: S.panes.length ? 'Click to fold' : 'Click to open' };
    if (task === 'focus') return { el: focusBtn, text: 'Flip the switch' };
    if (!S.panes.length) return { el: strip.querySelector('.d-chip'), text: 'Open a group first' };
    if (touch) return { el: main.querySelector('[data-quicksplit]') || main.querySelector('[data-unsplit]'), text: 'Tap Split' };
    const src = strip.querySelector('.d-tab:not(.in-view)');
    if (!src) return { el: strip.querySelector('.d-chipw.collapsed .d-chip') || focusBtn, text: 'Open another group' };
    return { el: src, drag: main.querySelector('.d-pane:last-of-type'), text: 'Drag onto the chat' };
  }
  function play(task) {
    const t = target(task); if (!t.el) return;
    t.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const a = at(t.el); layer.classList.add('on');
    label.textContent = t.text;
    Object.assign(label.style, { left: `${Math.max(8, Math.min(a.x - 60, root.clientWidth - 180))}px`, top: `${a.y + a.r.height / 2 + 12}px` });
    ring.style.transform = `translate(${a.x}px,${a.y}px)`;
    const still = reduced();
    if (!t.drag) {
      hand.style.transform = `translate(${a.x}px,${a.y}px)`;
      if (!still) running = [
        hand.animate([{ transform: `translate(${a.x + 40}px,${a.y + 44}px)`, opacity: 0 }, { transform: `translate(${a.x}px,${a.y}px)`, opacity: 1, offset: .4 }, { transform: `translate(${a.x}px,${a.y}px) scale(.85)`, offset: .5 }, { transform: `translate(${a.x}px,${a.y}px)`, offset: .6 }, { transform: `translate(${a.x}px,${a.y}px)`, opacity: 1 }], { duration: 1500, iterations: 3, easing: EASE }),
        ring.animate([{ opacity: 0, transform: `translate(${a.x}px,${a.y}px) scale(.4)` }, { opacity: 0, offset: .5 }, { opacity: .9, transform: `translate(${a.x}px,${a.y}px) scale(.6)`, offset: .52 }, { opacity: 0, transform: `translate(${a.x}px,${a.y}px) scale(1.6)` }], { duration: 1500, iterations: 3 }),
      ];
    } else {
      // Drag: a copy of the tab travels from the strip to the chat's right half, which lights up like the real drop preview.
      layer.classList.add('drag');
      const pane = t.drag.getBoundingClientRect(), o = root.getBoundingClientRect();
      Object.assign(zone.style, { left: `${pane.left - o.left + pane.width / 2 + 3}px`, top: `${pane.top - o.top}px`, width: `${pane.width / 2 - 3}px`, height: `${pane.height}px` });
      ghost.innerHTML = t.el.innerHTML; ghost.style.setProperty('--c', t.el.style.getPropertyValue('--c'));
      const b = { x: pane.left - o.left + pane.width * .75, y: pane.top - o.top + pane.height / 2 };
      const move = (dx, dy) => [{ transform: `translate(${a.x + dx}px,${a.y + dy}px)`, opacity: 0 }, { transform: `translate(${a.x + dx}px,${a.y + dy}px)`, opacity: 1, offset: .15 }, { transform: `translate(${a.x + dx}px,${a.y + dy}px)`, opacity: 1, offset: .25 }, { transform: `translate(${b.x + dx}px,${b.y + dy}px)`, opacity: 1, offset: .7 }, { transform: `translate(${b.x + dx}px,${b.y + dy}px)`, opacity: 1, offset: .85 }, { transform: `translate(${b.x + dx}px,${b.y + dy}px)`, opacity: 0 }];
      hand.style.transform = `translate(${b.x}px,${b.y}px)`; ghost.style.transform = `translate(${b.x - 70}px,${b.y - 16}px)`;
      if (!still) running = [
        hand.animate(move(0, 0), { duration: 2400, iterations: 3, easing: 'ease-in-out' }),
        ghost.animate(move(-70, -16), { duration: 2400, iterations: 3, easing: 'ease-in-out' }),
        zone.animate([{ opacity: 0 }, { opacity: 0, offset: .55 }, { opacity: 1, offset: .65 }, { opacity: 1, offset: .88 }, { opacity: 0 }], { duration: 2400, iterations: 3 }),
      ];
    }
    const end = running[0]; if (end) end.onfinish = () => { layer.classList.remove('on', 'drag'); };
  }
  return { arm, stop };
})();

root.addEventListener('pointerdown', () => coach.stop());
root.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('[data-task]')) { coach.arm(t.closest('[data-task]').dataset.task, 0); return; }
  if (t.closest('[data-reset]')) reset();
  else if (t.closest('[data-focus]')) setFocus(!S.focus);
  else if (t.closest('[data-group]')) toggleGroup(t.closest('[data-group]').dataset.group);
  else if (t.closest('[data-tab]')) show(t.closest('[data-tab]').dataset.tab);
  else if (t.closest('[data-unsplit]')) unsplit(t.closest('[data-unsplit]').dataset.unsplit);
  else if (t.closest('[data-quicksplit]')) { const ids = ORDER.filter(id => groupOf(id) === groupOf(S.focused) && id !== S.focused); if (ids.length) splitWith(ids[0], 'right'); else say('This group has one chat. Drag a tab from another group.'); }
  else if (t.closest('[data-pane]')) { S.focused = t.closest('[data-pane]').dataset.pane; }
  else return;
  render();
});

// Drag a tab onto the chat: the left or right half decides where it lands.
let dragId = null;
root.addEventListener('dragstart', e => {
  const tab = e.target.closest?.('[data-tab]'); if (!tab || !S.panes.length) return;
  coach.stop(); dragId = tab.dataset.tab; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  requestAnimationFrame(() => { tab.classList.add('dragging'); root.classList.add('dragging'); });
});
root.addEventListener('dragend', () => { dragId = null; root.classList.remove('dragging'); render(); });
root.addEventListener('dragover', e => {
  const zone = e.target.closest('[data-zone]'); root.querySelectorAll('.d-zone.over').forEach(z => z.classList.remove('over'));
  if (dragId && zone) { e.preventDefault(); zone.classList.add('over'); }
});
root.addEventListener('drop', e => {
  const zone = e.target.closest('[data-zone]'); if (!dragId || !zone) return;
  e.preventDefault();
  const id = dragId; dragId = null; root.classList.remove('dragging');
  if (S.panes.includes(id)) { if (S.panes.length === 1) say('Drag a different tab onto this chat.'); render(); return; }
  if (S.panes.length > 1) { S.split = null; S.panes = [S.focused]; }
  splitWith(id, zone.dataset.zone); render();
});
render();
})();
