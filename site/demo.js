// Landing page interactivity: the placeholder download buttons, the "close the lid" simulator and the tab demo.
// Everything here is simulated in the browser; nothing talks to a real Harbor.
(() => {
'use strict';
const $ = (sel, root = document) => root.querySelector(sel);

// ---- Placeholder download links -----------------------------------------------------------
const toast = $('.toast');
let toastTimer;
function say(text) { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2600); }
document.querySelectorAll('[data-placeholder]').forEach(a => a.addEventListener('click', event => {
  event.preventDefault(); say('The download link is coming soon.');
  if (!a.closest('.install')) document.getElementById('install').scrollIntoView();
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
  a2: { group: 'app', name: 'Release notes', agent: 'codex', status: 'idle', lines: ['<span class="u">›</span> Draft the 0.5 release notes', '', '• Ran git log v0.4.0..HEAD', '• Edited CHANGELOG.md <span class="ok">(+41)</span>', '', 'Done. Grouped into Features and Fixes.'] },
  b1: { group: 'api', name: 'Rate limiter', agent: 'codex', status: 'working', lines: ['<span class="u">›</span> Add a rate limiter to the API', '', '• Edited rateLimit.ts <span class="ok">(+64)</span>', '• Ran npm test <span class="dim">· 12 passing</span>', '', '<span class="dim">◦</span> Working…'] },
  b2: { group: 'api', name: 'Auth flake', agent: 'claude', status: 'attention', lines: ['<span class="u">></span> Why does the login test flake?', '', '⏺ It’s a race on the session cookie.', '', '<span class="warn">Do you want to make this edit?</span>', '❯ 1. Yes   2. No'] },
  c1: { group: 'ml', name: 'LR sweep', agent: 'codex', status: 'background', lines: ['<span class="u">›</span> Sweep learning rates on 4 GPUs', '', '• Ran sweep.py <span class="dim">(background)</span>', '  run 3/8 · val_loss 0.412', '', 'I’ll summarize when the runs finish.'] },
};
const ORDER = Object.keys(CHATS);
const RANK = { attention: 4, idle: 3, background: 2, working: 1 };
const LABEL = { working: 'Working', attention: 'Needs input', idle: 'Done', background: 'Background job' };
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

function render() {
  const tasks = [['fold', 'Fold a group', 'click its name'], ['split', 'Split', touch ? 'tap Split' : 'drag a tab onto the chat'], ['focus', 'Focus mode', 'flip the switch']];
  const strip = GROUPS.map(g => {
    const ids = ORDER.filter(id => groupOf(id) === g.id); const f = folded(g.id);
    const top = ids.reduce((a, b) => RANK[CHATS[b].status] > RANK[CHATS[a].status] ? b : a);
    const chip = `<button class="d-chip" data-group="${g.id}" aria-expanded="${!f}">${g.name}${f ? `<span class="d-count">${ids.length}</span>${icon(CHATS[top].status)}` : ''}</button>`;
    const tabs = f ? '' : ids.map(id => { const c = CHATS[id]; return `<button class="d-tab${id === S.focused ? ' active' : ''}${S.panes.includes(id) ? ' in-view' : ''}" draggable="true" data-tab="${id}">${AGENT[c.agent]}<span class="d-name">${c.name}</span>${icon(c.status)}</button>`; }).join('');
    return `<div class="d-group${f ? ' folded' : ''}" style="--c:${g.color}">${chip}${tabs}</div>`;
  }).join('');
  const panes = S.panes.map(id => { const c = CHATS[id]; const g = group(c.group);
    return `<div class="d-pane${id === S.focused ? ' focused' : ''}" style="--c:${g.color}" data-pane="${id}"><div class="d-pane-head">${AGENT[c.agent]}<b>${c.name}</b>${icon(c.status)}<span class="d-where">${g.host}</span>${S.panes.length > 1 ? `<button class="d-pane-btn" data-unsplit="${id}" aria-label="Close this pane">×</button>` : `<button class="d-pane-btn" data-quicksplit title="Split view">Split ⧉</button>`}</div><div class="d-term">${c.lines.join('\n')}</div></div>`; }).join('');
  root.innerHTML = `
    <div class="d-tasks">${tasks.map(([k, t, how]) => `<span class="d-task${S.done.has(k) ? ' done' : ''}"><i>✓</i><b>${t}</b>${how}</span>`).join('')}</div>
    <div class="d-window">
      <div class="d-bar"><div class="d-strip">${strip}</div><button class="d-focus${S.focus ? ' on' : ''}" data-focus aria-pressed="${S.focus}" aria-label="Focus mode"><span class="d-switch"></span><span class="d-focus-label">Focus mode</span></button><button class="d-reset" data-reset title="Start over">↺</button></div>
      ${S.panes.length ? `<div class="d-panes${S.panes.length > 1 ? ' split' : ''}">${panes}<div class="d-drop"><div class="d-zone" data-zone="left">Split left</div><div class="d-zone" data-zone="right">Split right</div></div></div>` : '<div class="d-empty">All groups folded. Each chip still shows its most urgent status.<br>Click one to open it.</div>'}
    </div>`;
}

root.addEventListener('click', e => {
  const t = e.target;
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
  dragId = tab.dataset.tab; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
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
