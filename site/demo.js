// Landing page interactivity: the placeholder download buttons, the "close the lid" simulator and the tab demo.
// Everything here is simulated in the browser; nothing talks to a real Harbor.
(() => {
'use strict';
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Placeholder download links -----------------------------------------------------------
const toast = $('.toast');
let toastTimer;
function say(text) { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2600); }
document.querySelectorAll('[data-placeholder]').forEach(a => a.addEventListener('click', event => {
  event.preventDefault(); say('The download link is coming soon.');
  if (a.closest('.install')) return; document.getElementById('install').scrollIntoView();
}));

// ---- Close-the-lid simulator ---------------------------------------------------------------
const sim = $('#lid-sim');
if (sim) {
  const jobs = { mac: { label: 'tab-strip polish', p: 22, remote: false }, build: { label: 'rate limiter', p: 48, remote: true }, gpu: { label: 'lr sweep 3/8', p: 9, remote: true } };
  const notes = {
    open: 'Harbor is attached to all three chats. Each one runs in tmux on its own machine.',
    quit: 'Harbor is closed, and every chat keeps running in tmux. Reopen Harbor and the same tabs reattach.',
    offline: 'The network is gone, but the servers never noticed. When it comes back, Harbor reattaches without restarting either agent.',
    lid: 'Your Mac is asleep, so the local chat pauses until it wakes. The chats on build-01 and gpu-box keep going.',
  };
  let event = 'open';
  const link = (host) => {
    const remote = jobs[host].remote;
    if (event === 'open') return 'Attached';
    if (event === 'quit') return 'Running in tmux · Harbor closed';
    if (event === 'offline') return remote ? 'Running · reattaches when back online' : 'Attached';
    return remote ? 'Running on the server' : 'Paused while the Mac sleeps';
  };
  const running = host => !(event === 'lid' && !jobs[host].remote);
  function draw() {
    for (const host of Object.keys(jobs)) {
      const job = jobs[host]; const el = sim.querySelector(`[data-job="${host}"]`);
      const on = running(host);
      el.className = 'job' + (on ? '' : ' paused');
      el.innerHTML = `<i class="st ${on ? 'working' : 'paused'}" aria-hidden="true"></i><span class="bar"><i style="width:${job.p}%"></i></span><span class="pct">${Math.floor(job.p)}%</span>`;
      el.title = job.label;
      let state = el.nextElementSibling;
      if (!state) { state = document.createElement('span'); state.className = 'link-state'; el.after(state); }
      state.textContent = link(host);
    }
    sim.querySelector('[data-host=mac]').classList.toggle('dim', event === 'lid');
    sim.querySelector('.sim-note').textContent = notes[event];
    sim.querySelectorAll('[data-event]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.event === event)));
  }
  sim.addEventListener('click', e => { const b = e.target.closest('[data-event]'); if (!b) return; event = b.dataset.event; draw(); });
  setInterval(() => {
    for (const host of Object.keys(jobs)) if (running(host)) { jobs[host].p += 0.7 + Math.random() * 1.1; if (jobs[host].p >= 100) jobs[host].p = 4; }
    for (const host of Object.keys(jobs)) {
      const el = sim.querySelector(`[data-job="${host}"]`); const bar = el.querySelector('.bar i'); const pct = el.querySelector('.pct');
      if (bar) { bar.style.width = jobs[host].p + '%'; pct.textContent = Math.floor(jobs[host].p) + '%'; }
    }
  }, 600);
  draw();
}

// ---- Tab demo -----------------------------------------------------------------------------
const root = $('#demo');
if (!root) return;

const COLORS = { mint: '#9be1c4', sky: '#8fb4e8', gold: '#e3c27d', rose: '#e3a1a8', violet: '#b9a4f5' };
const PROJECTS = [
  { id: 'app', name: 'harbor-app', host: '', color: COLORS.mint },
  { id: 'api', name: 'tessera-api', host: 'build-01', color: COLORS.sky },
  { id: 'ml', name: 'vision-train', host: 'gpu-box', color: COLORS.gold },
  { id: 'docs', name: 'docs-site', host: '', color: COLORS.rose },
];
const INITIAL = [
  ['a1', 'app', 'Tab strip polish', 'claude', 'working'],
  ['a2', 'app', 'Release notes 0.5', 'codex', 'idle', true],
  ['a3', 'app', 'Fix SSH reattach', 'codex', 'working'],
  ['b1', 'api', 'Rate limiter', 'codex', 'working'],
  ['b2', 'api', 'Flaky auth test', 'claude', 'attention', true],
  ['b3', 'api', 'Postgres 17 migration', 'claude', 'background'],
  ['c1', 'ml', 'Learning-rate sweep', 'codex', 'background'],
  ['c2', 'ml', 'Plot ablations', 'claude', 'idle', true],
  ['c3', 'ml', 'Eval harness', 'codex', 'working'],
  ['d1', 'docs', 'Rewrite quickstart', 'claude', 'working'],
];
const PROMPTS = {
  a1: 'Tighten tab spacing; show status on folded groups', a2: 'Draft 0.5 release notes from commits since v0.4.0', a3: 'SSH chats sometimes reattach twice. Find out why.',
  b1: 'Add a token-bucket rate limiter to the public API', b2: 'Login test fails 1 in 20 CI runs. Find out why.', b3: 'Upgrade staging to Postgres 17, re-run the suite',
  c1: 'Sweep learning rates 1e-4..3e-3 on the small config', c2: 'Plot the ablations, one panel per backbone', c3: 'Build an eval harness that scores every checkpoint',
  d1: 'Rewrite the quickstart so it works in five minutes',
};
const STEPS = {
  claude: [['ok', '⏺ Read'], ['ok', '⏺ Update'], ['ok', '⏺ Bash']],
  codex: [['', '• Explored'], ['', '• Edited'], ['', '• Ran']],
};
const FILES = { a1: 'TabStrip.tsx', a2: 'CHANGELOG.md', a3: 'transport.ts', b1: 'rateLimit.ts', b2: 'session.ts', b3: 'migrate.sh', c1: 'sweep_lr.yaml', c2: 'plot_ablations.py', c3: 'harness.py', d1: 'quickstart.md' };
const LABEL = { working: 'Working', attention: 'Needs input', idle: 'Turn finished', background: 'Waiting on background work' };
const RANK = { attention: 4, idle: 3, background: 2, working: 1 };
const AGENT = {
  claude: '<svg class="d-agent" viewBox="0 0 16 16" aria-label="Claude Code"><path d="M8 1.8v12.4M1.8 8h12.4M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  codex: '<svg class="d-agent" viewBox="0 0 16 16" aria-label="Codex"><path d="M8 1.6l5.5 3.2v6.4L8 14.4l-5.5-3.2V4.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.8 6.4 7.6 8l-1.8 1.6M8.6 10h1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};
const icon = status => `<i class="st ${status}" role="img" aria-label="${LABEL[status]}" title="${LABEL[status]}"></i>`;

let S;
function reset() {
  S = {
    chats: Object.fromEntries(INITIAL.map(([id, project, name, agent, status, unread]) => [id, { id, project, name, agent, status, unread: !!unread, steps: 2 }])),
    open: ['a1', 'a2', 'b1', 'b2', 'c2'],
    folded: new Set(), focus: false, custom: [], selected: new Set(),
    panes: ['b1', 'b2'], focused: 'b1', split: ['b1', 'b2'], mru: ['b1', 'b2', 'a1', 'c2', 'c1', 'a2'],
    width: 100, anchor: null,
  };
}
reset();

const chat = id => S.chats[id];
const project = id => PROJECTS.find(p => p.id === id);
// A custom group owns its members; everyone else sits in their project's group.
const groupOf = id => { const g = S.custom.find(g => g.members.includes(id)); return g ? 'g:' + g.id : 'p:' + chat(id).project; };
const groupColor = key => key.startsWith('g:') ? S.custom.find(g => 'g:' + g.id === key).color : project(key.slice(2)).color;
const groupName = key => key.startsWith('g:') ? S.custom.find(g => 'g:' + g.id === key).name : project(key.slice(2)).name;
function groups() {
  const keys = [];
  for (const p of PROJECTS) {
    // Custom groups follow the project of their first tab.
    if (S.open.some(id => groupOf(id) === 'p:' + p.id)) keys.push('p:' + p.id);
    for (const g of S.custom) if (chat(g.members[0]).project === p.id && S.open.some(id => groupOf(id) === 'g:' + g.id)) keys.push('g:' + g.id);
  }
  return keys.map(key => ({ key, tabs: S.open.filter(id => groupOf(id) === key) }));
}
const viewGroup = () => S.focused ? groupOf(S.focused) : null;
const isFolded = key => S.focus ? key !== viewGroup() : S.folded.has(key);
const visible = id => S.panes.includes(id);
const urgent = ids => ids.reduce((best, id) => !best || RANK[chat(id).status] > RANK[chat(best).status] ? id : best, null);

function touch(id) { S.mru = [id, ...S.mru.filter(x => x !== id)]; }
function show(id) {
  if (!S.open.includes(id)) S.open.push(id);
  const key = groupOf(id); S.folded.delete(key);
  S.panes = S.split && S.split.includes(id) ? S.split.slice() : [id];
  S.focused = id; touch(id); S.selected.clear(); read();
}
function read() { for (const id of S.panes) chat(id).unread = false; }
function fallback() {
  const next = S.mru.find(id => S.open.includes(id) && !isFolded(groupOf(id)));
  if (next) show(next); else { S.panes = []; S.focused = null; }
}
function fold(key) {
  if (S.focus) {
    if (key === viewGroup()) { S.panes = []; S.focused = null; return; }
    const target = S.mru.find(id => S.open.includes(id) && groupOf(id) === key); if (target) show(target); return;
  }
  if (S.folded.has(key)) {
    S.folded.delete(key);
    if (!S.panes.length) { const target = S.mru.find(id => S.open.includes(id) && groupOf(id) === key); if (target) show(target); }
    return;
  }
  S.folded.add(key);
  if (S.panes.some(id => groupOf(id) === key)) fallback();
}
function close(id) {
  S.open = S.open.filter(x => x !== id); S.selected.delete(id);
  if (S.split && S.split.includes(id)) S.split = null;
  for (const g of S.custom) g.members = g.members.filter(m => m !== id);
  S.custom = S.custom.filter(g => g.members.length);
  if (S.panes.includes(id)) { S.panes = S.panes.filter(x => x !== id); if (S.panes.length) { S.focused = S.panes[0]; } else fallback(); }
}
function splitWith(source, side) {
  const target = S.focused; if (!target || source === target) return;
  if (!S.open.includes(source)) S.open.push(source);
  S.split = side === 'left' ? [source, target] : [target, source];
  // Split tabs sit side by side in the strip, in pane order.
  S.open = S.open.filter(id => id !== S.split[1]); S.open.splice(S.open.indexOf(S.split[0]) + 1, 0, S.split[1]);
  S.panes = S.split.slice(); S.focused = source; touch(source); read();
}
function groupSelected() {
  const members = S.open.filter(id => S.selected.has(id)); if (members.length < 2) return;
  for (const g of S.custom) g.members = g.members.filter(m => !members.includes(m));
  S.custom = S.custom.filter(g => g.members.length);
  const palette = [COLORS.violet, COLORS.rose, COLORS.sky];
  const n = S.custom.length;
  S.custom.push({ id: String(Date.now()), name: n ? `Release ${n + 1}` : 'Review', color: palette[n % palette.length], members });
  // Members move together, after the first one.
  const first = S.open.indexOf(members[0]); const rest = S.open.filter(id => !members.includes(id));
  rest.splice(Math.min(first, rest.length), 0, ...members); S.open = rest;
  S.selected.clear(); say('Grouped ' + members.length + ' tabs. In Harbor that’s ⌘G.');
}
function nextNeedsInput() {
  const id = Object.keys(S.chats).find(id => chat(id).status === 'attention' && !visible(id));
  if (id) show(id); else say('Nothing needs you right now.');
}
function respond(id) { const c = chat(id); c.status = 'working'; c.steps = Math.min(c.steps + 1, 3); }

// ---- Rendering ----
function tabHtml(id, key, compact) {
  const c = chat(id); const color = groupColor(key);
  const cls = ['d-tab'];
  if (id === S.focused) cls.push('active');
  if (S.split && S.split.includes(id)) cls.push('in-split');
  if (visible(id)) cls.push('in-view');
  if (S.selected.has(id)) cls.push('selected');
  if (compact && id !== S.focused) cls.push('compact');
  return `<div class="${cls.join(' ')}" style="--c:${color}" draggable="true" data-tab="${id}" title="${esc(c.name)} · ${LABEL[c.status]}">${AGENT[c.agent]}<span class="d-name">${esc(c.name)}</span>${c.unread ? '<i class="d-dot" aria-label="Unread"></i>' : ''}${icon(c.status)}<span class="d-close" data-close="${id}" role="button" aria-label="Close ${esc(c.name)}">×</span></div>`;
}
function stripHtml(compact) {
  const gs = groups();
  return gs.map(g => {
    const folded = isFolded(g.key); const color = groupColor(g.key); const top = urgent(g.tabs);
    const unread = g.tabs.some(id => chat(id).unread);
    const chip = `<button class="d-chip" style="--c:${color}" data-chip="${g.key}" aria-expanded="${!folded}" title="${folded ? 'Unfold' : 'Fold'} ${esc(groupName(g.key))}">${esc(groupName(g.key))}${folded ? `<span class="d-count">${g.tabs.length}</span>${top ? `<span data-open="${top}">${icon(chat(top).status)}</span>` : ''}${unread ? '<i class="d-dot"></i>' : ''}` : ''}</button>`;
    return `<div class="d-group${folded ? ' folded' : ''}" style="--c:${color}" data-group="${g.key}">${chip}${folded ? '' : `<div class="d-tabs">${g.tabs.map(id => tabHtml(id, g.key, compact)).join('')}</div>`}</div>`;
  }).join('');
}
function termHtml(id) {
  const c = chat(id); const steps = STEPS[c.agent]; const f = FILES[id];
  const lines = [`<span class="u">${c.agent === 'claude' ? '>' : '›'} </span>${esc(PROMPTS[id])}`, ''];
  for (let i = 0; i < c.steps; i++) {
    const [cls, label] = steps[i];
    lines.push(`<span class="${cls}">${label}</span> ${i === 0 ? f : i === 1 ? f + ' <span class="ok">(+' + (12 + f.length) + ' -3)</span>' : 'the tests <span class="dim">· 18 passing</span>'}`);
  }
  lines.push('');
  if (c.status === 'working') lines.push(c.agent === 'claude' ? '<span class="acc">✻ Working…</span> <span class="dim">(esc to interrupt)</span>' : '<span class="dim">◦</span> Working <span class="dim">(esc to interrupt)</span>');
  if (c.status === 'background') lines.push('<span class="dim">⧗ Waiting on a background job. The agent continues when it reports back.</span>');
  if (c.status === 'idle') lines.push(`Done. The change is in ${f}, and the tests pass.\n<button data-reply="${id}">Send a follow-up</button>`);
  if (c.status === 'attention') lines.push(`<span class="ask"><span class="warn">Do you want to make this edit to ${f}?</span>\n<button data-reply="${id}">1. Yes</button><button data-reply="${id}">2. Yes, allow all edits</button></span>`);
  return lines.join('\n');
}
function paneHtml(id) {
  const c = chat(id); const p = project(c.project); const color = groupColor(groupOf(id));
  return `<div class="d-pane${id === S.focused ? ' focused' : ''}" style="--c:${color}" data-pane="${id}"><div class="d-pane-head">${AGENT[c.agent]}<b>${esc(c.name)}</b>${icon(c.status)}<span class="d-where">${p.host || 'This Mac'} · ${esc(p.name)}</span></div><div class="d-term">${termHtml(id)}</div></div>`;
}
function overviewHtml() {
  const gs = groups();
  if (!gs.length) return '<div class="d-empty">No open tabs. Open a chat from the sidebar.</div>';
  const all = gs.flatMap(g => g.tabs); const need = all.filter(id => chat(id).status === 'attention').length; const unread = all.filter(id => chat(id).unread).length;
  return `<div class="d-overview"><h4>Open chats</h4><p>${all.length} chats in ${gs.length} groups${need ? ` · <span style="color:var(--amber)">${need} needs input</span>` : ''}${unread ? ` · <span style="color:var(--blue)">${unread} unread</span>` : ''}. Open a chat, or a group to bring back its tabs.</p><div class="d-cards">${gs.map(g => `<div class="d-card" style="--c:${groupColor(g.key)}"><button class="d-card-title" data-unfold="${g.key}">${esc(groupName(g.key))}</button>${g.tabs.map(id => rowHtml(id, groupColor(g.key))).join('')}</div>`).join('')}</div></div>`;
}
function rowHtml(id, color) {
  const c = chat(id); const cls = ['d-chat'];
  if (S.open.includes(id)) cls.push('open'); if (id === S.focused) cls.push('active'); if (c.unread) cls.push('unread');
  return `<div class="${cls.join(' ')}" style="--c:${color}" data-row="${id}" draggable="true" title="${LABEL[c.status]}">${AGENT[c.agent]}<span class="d-name">${esc(c.name)}</span>${c.unread ? '<i class="d-dot"></i>' : ''}${icon(c.status)}</div>`;
}
function sidebarHtml() {
  return PROJECTS.map(p => {
    const ids = Object.keys(S.chats).filter(id => chat(id).project === p.id);
    const folded = S.sideFolded?.has(p.id); const top = urgent(ids);
    return `<div class="d-project"><div class="d-phead${folded ? ' folded' : ''}" data-pfold="${p.id}"><span class="chev">▾</span><span class="d-folder" style="--c:${p.color}"></span>${esc(p.name)}${p.host ? `<span class="d-host">${p.host}</span>` : ''}${folded ? `<span class="d-rollup">${ids.length}${icon(chat(top).status)}</span>` : ''}</div>${folded ? '' : `<div class="d-chats">${ids.map(id => rowHtml(id, p.color)).join('')}</div>`}</div>`;
  }).join('');
}
function render() {
  const unread = Object.values(S.chats).filter(c => c.unread).length;
  const selected = S.selected.size;
  root.style.maxWidth = S.width + '%';
  root.innerHTML = `
    <div class="d-toolbar">
      <label class="${S.focus ? 'on' : ''}"><input type="checkbox" data-act="focus" ${S.focus ? 'checked' : ''}> Focus mode</label>
      <button data-act="split" aria-pressed="${!!(S.split && S.panes.length > 1)}" ${S.focused ? '' : 'disabled'}>Split view</button>
      <button data-act="group" ${selected > 1 ? '' : 'disabled'} title="⌘- or Shift-click tabs first">Group selected${selected > 1 ? ` (${selected})` : ''}</button>
      <button data-act="collapse">Fold all</button>
      <button data-act="next">Next needs input <kbd>⌘J</kbd></button>
      <span class="d-spacer"></span>
      <label class="d-width">Window <input type="range" min="60" max="100" value="${S.width}" data-act="width" aria-label="Window width"></label>
      <span class="d-unread">${unread ? `<b>${unread}</b> unread` : 'All read'}</span>
      <button data-act="reset">Reset</button>
    </div>
    <div class="d-body">
      <aside class="d-sidebar" aria-label="Projects">${sidebarHtml()}</aside>
      <div class="d-main">
        <div class="d-strip" role="tablist"></div>
        ${S.panes.length ? `<div class="d-panes${S.panes.length > 1 ? ' split' : ''}">${S.panes.map(paneHtml).join('')}<div class="d-drop"><div class="d-zone" data-zone="left">Split left</div><div class="d-zone" data-zone="right">Split right</div></div></div>` : overviewHtml()}
      </div>
    </div>`;
  paintStrip(); revealActive();
}

// Tabs shrink before the strip scrolls: when they overflow, inactive tabs turn into icons.
function paintStrip() {
  const strip = root.querySelector('.d-strip');
  // Measure with every tab at its minimum width; only if that overflows do inactive tabs become icons.
  strip.innerHTML = stripHtml(false); strip.style.removeProperty('--tab-w');
  const tabs = strip.querySelectorAll('.d-tab').length; const last = strip.lastElementChild;
  // scrollWidth never reports less than the box, so measure where the content actually ends.
  const used = last ? last.getBoundingClientRect().right - strip.getBoundingClientRect().left + strip.scrollLeft + 12 : 0;
  const spare = strip.clientWidth - used;
  if (spare < 0) { strip.innerHTML = stripHtml(true); return; }
  // Everything fits at the minimum: share the spare room out, up to the full tab width.
  strip.style.setProperty('--tab-w', Math.min(190, 104 + spare / Math.max(tabs, 1)) + 'px');
}
function revealActive() {
  const strip = root.querySelector('.d-strip'); const tab = strip.querySelector('.d-tab.active'); if (!tab) return;
  const s = strip.getBoundingClientRect(), t = tab.getBoundingClientRect();
  if (t.right > s.right) strip.scrollLeft += t.right - s.right + 8; else if (t.left < s.left) strip.scrollLeft -= s.left - t.left + 8;
}

// ---- Events ----
root.addEventListener('click', e => {
  const t = e.target;
  const reply = t.closest('[data-reply]'); if (reply) { respond(reply.dataset.reply); return render(); }
  const closeBtn = t.closest('[data-close]'); if (closeBtn) { e.stopPropagation(); close(closeBtn.dataset.close); return render(); }
  const openIcon = t.closest('[data-open]'); if (openIcon) { show(openIcon.dataset.open); return render(); }
  const chip = t.closest('[data-chip]'); if (chip) { fold(chip.dataset.chip); return render(); }
  const tab = t.closest('[data-tab]');
  if (tab) {
    const id = tab.dataset.tab;
    if (e.metaKey || e.ctrlKey) { S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); if (S.focused) S.selected.add(S.focused); S.anchor = id; return render(); }
    if (e.shiftKey) { const from = S.open.indexOf(S.anchor || S.focused), to = S.open.indexOf(id); const [a, b] = [Math.min(from, to), Math.max(from, to)]; S.open.slice(a, b + 1).forEach(x => S.selected.add(x)); return render(); }
    show(id); return render();
  }
  const row = t.closest('[data-row]'); if (row) { show(row.dataset.row); return render(); }
  const unfold = t.closest('[data-unfold]'); if (unfold) { if (S.focus) fold(unfold.dataset.unfold); else { S.folded.delete(unfold.dataset.unfold); const target = S.mru.find(id => S.open.includes(id) && groupOf(id) === unfold.dataset.unfold); if (target) show(target); } return render(); }
  const pfold = t.closest('[data-pfold]'); if (pfold) { S.sideFolded ??= new Set(); const id = pfold.dataset.pfold; S.sideFolded.has(id) ? S.sideFolded.delete(id) : S.sideFolded.add(id); return render(); }
  const pane = t.closest('[data-pane]'); if (pane && pane.dataset.pane !== S.focused) { S.focused = pane.dataset.pane; touch(S.focused); return render(); }
  const act = t.closest('button[data-act]')?.dataset.act;
  if (act === 'split') {
    if (S.split && S.panes.length > 1) { S.split = null; S.panes = [S.focused]; }
    else { const g = S.open.filter(id => groupOf(id) === groupOf(S.focused)); const partner = g[g.indexOf(S.focused) + 1] || g[g.indexOf(S.focused) - 1] || S.mru.find(id => S.open.includes(id) && id !== S.focused); if (partner) splitWith(partner, 'right'); else say('Open another chat to split with.'); }
  }
  if (act === 'group') groupSelected();
  if (act === 'collapse') { for (const g of groups()) S.folded.add(g.key); S.focus = false; S.panes = []; S.focused = null; }
  if (act === 'next') nextNeedsInput();
  if (act === 'reset') reset();
  if (act) render();
});
root.addEventListener('change', e => {
  if (e.target.dataset.act === 'focus') { S.focus = e.target.checked; if (S.focus && !S.focused) { const id = S.mru.find(id => S.open.includes(id)); if (id) show(id); } if (!S.focus) S.folded.clear(); render(); }
});
root.addEventListener('input', e => { if (e.target.dataset.act === 'width') { S.width = +e.target.value; root.style.maxWidth = S.width + '%'; paintStrip(); revealActive(); setTimeout(() => { paintStrip(); revealActive(); }, 220); } });

// Drag: reorder within the strip, or drop on a pane edge to split (tabs and sidebar rows both work).
let dragId = null;
root.addEventListener('dragstart', e => {
  const el = e.target.closest?.('[data-tab],[data-row]'); if (!el) return;
  dragId = el.dataset.tab || el.dataset.row; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  requestAnimationFrame(() => { el.classList.add('dragging'); if (S.panes.length) root.classList.add('dragging-tab'); });
});
root.addEventListener('dragend', () => { dragId = null; root.classList.remove('dragging-tab'); root.querySelectorAll('.dragging,.drop-before,.over').forEach(el => el.classList.remove('dragging', 'drop-before', 'over')); });
root.addEventListener('dragover', e => {
  if (!dragId) return;
  const zone = e.target.closest('[data-zone]'); const tab = e.target.closest('[data-tab]');
  root.querySelectorAll('.drop-before,.over').forEach(el => el.classList.remove('drop-before', 'over'));
  if (zone) { e.preventDefault(); zone.classList.add('over'); }
  else if (tab && tab.dataset.tab !== dragId && S.open.includes(dragId)) { e.preventDefault(); tab.classList.add('drop-before'); }
});
root.addEventListener('drop', e => {
  if (!dragId) return; e.preventDefault();
  const zone = e.target.closest('[data-zone]'); const tab = e.target.closest('[data-tab]');
  const id = dragId; dragId = null; root.classList.remove('dragging-tab');
  if (zone) { if (S.panes.length === 1 && S.panes[0] === id) say('Drag a different tab onto this chat to split.'); else { if (S.panes.length > 1) { S.split = null; S.panes = [S.focused]; } splitWith(id, zone.dataset.zone); } }
  else if (tab && tab.dataset.tab !== id) { S.open = S.open.filter(x => x !== id); S.open.splice(S.open.indexOf(tab.dataset.tab), 0, id); if (S.split?.includes(id)) S.split = null; }
  render();
});

// Simulated agents: while the demo is on screen, working chats finish turns or ask for input.
let onScreen = false;
new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }, { threshold: 0.3 }).observe(root);
setInterval(() => {
  if (!onScreen || document.hidden || root.querySelector('.dragging')) return;
  const working = Object.values(S.chats).filter(c => c.status === 'working' || (c.status === 'background' && Math.random() < 0.3));
  if (!working.length) return;
  const c = working[Math.floor(Math.random() * working.length)];
  c.status = Math.random() < 0.35 && c.agent === 'claude' || Math.random() < 0.2 ? 'attention' : 'idle';
  c.steps = 3; if (!visible(c.id)) c.unread = true;
  render();
}, reduced ? 14000 : 8000);
addEventListener('resize', paintStrip);
render();
})();
