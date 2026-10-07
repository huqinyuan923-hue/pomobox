'use strict';

/* ================= 主题 ================= */
const THEME_KEY = 'pomobox-theme';
const themeBtn = document.getElementById('themeToggle');
let faviconTint = '#ffffff'; // 动态 favicon 文字颜色，随主题翻转
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  faviconTint = t === 'dark' ? '#201a18' : '#ffffff';
}
applyTheme(localStorage.getItem(THEME_KEY) ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

/* ================= 存档 ================= */
const STORE_KEY = 'pomobox-v1';
const DEFAULTS = {
  settings: { focus: 25, short: 5, long: 15, longEvery: 4, autoNext: false, sound: true, notify: false },
  tasks: [],
  activeTaskId: null,
  stats: {},   // 'YYYY-MM-DD': { count, minutes }
  cycle: 0,
};
let data;
try {
  data = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
} catch { data = {}; }
data.settings = { ...DEFAULTS.settings, ...(data.settings || {}) };
data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
data.stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
data.cycle = Number(data.cycle) || 0;
data.activeTaskId = data.activeTaskId ?? null;

const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(data));

/* ================= 计时状态 ================= */
const PHASE_META = {
  focus: { label: '专注中', color: '#e5533d' },
  short: { label: '短休息', color: '#0d9488' },
  long: { label: '长休息', color: '#2563eb' },
};
const RING_CIRC = 2 * Math.PI * 116;

let phase = 'focus';
let running = false;
let endAt = 0;
let remainMs = data.settings.focus * 60000;

const $ = id => document.getElementById(id);
const durationOf = p => (data.settings[p === 'focus' ? 'focus' : p === 'short' ? 'short' : 'long']) * 60000;

/* ================= 渲染 ================= */
const ringBar = $('ringBar'), ringWrap = document.querySelector('.ring-wrap');

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

let lastClock = '';
function render() {
  const total = durationOf(phase);
  const remain = running ? Math.max(0, endAt - Date.now()) : remainMs;

  $('timeText').textContent = fmt(remain);
  ringBar.style.strokeDashoffset = String(RING_CIRC * (1 - remain / total));
  ringWrap.classList.toggle('break', phase !== 'focus');
  ringBar.style.stroke = PHASE_META[phase].color;
  $('phaseLabel').textContent = running ? PHASE_META[phase].label + '…' : PHASE_META[phase].label;
  $('startBtn').textContent = running ? '暂停' : (remain < total ? '继续' : '开始');
  $('cycleHint').textContent = `已完成 ${data.cycle % data.settings.longEvery} / ${data.settings.longEvery} 个番茄，之后进入长休息`;

  const clock = fmt(remain);
  if (clock !== lastClock) {
    lastClock = clock;
    document.title = `${clock} · ${PHASE_META[phase].label} — PomoBox`;
    drawFavicon(clock, PHASE_META[phase].color);
  }
}

/* 标签页图标显示剩余分钟 */
function drawFavicon(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  roundRect(ctx, 0, 0, 64, 64, 14);
  ctx.fill();
  ctx.fillStyle = faviconTint;
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text === '00:00' ? '00' : text.slice(0, 2), 32, 34);
  let link = document.querySelector('link[rel="icon"][data-dyn]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.dataset.dyn = '1';
    document.head.appendChild(link);
  }
  link.href = c.toDataURL('image/png');
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ================= 提示音 / 通知 ================= */
let audioCtx = null;
function chime(kind) {
  if (!data.settings.sound) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const notes = kind === 'focus'
      ? [[523.25, 0], [659.25, 0.18], [783.99, 0.36]]
      : [[659.25, 0], [523.25, 0.22]];
    for (const [freq, dt] of notes) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.2, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.55);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.6);
    }
  } catch { /* 无声环境忽略 */ }
}

function notify(title, body) {
  if (!data.settings.notify || Notification.permission !== 'granted') return;
  try { new Notification(title, { body }); } catch { /* 忽略 */ }
}

/* ================= 阶段流转 ================= */
function setPhase(p, { autoStart = false } = {}) {
  phase = p;
  running = false;
  remainMs = durationOf(p);
  document.querySelectorAll('.phase-btn').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.phase === p)));
  render();
  if (autoStart) start();
}

function start() {
  if (running) return;
  if (remainMs <= 0) remainMs = durationOf(phase);
  audioCtx?.resume?.();
  endAt = Date.now() + remainMs;
  running = true;
  render();
}

function pause() {
  if (!running) return;
  remainMs = Math.max(0, endAt - Date.now());
  running = false;
  render();
}

function reset() {
  running = false;
  remainMs = durationOf(phase);
  render();
}

const todayKey = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function completePhase({ record = true } = {}) {
  const wasFocus = phase === 'focus';
  running = false;

  if (wasFocus) {
    if (record) {
      data.cycle++;
      const k = todayKey();
      data.stats[k] = data.stats[k] || { count: 0, minutes: 0 };
      data.stats[k].count++;
      data.stats[k].minutes += data.settings.focus;
      const t = data.tasks.find(t => t.id === data.activeTaskId && !t.done);
      if (t) t.pomos = (t.pomos || 0) + 1;
      save();
      renderTasks();
      renderStats();
    }
    chime('focus');
    notify('专注完成！🍅', '休息一下，再战一轮');
    const next = data.cycle > 0 && data.cycle % data.settings.longEvery === 0 ? 'long' : 'short';
    setPhase(next, { autoStart: data.settings.autoNext });
  } else {
    chime('break');
    notify('休息结束', '准备好开始新的专注了吗？');
    setPhase('focus', { autoStart: data.settings.autoNext });
  }
}

/* ================= 事件 ================= */
$('startBtn').addEventListener('click', () => (running ? pause() : start()));
$('resetBtn').addEventListener('click', reset);
$('skipBtn').addEventListener('click', () => completePhase({ record: false }));
document.querySelectorAll('.phase-btn').forEach(b =>
  b.addEventListener('click', () => setPhase(b.dataset.phase)));

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); running ? pause() : start(); }
  else if (e.key === 'r' || e.key === 'R') reset();
});

setInterval(() => {
  if (!running) return;
  if (Date.now() >= endAt) { completePhase(); return; }
  render();
}, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden && running) render(); });

/* ================= 任务 ================= */
function renderTasks() {
  const list = $('taskList');
  list.innerHTML = '';
  $('taskEmpty').style.display = data.tasks.length ? 'none' : '';
  for (const t of data.tasks) {
    const li = document.createElement('li');
    li.className = 'task-item' + (t.done ? ' done' : '') + (t.id === data.activeTaskId ? ' active' : '');
    li.innerHTML = `
      <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="完成任务">
      <span class="task-title"></span>
      ${t.pomos ? `<span class="pomos">🍅×${t.pomos}</span>` : ''}
      <button class="pick-btn ${t.id === data.activeTaskId ? 'on' : ''}" ${t.done ? 'disabled' : ''}>
        ${t.id === data.activeTaskId ? '当前' : '选中'}
      </button>
      <button class="del-btn" title="删除任务" aria-label="删除任务">✕</button>`;
    li.querySelector('.task-title').textContent = t.title;
    li.querySelector('input').addEventListener('change', e => { t.done = e.target.checked; save(); renderTasks(); });
    li.querySelector('.pick-btn').addEventListener('click', () => {
      data.activeTaskId = data.activeTaskId === t.id ? null : t.id;
      save(); renderTasks();
    });
    li.querySelector('.del-btn').addEventListener('click', () => {
      data.tasks = data.tasks.filter(x => x.id !== t.id);
      if (data.activeTaskId === t.id) data.activeTaskId = null;
      save(); renderTasks();
    });
    list.appendChild(li);
  }
}

$('taskForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('taskInput').value.trim();
  if (!title) return;
  data.tasks.unshift({ id: Date.now().toString(36), title, done: false, pomos: 0 });
  $('taskInput').value = '';
  save(); renderTasks();
});

$('taskClearDone').addEventListener('click', () => {
  data.tasks = data.tasks.filter(t => !t.done);
  save(); renderTasks();
});

/* ================= 统计 ================= */
function renderStats() {
  const k = todayKey();
  const today = data.stats[k] || { count: 0, minutes: 0 };
  $('statToday').textContent = today.count;
  $('statMinutes').textContent = today.minutes;
  $('statTotal').textContent = Object.values(data.stats).reduce((s, v) => s + (v.count || 0), 0);

  const chart = $('weekChart');
  chart.innerHTML = '';
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const p = n => String(n).padStart(2, '0');
    const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    days.push({ key, label: '周' + '日一二三四五六'[d.getDay()], count: data.stats[key]?.count || 0, today: i === 0 });
  }
  const max = Math.max(1, ...days.map(d => d.count));
  for (const d of days) {
    const col = document.createElement('div');
    col.className = 'bar-col' + (d.today ? ' today' : '');
    col.innerHTML = `<span class="bar-num">${d.count || ''}</span><div class="bar" style="height:${Math.max(4, (d.count / max) * 100)}%"></div><span class="bar-label">${d.today ? '今天' : d.label}</span>`;
    chart.appendChild(col);
  }
}

/* ================= 设置 ================= */
function bindSetting(id, key, { min, max } = {}) {
  const el = $(id);
  el.value = data.settings[key];
  el.addEventListener('change', () => {
    let v = Number(el.value);
    if (!Number.isFinite(v)) v = DEFAULTS.settings[key];
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    el.value = v;
    data.settings[key] = v;
    save();
    if (['focus', 'short', 'long'].includes(key) && !running) {
      remainMs = durationOf(phase);
    }
    render();
  });
}
bindSetting('setFocus', 'focus', { min: 1, max: 120 });
bindSetting('setShort', 'short', { min: 1, max: 30 });
bindSetting('setLong', 'long', { min: 1, max: 60 });
bindSetting('setLongEvery', 'longEvery', { min: 2, max: 8 });

function bindCheck(id, key, onChange) {
  const el = $(id);
  el.checked = data.settings[key];
  el.addEventListener('change', () => {
    data.settings[key] = el.checked;
    save();
    onChange?.(el.checked);
  });
}
bindCheck('setAuto', 'autoNext');
bindCheck('setSound', 'sound');
bindCheck('setNotify', 'notify', on => {
  if (on && Notification.permission === 'default') Notification.requestPermission();
});

/* ================= 启动 ================= */
renderTasks();
renderStats();
render();
