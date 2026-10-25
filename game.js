'use strict';

/* ---------------- constants ---------------- */
const COLS = 7, ROWS = 5;
const DIRS = [
  { x: 0, y: -1, name: '上' },
  { x: 1, y: 0, name: '右' },
  { x: 0, y: 1, name: '下' },
  { x: -1, y: 0, name: '左' }
];
/* 四种颜色的瓢虫 */
const BEETLE_COLORS = [
  { name: 'red',    body: '#ff7a63', mid: '#e23b2c', dark: '#8f1a12', spot: '#2a0f0c' },
  { name: 'yellow', body: '#ffc93c', mid: '#e09a12', dark: '#96650c', spot: '#3a2a08' },
  { name: 'blue',   body: '#63c8f5', mid: '#2b8ec6', dark: '#14567c', spot: '#0d2a3a' },
  { name: 'white',  body: '#fbfcfc', mid: '#b9c1c6', dark: '#79838a', spot: '#1b2226' }
];

const FROG_COLORS = [
  { name: 'green', body: '#4cc45a', dark: '#2f8f3d' },
  { name: 'gold', body: '#f0c04a', dark: '#b78a1c' },
  { name: 'blue', body: '#4fb8e8', dark: '#2279ad' },
  { name: 'pink', body: '#f07aa8', dark: '#b8467a' }
];
const BLOCKS = {
  move:  { label: '前进', icon: 'i-move' },
  jump:  { label: '跳跃', icon: 'i-jump' },
  left:  { label: '左转', icon: 'i-left' },
  right: { label: '右转', icon: 'i-right' },
  color: { label: '换色', icon: 'i-color' },
  sing:  { label: '唱歌', icon: 'i-sing' },
  if:    { label: '如果', icon: 'i-if' },
  repeat:{ label: '重复', icon: 'i-repeat' }
};

/* if 卡片可以用的条件 —— 全是图形，小朋友不用认字 */
const CONDITIONS = {
  bug:  { label: '前面有虫',   icon: 'i-cond-bug' },
  free: { label: '前面没虫',   icon: 'i-cond-free' },
  gap:  { label: '前面是缺口', icon: 'i-cond-gap' },
  edge: { label: '前面到边了', icon: 'i-cond-edge' }
};

/* 重复卡片的次数 */
const REPEAT_NUMS = [1, 2, 3, 4, 5];

/* ---------------- state ---------------- */
const state = {
  frog: { x: 1, y: 3, dir: 0, color: 0 },
  beetles: [],          // {x,y,alive,home,flying,vx,vy,height}
  holes: [],            // {x,y} 没有睡莲的水面缺口
  program: [],          // 程序 = 一棵卡片树（普通卡片是叶子，如果/重复是容器）
  focus: null,          // 当前正在往哪个插槽里放卡片
  undoStack: [],        // 撤销用
  runStack: [],         // 执行时的栈
  running: false,
  level: 0,
  sound: true,
  history: []
};

/* 每关开局有 4 只瓢虫，四种颜色各一只。
   start = 青蛙的起始位置和朝向；par = 「完美」用的卡片数上限；
   visitors = 会不会有访客瓢虫飞进来（用到 if 卡判断的关卡要关掉，
   否则关卡就不确定了）。 */
const LEVELS = [
  {
    name: '第一课：四只瓢虫',
    start: [1, 3, 0],
    beetles: [[1, 1], [3, 1], [3, 3], [5, 3]],
    holes: [],
    par: 11,
    hint: '把青蛙送到每只瓢虫那里去。\n点下面的积木排好队，再按 ▶ 跑起来。'
  },
  {
    name: '第二课：跳过水面的缺口',
    start: [1, 3, 0],
    beetles: [[1, 1], [3, 1], [5, 1], [3, 3]],
    holes: [[2, 1]],
    par: 12,
    hint: '有水坑的地方走不过去，\n要用跳跃的那张卡片跨过去。'
  },
  {
    name: '第三课：更远的旅程',
    start: [1, 3, 0],
    beetles: [[1, 1], [3, 1], [3, 3], [5, 3]],
    holes: [[2, 1], [4, 2]],
    par: 10,
    hint: '路有点绕，\n想想怎么让青蛙少走冤枉路。'
  },
  {
    // 一条直线上的四只虫 —— 用「重复 N 次 前进」一张卡就能搞定
    name: '第四课：重复（走一段）',
    start: [1, 3, 1],
    beetles: [[2, 3], [3, 3], [4, 3], [5, 3]],
    holes: [],
    par: 2,
    visitors: false,
    hint: '这一次青蛙要连着走好几步。\n试试「重复」卡片，让它自己走。'
  },
  {
    // L 形的四只虫 —— 需要「重复 { 如果 前面有虫 就走 否则 右转 }」
    name: '第五课：如果（看情况）',
    start: [1, 3, 0],
    beetles: [[1, 2], [1, 1], [1, 0], [2, 0]],
    holes: [],
    par: 4,
    visitors: false,
    hint: '这次要让青蛙自己想一想：\n前面有虫就走，没虫就转个弯。\n把「如果」塞进「重复」里面试试。'
  }
];

/* ---------------- population ---------------- */
/* 池塘里的瓢虫：开局每种颜色各一只，之后每 5 秒飞入一只随机颜色的，
   池塘上最多同时有 6 只。已经满 6 只时，新的一只飞进来的同时，
   池塘里随机选一只起飞，飞出池塘。 */

const POP = {
  max: 6,              // 池塘里最多同时有几只
  spawnEvery: 5000,    // 每隔几毫秒飞入一只
  nextSpawnAt: 0,
  maxFlying: 1,        // 同一时刻只允许一只虫在空中
  visitors: true,      // 这一关允不允许访客瓢虫飞进来
};

/* 找出当前在飞的虫（最多一只） */
function flyingBeetle() {
  return state.beetles.find(b => b.alive && b.flying && !b.leaving && !b.arriving) || null;
}

function airborneBeetle() {
  return state.beetles.find(b => b.alive && b.flying) || null;
}

/* ---------------- dom ---------------- */
const $ = s => document.querySelector(s);
const canvas = $('#pond');
const ctx = canvas.getContext('2d');
const programEl = $('#program');
const toastEl = $('#toast');

/* ---------------- canvas sizing ---------------- */
let W = 0, H = 0, dpr = 1, cell = 0, ox = 0, oy = 0;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  W = rect.width; H = rect.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const padX = 18, padY = 18;
  cell = Math.min((W - padX * 2) / COLS, (H - padY * 2) / ROWS);
  ox = (W - cell * COLS) / 2;
  oy = (H - cell * ROWS) / 2;
  draw();
}

/* ---------------- audio (simple blips) ---------------- */
let actx = null;
function blip(freq, dur, type = 'sine', gain = 0.06) {
  if (!state.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { /* ignore */ }
}
function sfxHop() { blip(320, .12, 'triangle', .05); setTimeout(() => blip(480, .1, 'triangle', .04), 70); }
function sfxEat() { blip(880, .08, 'square', .05); setTimeout(() => blip(1180, .12, 'square', .05), 80); }
function sfxTurn() { blip(220, .08, 'sine', .04); }
function sfxSing() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, .18, 'sine', .05), i * 110)); }
function sfxError() { blip(140, .25, 'sawtooth', .05); }
function sfxFly() { blip(900, .07, 'sine', .025); setTimeout(() => blip(1250, .07, 'sine', .022), 60); }
function sfxLand() { blip(420, .09, 'sine', .03); }

/* ---------------- level setup ---------------- */
function loadLevel(i) {
  state.level = i;
  const L = LEVELS[i];
  const t0 = Date.now();
  state.beetles = L.beetles.map(([x, y], i) => {
    const b = { x, y, alive: true, home: { x, y }, color: i % BEETLE_COLORS.length, target: true };
    beetleInit(b, t0);
    return b;
  });
  state.holes = (L.holes || []).map(([x, y]) => ({ x, y }));
  POP.nextSpawnAt = 0;
  POP.visitors = L.visitors !== false;
  const st = L.start || [1, 3, 0];
  state.frog = { x: st[0], y: st[1], dir: st[2], color: 0 };
  state.program = [];
  state.focus = null;
  state.undoStack = [];
  state.running = false;
  state.history = [];
  ops = []; opPc = 0; loopStack = [];
  renderProgram();
  updateStats();
  $('#ovTitle').textContent = L.name;
  $('#ovBody').textContent = L.hint ||
    '目标：让青蛙用最少的指令吃掉四只瓢虫（每种颜色各一只）。\n先用积木排出程序，再点「运行」。';
  setOverlayIcon('i-frog');
  if (location.hash === '#skip') { hideOverlay(); } else { showOverlay('开始', () => hideOverlay()); }
  draw();
}

/* ---------------- program: a tree of plug-in cards ----------------
   普通卡片（前进/跳跃/左右转/换色/唱歌）是一张叶子卡片。
   「如果」和「重复」是「插槽卡」：卡头下面有一个凹槽，
   里面可以再塞一叠卡片，并且可以继续嵌套 如果 / 重复。
   「如果」卡还有一个可选的「否则」凹槽。 */

let cardSeq = 1;
function newCard(key, extra) {
  const c = Object.assign({ key, id: cardSeq++ }, extra || {});
  if (c.key === 'if' || c.key === 'repeat') c.children = [];
  if (c.key === 'if') c.elseChildren = [];
  return c;
}

function isSlot(card) {
  return card.key === 'if' || card.key === 'repeat';
}

/* 「如果」卡：then 分支 / else 分支 */
function branchList(card, branch) {
  if (card.key === 'if' && branch === 'else') return card.elseChildren;
  return card.children;
}

/* 找到某张卡片在哪：返回 {list, index, parent, branch} */
function findCard(id, list, parent, branch) {
  list = list || state.program;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return { list, index: i, parent: parent || null, branch: branch || 'then' };
    if (isSlot(list[i])) {
      const r = findCard(id, list[i].children, list[i], 'then');
      if (r) return r;
      if (list[i].key === 'if') {
        const e = findCard(id, list[i].elseChildren, list[i], 'else');
        if (e) return e;
      }
    }
  }
  return null;
}

/* 往当前插槽里塞一张卡片 */
function addBlock(key, opts) {
  if (state.running) return;
  snapshot();
  if (key === 'if' && !opts) opts = { cond: 'bug' };
  if (key === 'repeat' && !opts) opts = { count: 2, mode: 'times' };
  const card = newCard(key, opts);
  const f = state.focus;
  if (f) {
    const list = branchList(f.parent, f.branch);
    list.splice(f.index, 0, card);
    if (isSlot(card)) state.focus = { parent: card, branch: 'then', index: 0 };
    else state.focus = { parent: f.parent, branch: f.branch, index: f.index + 1 };
  } else {
    state.program.push(card);
    if (isSlot(card)) state.focus = { parent: card, branch: 'then', index: 0 };
  }
  renderProgram();
  blip(600, .06, 'sine', .03);
}

function removeCard(id) {
  if (state.running) return;
  const loc = findCard(id);
  if (!loc) return;
  loc.list.splice(loc.index, 1);
  if (state.focus && !findCard(state.focus.parent.id)) state.focus = null;
  renderProgram();
}

/* 撤销 */
function snapshot() {
  state.undoStack.push(JSON.stringify(state.program));
  if (state.undoStack.length > 80) state.undoStack.shift();
}
function undoBlock() {
  if (state.running) return;
  const s = state.undoStack.pop();
  if (!s) { toast('没有可以撤销的了'); return; }
  state.program = JSON.parse(s);
  state.focus = null;
  renderProgram();
}
function clearProgram() {
  if (state.running) return;
  state.program = [];
  state.focus = null;
  state.undoStack = [];
  renderProgram();
}

/* 一共有多少张卡片（含嵌套里面的） */
function countCards(list) {
  list = list || state.program;
  let n = 0;
  list.forEach(b => {
    n++;
    if (isSlot(b)) {
      n += countCards(b.children);
      if (b.key === 'if') n += countCards(b.elseChildren);
    }
  });
  return n;
}

/* ---------------- rendering ---------------- */
function renderProgram() {
  programEl.innerHTML = '';
  if (!state.program.length) {
    programEl.innerHTML = '<div id="progEmpty">' +
      '<svg class="ic sm"><use href="#i-tap"/></svg><span>点下面的积木排成一排</span>' +
      '<svg class="ic sm"><use href="#i-run"/></svg><span>再按这个跑</span></div>';
  } else {
    const strip = document.createElement('div');
    strip.className = 'strip';
    state.program.forEach(b => strip.appendChild(renderCard(b, 0)));
    programEl.appendChild(strip);
  }
  const n = countCards();
  $('#progCount').textContent = n + ' 张卡片';
  $('#statMoves').textContent = n;
  renderPicker();
}

function renderCard(card, depth) {
  if (isSlot(card)) return renderSlotCard(card, depth);

  const el = document.createElement('div');
  el.className = 'blk';
  el.dataset.k = card.key;
  el.dataset.id = card.id;
  el.innerHTML =
    '<svg class="ic"><use href="#' + BLOCKS[card.key].icon + '"/></svg>' +
    '<span class="lbl">' + BLOCKS[card.key].label + '</span>' +
    '<span class="del">×</span>';
  el.addEventListener('click', ev => {
    if (state.running) return;
    if (ev.target.classList.contains('del')) { snapshot(); removeCard(card.id); return; }
    const loc = findCard(card.id);
    if (loc) {
      state.focus = loc.parent
        ? { parent: loc.parent, branch: loc.branch, index: loc.index }
        : null;
    }
    renderProgram();
  });
  return el;
}

function renderSlotCard(card, depth) {
  const wrap = document.createElement('div');
  wrap.className = 'slot';
  wrap.dataset.k = card.key;
  wrap.dataset.id = card.id;

  const head = document.createElement('div');
  head.className = 'slotHead';

  if (card.key === 'if') {
    const c = CONDITIONS[card.cond] || CONDITIONS.bug;
    head.innerHTML =
      '<svg class="ic"><use href="#i-if"/></svg>' +
      '<span class="cond">' +
      '<svg class="ic sm"><use href="#' + c.icon + '"/></svg>' +
      '<span class="lbl">' + c.label + '</span><span class="swap">⇄</span></span>' +
      '<span class="elseTgl" title="否则">否则</span>' +
      '<span class="del">×</span>';
    head.querySelector('.cond').addEventListener('click', ev => {
      if (state.running) return;
      ev.stopPropagation();
      snapshot();
      openPicker('cond', card);
    });
    head.querySelector('.elseTgl').addEventListener('click', ev => {
      if (state.running) return;
      ev.stopPropagation();
      snapshot();
      card.hasElse = !card.hasElse;
      if (card.hasElse && !card.elseChildren) card.elseChildren = [];
      renderProgram();
    });
  } else {
    const label = card.mode === 'until'
      ? '直到' + ((CONDITIONS[card.untilCond] || CONDITIONS.edge).label)
      : (card.count || 1) + ' 次';
    head.innerHTML =
      '<svg class="ic"><use href="#i-repeat"/></svg>' +
      '<span class="num"><span class="ntxt">' + label + '</span><span class="swap">⇄</span></span>' +
      '<span class="del">×</span>';
    head.querySelector('.num').addEventListener('click', ev => {
      if (state.running) return;
      ev.stopPropagation();
      snapshot();
      openPicker('num', card);
    });
  }

  head.querySelector('.del').addEventListener('click', ev => {
    if (state.running) return;
    ev.stopPropagation();
    snapshot(); removeCard(card.id);
  });

  // then 凹槽
  wrap.appendChild(head);
  wrap.appendChild(renderSocket(card, 'then', depth));

  // else 凹槽
  if (card.key === 'if' && card.hasElse) {
    const tag = document.createElement('div');
    tag.className = 'elseTag';
    tag.textContent = '否则';
    wrap.appendChild(tag);
    wrap.appendChild(renderSocket(card, 'else', depth));
  }
  return wrap;
}

function renderSocket(card, branch, depth) {
  const body = document.createElement('div');
  body.className = 'slotBody' + (branch === 'else' ? ' elseBody' : '');
  const inner = document.createElement('div');
  inner.className = 'strip';
  const kids = branchList(card, branch) || [];
  if (kids.length) {
    kids.forEach(b => inner.appendChild(renderCard(b, depth + 1)));
  } else {
    const hint = document.createElement('div');
    hint.className = 'slotHint';
    hint.innerHTML = '<svg class="ic sm"><use href="#i-plug"/></svg><span>塞卡片进来</span>';
    body.appendChild(hint);
  }
  body.appendChild(inner);
  body.addEventListener('click', ev => {
    if (state.running) return;
    if (ev.target.closest('.blk') || ev.target.closest('.slot')) return;
    state.focus = { parent: card, branch, index: (branchList(card, branch) || []).length };
    renderProgram();
  });
  return body;
}

/* ---------------- picker: 选条件 / 选次数 ---------------- */
let pickerState = null;   // {mode:'cond'|'num', card}

function openPicker(mode, card) {
  pickerState = { mode, card };
  renderPicker();
}
function closePicker() { pickerState = null; renderPicker(); }

function renderPicker() {
  const el = document.getElementById('picker');
  if (!el) return;
  if (!pickerState) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const title = document.getElementById('pickerTitle');
  const items = document.getElementById('pickerItems');
  items.innerHTML = '';

  if (pickerState.mode === 'cond') {
    title.textContent = '什么时候？';
    Object.keys(CONDITIONS).forEach(k => {
      const c = CONDITIONS[k];
      const b = document.createElement('button');
      b.className = 'pkItem';
      b.innerHTML = '<svg class="ic"><use href="#' + c.icon + '"/></svg><span>' + c.label + '</span>';
      b.addEventListener('click', () => {
        pickerState.card.cond = k;
        closePicker();
      });
      items.appendChild(b);
    });
  } else {
    title.textContent = '重复几次？';
    REPEAT_NUMS.forEach(n => {
      const b = document.createElement('button');
      b.className = 'pkItem pkNum';
      b.innerHTML = '<span>' + n + '</span>';
      b.addEventListener('click', () => {
        pickerState.card.mode = 'times';
        pickerState.card.count = n;
        closePicker();
      });
      items.appendChild(b);
    });
    const sep = document.createElement('div');
    sep.className = 'pkSep';
    sep.textContent = '或者一直做，直到……';
    items.appendChild(sep);
    Object.keys(CONDITIONS).forEach(k => {
      const c = CONDITIONS[k];
      const b = document.createElement('button');
      b.className = 'pkItem';
      b.innerHTML = '<svg class="ic"><use href="#' + c.icon + '"/></svg><span>' + c.label + '</span>';
      b.addEventListener('click', () => {
        pickerState.card.mode = 'until';
        pickerState.card.untilCond = k;
        closePicker();
      });
      items.appendChild(b);
    });
  }
}

/* ---------------- compile the card tree into flat ops ---------------- */
function compileSeq(cards, ops) {
  cards.forEach(card => {
    if (card.key === 'if') {
      const testIdx = ops.length;
      ops.push({ t: 'test', cond: card.cond, elseTarget: 0, cardId: card.id });
      compileSeq(card.children || [], ops);
      const jmpIdx = ops.length;
      ops.push({ t: 'jmp', target: 0, cardId: card.id });
      const elseStart = ops.length;
      compileSeq(card.elseChildren || [], ops);
      ops[testIdx].elseTarget = elseStart;   // 条件不成立 → 走 else
      ops[jmpIdx].target = ops.length;       // then 分支跑完 → 跳过 else
    } else if (card.key === 'repeat') {
      if (!(card.children || []).length) return;      // 空循环什么都不做
      if (card.mode === 'until') {
        // 「一直做，直到……」：先做一遍，再检查条件
        const frameIdx = ops.length;
        ops.push({ t: 'until', cond: card.untilCond || 'edge', endTarget: 0, bodyStart: 0, cardId: card.id });
        const start = ops.length;
        compileSeq(card.children, ops);
        ops.push({ t: 'untilend', cond: card.untilCond || 'edge', cardId: card.id });
        ops[frameIdx].bodyStart = start;      // 循环体第一条指令的位置
        ops[frameIdx].endTarget = ops.length; // 跳出循环后接着做的那一条
      } else {
        const loopIdx = ops.length;
        ops.push({ t: 'loop', count: Math.max(1, card.count || 1), bodyStart: 0, cardId: card.id });
        const start = ops.length;
        compileSeq(card.children, ops);
        ops.push({ t: 'loopend', cardId: card.id });
        ops[loopIdx].bodyStart = start;   // 循环体第一条指令的位置
      }
    } else {
      ops.push({ t: 'act', key: card.key, cardId: card.id });
    }
  });
}
function compileProgram() {
  const ops = [];
  compileSeq(state.program, ops);
  return ops;
}

/* 判断条件 */
function execCond(cond) {
  const f = state.frog;
  const d = DIRS[f.dir];
  const nx = f.x + d.x, ny = f.y + d.y;
  const inGrid = padAt(nx, ny);
  if (cond === 'edge') return !inGrid;
  if (cond === 'gap')  return inGrid && holeAt(nx, ny);
  const hasBug = inGrid && !holeAt(nx, ny) &&
    state.beetles.some(b => b.alive && b.gx === nx && b.gy === ny);
  if (cond === 'bug')  return hasBug;
  if (cond === 'free') return inGrid && !holeAt(nx, ny) && !hasBug;
  return false;
}

/* ---------------- movement ---------------- */
function padAt(x, y) { return x >= 0 && x < COLS && y >= 0 && y < ROWS; }
function holeAt(x, y) { return state.holes.some(h => h.x === x && h.y === y); }

/* 前方一格是否是水面缺口（有水但没有睡莲） */
function gapAhead(frog) {
  const d = DIRS[frog.dir];
  const nx = frog.x + d.x, ny = frog.y + d.y;
  if (!padAt(nx, ny)) return null;
  return holeAt(nx, ny) ? { x: nx, y: ny } : null;
}

function tryMove(frog, dx, dy) {
  const nx = frog.x + dx, ny = frog.y + dy;
  if (!padAt(nx, ny)) return { ok: false, reason: '池塘到边了' };
  if (holeAt(nx, ny)) return { ok: false, reason: '前面是水面缺口，试试跳跃' };
  return { ok: true, x: nx, y: ny };
}

let lastCatchWasFlying = false;
function eatBeetleAt(x, y) {
  // 飞走的虫会飞回自己的睡莲，青蛙站上那片荷叶照样能在空中逮住它
  const b = state.beetles.find(b => b.alive && b.gx === x && b.gy === y);
  if (b) {
    lastCatchWasFlying = b.flying;
    b.alive = false; sfxEat(); updateStats(); return true;
  }
  return false;
}

/* ---------------- flying beetles ---------------- */
/* 每只虫都有一片归属的睡莲。它会停栖、起飞、连续地飞一段弧线，
   再降落回睡莲。青蛙靠得太近时它会受惊急转方向躲开。
   归属睡莲固定，所以关卡的解法不会变，永远可解。

   飞行是「连续积分」出来的：每帧按速度推进位置，靠爬升/下降速率
   改变高度，所以看到的是一条平滑的弧线轨迹，而不是一顿一顿的跳动。 */

const FLY = {
  perchMin: 5000,        // 停栖多久后起飞（毫秒）
  perchMax: 11000,
  cruiseSpeed: 0.9,      // 巡航速度（格/秒）
  climbRate: 1.1,        // 爬升速度（格/秒）
  hoverHeight: 0.62,     // 盘旋高度（格）
  turnRate: 1.8,         // 转向速率（弧度/秒）
  flyMin: 3500,          // 飞多久后往回飞
  flyMax: 7000,
  startleDist: 1.7,      // 青蛙靠近到这个距离（格）会被吓到
  startleBoost: 2.2,     // 受惊时的加速倍数
  landRadius: 0.2        // 距离归属睡莲多近就算降落
};

function beetleInit(b, now) {
  const c = padCenter(b.home.x, b.home.y);
  b.x = c.x; b.y = c.y;              // 飞行时是像素坐标
  b.gx = b.home.x; b.gy = b.home.y;  // 逻辑格子坐标
  b.flying = false;
  b.color = b.color || 0;            // 0-3，对应 BEETLE_COLORS
  b.arrivedAt = now;                 // 进池时间（用来算「最早的那只」）
  b.leaving = false;                 // 正在飞走
  b.leaveAt = 0;
  b.vx = 0; b.vy = 0;                // 速度（格/秒）
  b.angle = -Math.PI / 2;            // 朝向（弧度）
  b.height = 0;                      // 离水面的高度（格）
  b.climb = 0;                       // 当前爬升率（格/秒）
  b.returning = false;               // 是否正飞回睡莲准备降落
  b.landAt = 0;                      // 什么时候开始往回飞
  b.tookOffAt = 0;
  b.wp = null;                       // 当前航点
  b.perchUntil = now + FLY.perchMin + Math.random() * (FLY.perchMax - FLY.perchMin);
  b.phase = Math.random() * 6.28;
}

/* 随机挑一个航点：池塘里某片睡莲的上空 */
function beetleNewWaypoint(b) {
  const m = cell * 0.8;
  b.wp = {
    x: m + Math.random() * Math.max(1, W - m * 2),
    y: m + Math.random() * Math.max(1, H - m * 2)
  };
}

function beetleTakeoff(b, now, startled) {
  // 飞行权是唯一的 —— 已经有别的虫在飞就不起飞
  if (airborneBeetle()) return;
  const c = padCenter(b.home.x, b.home.y);
  b.flying = true;
  b.startled = !!startled;
  b.startleAt = now;
  b.tookOffAt = now;
  b.x = c.x; b.y = c.y;
  b.gx = b.home.x; b.gy = b.home.y;
  b.height = 0; b.climb = FLY.climbRate;
  b.returning = false;
  b.landAt = now + FLY.flyMin + Math.random() * (FLY.flyMax - FLY.flyMin);
  // 随机起飞方向
  const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
  const spd = FLY.cruiseSpeed * (startled ? FLY.startleBoost : 1);
  b.vx = Math.cos(a) * spd;
  b.vy = Math.sin(a) * spd;
  b.angle = a;
  beetleNewWaypoint(b);
  sfxFly();
}

/* 积分一步：连续推进位置与高度 —— 这就是那条平滑的弧线轨迹 */
function beetleStep(b, dt, now) {
  const homeC = padCenter(b.home.x, b.home.y);
  const toHome = Math.hypot(b.x - homeC.x, b.y - homeC.y) / cell;

  /* ---- 正在飞出池塘：straight out, 不转向、不返航 ---- */
  if (b.leaving) {
    b.x += b.vx * cell * dt;
    b.y += b.vy * cell * dt;
    b.height += b.climb * dt;
    if (b.height > 1.4) b.climb = 0;          // 飞高一点就平飞出去
    return;
  }

  /* ---- 决定往哪儿飞 ---- */
  let goal;
  if (b.startled) {
    // 受惊：朝远离青蛙的方向冲
    const fc = padCenter(state.frog.x, state.frog.y);
    goal = Math.atan2(b.y - fc.y, b.x - fc.x);
    if (now - b.startleAt > 1500) b.startled = false;   // 躲一会儿就消气
  } else if (b.returning) {
    goal = Math.atan2(homeC.y - b.y, homeC.x - b.x);
  } else {
    // 巡航：朝当前航点飞，到了就换一个
    if (!b.wp) beetleNewWaypoint(b);
    if (Math.hypot(b.wp.x - b.x, b.wp.y - b.y) < cell * 0.25) beetleNewWaypoint(b);
    goal = Math.atan2(b.wp.y - b.y, b.wp.x - b.x);
  }

  // 转向：连续地转过去
  let diff = goal - b.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = FLY.turnRate * (b.startled ? 2.2 : 1) * dt;
  b.angle += Math.max(-turn, Math.min(turn, diff));

  // 速度：平滑趋近目标速度；回巢时越近越慢，落地才不会有跳变
  let wantSpeed = FLY.cruiseSpeed * (b.startled ? FLY.startleBoost : 1);
  if (b.returning && !b.startled) {
    wantSpeed = FLY.cruiseSpeed * Math.max(0.12, Math.min(1, toHome / 1.2));
  }
  const cur = Math.hypot(b.vx, b.vy);
  const k = cur === 0 ? wantSpeed : cur + (wantSpeed - cur) * Math.min(1, dt * 3);
  b.vx = Math.cos(b.angle) * k;
  b.vy = Math.sin(b.angle) * k;

  /* ---- 高度：爬升 / 维持 / 下降 ---- */
  let wantClimb;
  if (b.startled) {
    wantClimb = FLY.climbRate * 1.3;                     // 窜高
  } else if (b.returning) {
    // 越靠近睡莲越早开始下降，落地时才刚好在叶子上
    wantClimb = toHome < 1.4 ? -FLY.climbRate * 0.75 : 0;
    if (b.height <= 0.02) b.climb = 0;     // 贴地飞行，别往下掉
  } else {
    wantClimb = b.height < FLY.hoverHeight ? FLY.climbRate : -0.3;
  }
  b.climb += (wantClimb - b.climb) * Math.min(1, dt * 2.5);

  /* ---- 推进 ---- */
  b.x += b.vx * cell * dt;
  b.y += b.vy * cell * dt;
  b.height += b.climb * dt;
  if (b.height < 0) { b.height = 0; b.climb = 0; }

  // 别飞出池塘（正在飞走的、正在飞进来的除外 —— 它们本来就在池塘外）
  const m = cell * 0.6;
  if (!b.leaving && !b.arriving && (b.x < m || b.x > W - m || b.y < m || b.y > H - m)) {
    b.x = Math.max(m, Math.min(W - m, b.x));
    b.y = Math.max(m, Math.min(H - m, b.y));
    b.wp = null;                       // 换个航点
  }

  /* ---- 该往回飞了 ---- */
  // 正在飞出池塘的虫不返航 —— 它的任务就是离开
  if (!b.leaving && !b.startled && !b.returning && now >= b.landAt) {
    b.returning = true;
  }

  /* ---- 降落：高度回到水面且正好在睡莲上 ---- */
  if (!b.leaving && !b.startled && b.returning && b.height <= 0.02
      && (toHome < FLY.landRadius || toHome < 0.35)
      && now - b.tookOffAt > 600) {
    b.flying = false;
    b.returning = false;
    b.arriving = false;
    b.gx = b.home.x; b.gy = b.home.y;
    b.height = 0; b.vx = 0; b.vy = 0; b.climb = 0;
    b.perchUntil = now + FLY.perchMin + Math.random() * (FLY.perchMax - FLY.perchMin);
    // 轮到下一只飞了
    POP.nextFlyAt = now + 300;
    sfxLand();
  }
}

/* 飞入一只新的瓢虫：从池塘边缘外飞进来，落在一片空睡莲上 */
function spawnBeetle(now, homePad, color) {
  const pad = homePad || pickFreePad();
  if (!pad) return null;

  const c = padCenter(pad.x, pad.y);
  // 从池塘外面飞进来 —— 朝着自己的睡莲飞，飞到就降落
  const edge = Math.random() * Math.PI * 2;
  const entry = {
    x: c.x + Math.cos(edge) * (W * 0.7),
    y: c.y + Math.sin(edge) * (H * 0.7)
  };

  const b = {
    x: entry.x, y: entry.y, alive: true,
    gx: pad.x, gy: pad.y,
    home: { x: pad.x, y: pad.y },
    color: color == null ? Math.floor(Math.random() * BEETLE_COLORS.length) : color,
    arrivedAt: now,
    leaving: false, leaveAt: 0,
    flying: true,             // 正在飞进来
    vx: 0, vy: 0, angle: Math.atan2(c.y - entry.y, c.x - entry.x), height: 0.5, climb: 0,
    returning: true,          // 飞回来 = 目标就是自己的睡莲
    landAt: 0,
    tookOffAt: now, wp: null,
    arriving: true,           // 标记：这是刚飞进来的访客
    phase: Math.random() * 6.28
  };
  b.perchUntil = now + 800 + Math.random() * 1200;
  return b;
}

/* 找一片空着的睡莲给新来的虫落脚 */
function pickFreePad() {
  const taken = state.beetles.filter(b => b.alive && !b.leaving && b.gx >= 0)
    .map(b => b.gx + ',' + b.gy);
  const free = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (holeAt(x, y)) continue;
      if (taken.indexOf(x + ',' + y) < 0) free.push({ x, y });
    }
  }
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)];
}

/* 让一只虫飞走 */
function beetleLeave(b, now) {
  b.leaving = true;
  b.leaveAt = now;
  b.flying = true;
  b.returning = false;
  // 朝最近的池塘边飞出去 —— 保证几秒内真的飞出画面，
  // 而不是朝池内兜圈子最后被超时删掉（那样看起来就是突然消失）
  const cx = padCenter(b.gx, b.gy);
  const dl = cx.x - ox, dr = ox + COLS * cell - cx.x;
  const dt2 = cx.y - oy, db = oy + ROWS * cell - cx.y;
  const minD = Math.min(dl, dr, dt2, db);
  let a;
  if (minD === dl)      a = Math.PI + (Math.random() - 0.5) * 0.5;
  else if (minD === dr) a = (Math.random() - 0.5) * 0.5;
  else if (minD === dt2) a = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
  else                   a = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
  b.angle = a;
  // 飞得比平时快，保证几秒内就飞出画面（否则会看起来像原地消失）
  const spd = FLY.cruiseSpeed * 2.6;
  b.vx = Math.cos(a) * spd;
  b.vy = Math.sin(a) * spd;
  b.climb = FLY.climbRate * 1.2;
  b.height = Math.max(b.height, 0.35);
  b.wp = null;
  sfxFly();
}

function updateBeetles(now) {
  /* ---- 定时飞入新的瓢虫 ---- */
  if (!POP.nextSpawnAt) POP.nextSpawnAt = now + POP.spawnEvery;
  if (POP.visitors && now >= POP.nextSpawnAt) {
    POP.nextSpawnAt = now + POP.spawnEvery;
    const living = state.beetles.filter(b => b.alive && !b.leaving);
    if (living.length >= POP.max) {
      // 满 6 只：随机选一只起飞离场，同时让新的一只飞进来。
      const cand = living[Math.floor(Math.random() * living.length)];
      beetleLeave(cand, now);
      // 目标虫的荷叶和颜色由同一只新虫接替，不产生额外目标。
      const nb = spawnBeetle(now, cand.home, cand.color);
      if (nb) {
        nb.target = !!cand.target;
        state.beetles.push(nb);
      }
    } else {
      const nb = spawnBeetle(now);
      if (nb) state.beetles.push(nb);
    }
  }

  const dt = Math.min(0.05, (now - (state.lastTick || now)) / 1000);
  state.lastTick = now;
  if (dt <= 0) return;

  const f = state.frog;
  const fc = padCenter(f.x, f.y);

  /* ---- 飞行权：同一时刻只有一只虫在空中 ---- */
  const flyer = flyingBeetle();
  if (!flyer) {
    // 空出来了，让下一只接棒
    if (!POP.nextFlyAt) POP.nextFlyAt = now;
    if (now >= POP.nextFlyAt) {
      const next = state.beetles.find(b => b.alive && !b.flying && !b.leaving);
      if (next) {
        beetleTakeoff(next, now, false);
        POP.nextFlyAt = 0;
      } else {
        POP.nextFlyAt = now + 1000;
      }
    }
  } else {
    POP.nextFlyAt = 0;
  }

  state.beetles.forEach(b => {
    if (!b.alive) return;

    /* ---- 正在飞走的虫：飞出池塘就消失 ---- */
    if (b.leaving) {
      beetleStep(b, dt, now);
      // 只要飞出池塘画布就算离开了（稍微放宽一点，避免卡在边缘）
      const pad = cell * 0.25;
      const out = b.x < ox - pad || b.x > ox + COLS * cell + pad
               || b.y < oy - pad || b.y > oy + ROWS * cell + pad;
      if (out) { b.alive = false; updateStats(); }
      else if (now - b.leaveAt > 9000) { b.alive = false; updateStats(); }
      return;
    }

    if (!b.flying) {
      // 停栖中 —— 只有轮到它飞的时候才会起飞
      if (now >= b.perchUntil && !b.arriving) {
        // 场上已经有别的虫在飞，就先等着
        if (!airborneBeetle()) beetleTakeoff(b, now, false);
        return;
      }
      // 青蛙靠得太近 —— 吓它起飞（同样要抢到「飞行权」）
      const pc = padCenter(b.gx, b.gy);
      const dist = Math.hypot(pc.x - fc.x, pc.y - fc.y) / cell;
      if (dist < FLY.startleDist && !airborneBeetle()) beetleTakeoff(b, now, true);
      return;
    }

    beetleStep(b, dt, now);
  });

  // 清掉已经飞走的
  state.beetles = state.beetles.filter(b => b.alive);

  // 目标按「四色各一只」维护。换虫时如果目标被选中，
  // 只让同色的新虫接替，不额外增加目标数量。
  const targetColors = new Set();
  state.beetles.forEach(b => {
    if (!b.alive || b.leaving || !b.target) return;
    if (targetColors.has(b.color)) b.target = false;
    else targetColors.add(b.color);
  });
}

/* 虫的当前位置（像素坐标） */
function beetlePos(b, now) {
  if (!b.flying) {
    const c = padCenter(b.gx, b.gy);
    const t = now / 500 + b.phase;
    return {
      x: c.x + Math.sin(t) * cell * 0.05,
      y: c.y + Math.cos(t * 1.3) * cell * 0.035 - cell * 0.06,
      alt: 0
    };
  }
  return {
    x: b.x,
    y: b.y - b.height * cell,
    alt: 1
  };
}

/* ---------------- execution ---------------- */
function execBlock(b) {
  const f = state.frog;
  switch (b.key) {
    case 'move': {
      const d = DIRS[f.dir];
      const r = tryMove(f, d.x, d.y);
      if (!r.ok) { sfxError(); toast(r.reason); return false; }
      f.x = r.x; f.y = r.y; sfxHop();
      if (eatBeetleAt(f.x, f.y)) toast(lastCatchWasFlying ? '在空中逮住它！' : '吃掉一只甲虫！');
      return true;
    }
    case 'jump': {
      const d = DIRS[f.dir];
      const gap = gapAhead(f);
      // 跳跃只走一格；前方是缺口时，跨过缺口落到对面那一格
      const to = gap
        ? { x: gap.x + d.x, y: gap.y + d.y }
        : { x: f.x + d.x, y: f.y + d.y };
      if (!padAt(to.x, to.y) || holeAt(to.x, to.y)) {
        sfxError(); toast(gap ? '缺口对面没有睡莲' : '前面没有睡莲'); return false;
      }
      f.x = to.x; f.y = to.y;
      sfxHop(); setTimeout(() => blip(620, .1, 'triangle', .04), 60);
      if (eatBeetleAt(f.x, f.y)) toast(lastCatchWasFlying ? '在空中逮住它！' : '吃掉一只甲虫！');
      return true;
    }
    case 'left':  f.dir = (f.dir + 3) % 4; sfxTurn(); return true;
    case 'right': f.dir = (f.dir + 1) % 4; sfxTurn(); return true;
    case 'color': f.color = (f.color + 1) % FROG_COLORS.length; blip(700, .1, 'sine', .04); return true;
    case 'sing':  sfxSing(); toast('♪ 青蛙在唱歌 ♪'); return true;
  }
  return true;
}

/* ---------------- execution ----------------
   卡片树先编译成一串扁平的指令（ops），再逐条执行。
   这样 if / 重复 的嵌套跳转就变成了普通的「跳到第几条」。 */

let ops = [];         // 编译后的指令
let opPc = 0;         // 现在执行到第几条
let loopStack = [];   // 循环的栈
let runningTimer = null;
let loopGuard = 0;    // 防止「一直做直到」卡死

const MAX_LOOP_STEPS = 400;

function runProgram() {
  if (state.running) { stopProgram(); return; }
  if (!state.program.length) { toast('先加几张卡片'); return; }
  ops = compileProgram();
  if (!ops.length) { toast('程序里还没有能做的事'); return; }
  opPc = 0; loopStack = []; loopGuard = 0;
  state.running = true;
  state.history = [];
  $('#btnRun').querySelector('.nm').textContent = '停止';
  stepLoop();
}

function stopProgram() {
  state.running = false;
  clearTimeout(runningTimer);
  $('#btnRun').querySelector('.nm').textContent = '运行';
  highlightOp(-1);
}

function highlightOp(i) {
  programEl.querySelectorAll('.hl').forEach(e => e.classList.remove('hl'));
  if (i < 0) return;
  const op = ops[i];
  if (!op || !op.cardId) return;
  const el = programEl.querySelector('[data-id="' + op.cardId + '"]');
  if (el) el.classList.add('hl');
}

/* 执行一条指令。
   返回 'jump' 表示已经自己设置了下一条要执行的指令（不要再 +1），
   返回 false 表示出错了（要停下来）。 */
function execOp(op) {
  switch (op.t) {
    case 'act': {
      state.history.push(op.key);
      const r = execBlock({ key: op.key });
      if (r === false) {
        // 在「一直做直到」里面撞墙了 —— 那就结束这个循环，继续往下做
        const frame = findUntilFrame();
        if (frame) {
          loopStack.splice(loopStack.indexOf(frame), 1);
          opPc = frame.endTarget;
          return 'jump';
        }
      }
      return r === false ? false : 'ok';
    }

    case 'test':                       // 如果 —— 条件不成立就跳到 else 分支
      if (execCond(op.cond)) return 'ok';
      opPc = op.elseTarget;
      return 'jump';

    case 'until':                      // 一直做，直到…… —— 进循环
      loopStack.push({ kind: 'until', start: op.bodyStart, endTarget: op.endTarget, cond: op.cond });
      return 'ok';

    case 'untilend': {                 // 循环体跑完一遍 —— 检查条件
      const frame = findUntilFrame();
      if (!frame) return 'ok';
      if (execCond(frame.cond)) {       // 条件成立 → 跳出循环
        loopStack.splice(loopStack.indexOf(frame), 1);
        opPc = frame.endTarget;
        return 'jump';
      }
      opPc = frame.start;               // 条件不成立 → 再做一遍
      return 'jump';
    }

    case 'jmp':
      opPc = op.target;
      return 'jump';

    case 'loop':
      loopStack.push({ kind: 'times', count: op.count, seen: 0, bodyStart: op.bodyStart });
      return 'ok';

    case 'loopend': {                  // 循环体跑完一遍 —— 数一下次数
      const top = loopStack[loopStack.length - 1];
      if (!top || top.kind !== 'times') return 'ok';
      top.seen++;
      if (top.seen < top.count) {
        opPc = top.bodyStart;
        return 'jump';
      }
      loopStack.pop();
      return 'ok';
    }
  }
  return 'ok';
}

/* 找到最内层那个「一直做直到」的循环 */
function findUntilFrame() {
  for (let i = loopStack.length - 1; i >= 0; i--) {
    if (loopStack[i].kind === 'until') return loopStack[i];
  }
  return null;
}

function stepLoop() {
  if (!state.running) return;
  if (opPc >= ops.length) {
    state.running = false;
    $('#btnRun').querySelector('.nm').textContent = '运行';
    highlightOp(-1);
    setTimeout(checkWin, 350);
    return;
  }
  const op = ops[opPc];
  renderProgram();
  highlightOp(opPc);

  const r = execOp(op);
  draw();
  if (r === false) {
    stopProgram();
    setTimeout(checkWin, 400);
    return;
  }
  if (r !== 'jump') opPc++;

  // 「一直做直到」的安全阀：别让程序卡死
  if (++loopGuard > MAX_LOOP_STEPS) {
    stopProgram();
    toast('转太多圈了，停下来歇一歇');
    setTimeout(checkWin, 400);
    return;
  }
  runningTimer = setTimeout(stepLoop, 620);
}

function stepOnce() {
  if (state.running) return;
  if (!ops.length) {
    ops = compileProgram();
    opPc = 0; loopStack = [];
  }
  if (opPc >= ops.length) { toast('程序已经跑完了'); return; }
  const op = ops[opPc];
  highlightOp(opPc);
  const r = execOp(op);
  if (r !== 'jump') opPc++;
  draw();
}

function checkWin() {
  // 过关条件：吃掉开局的 4 只（每种颜色各一只）
  const targets = state.beetles.filter(b => b.target);
  const left = targets.filter(b => b.alive).length;
  const used = countCards();
  const par = LEVELS[state.level].par || (targets.length + 2);
  if (left === 0) {
    const perfect = used <= par;
    $('#ovTitle').textContent = perfect ? '完美！' : '过关！';
    $('#ovBody').textContent = perfect
      ? `你用 ${used} 张卡片吃掉了四只瓢虫，非常高效。`
      : `你用 ${used} 张卡片吃掉了四只瓢虫，试试 ${par} 张以内？`;
    const next = state.level + 1 < LEVELS.length;
    setOverlayIcon('i-trophy');
    showOverlay(next ? '下一课' : '再玩一次', () => {
      hideOverlay();
      if (next) loadLevel(state.level + 1); else loadLevel(0);
    });
  } else {
    $('#ovTitle').textContent = '再来一次';
    setOverlayIcon('i-bug');
    $('#ovBody').textContent = `四只瓢虫里还剩 ${left} 只。\n调整程序顺序，再试一次。`;
    showOverlay('重试', () => { hideOverlay(); opPc = 0; loopStack = []; draw(); });
  }
}

function updateStats() {
  $('#statBeetles').textContent = state.beetles.filter(b => b.alive && !b.leaving && b.target).length;
  $('#statLevel').textContent = state.level + 1;
}

/* ---------------- overlay ---------------- */
function setOverlayIcon(id) {
  const el = $('#ovIcon');
  if (el) el.innerHTML = `<use href="#${id}"/>`;
}
function showOverlay(btnText, onOk) {
  $('#ovBtn').textContent = btnText;
  $('#ovBtn').onclick = () => { if (onOk) onOk(); };
  $('#overlay').classList.remove('hidden');
}
function hideOverlay() { $('#overlay').classList.add('hidden'); }

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

/* ---------------- drawing ---------------- */
function draw() {
  ctx.clearRect(0, 0, W, H);
  drawWater();
  drawPads();
  drawBeetles();
  drawFrog();
  drawGridHint();
}

function drawWater() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0e3540');
  g.addColorStop(1, '#072027');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // ripples
  const t = Date.now() / 1000;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    const x = (i * 137.5) % W, y = (i * 83.7) % H;
    const r = ((t * 14 + i * 30) % 90) + 10;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function padCenter(x, y) {
  return { x: ox + (x + 0.5) * cell, y: oy + (y + 0.5) * cell };
}

function drawPads() {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (holeAt(x, y)) { drawHole(x, y); continue; }
      const c = padCenter(x, y);
      const r = cell * 0.40;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(c.x + 3, c.y + 6, r, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      // pad
      const g = ctx.createRadialGradient(c.x - r * .3, c.y - r * .3, r * .2, c.x, c.y, r);
      g.addColorStop(0, '#57b06a');
      g.addColorStop(1, '#2e7a45');
      ctx.fillStyle = g;
      ctx.beginPath();
      // lily pad: circle with a wedge cut from the rim toward the center
      const gap = 0.115;
      ctx.arc(c.x, c.y, r, gap, -gap + Math.PI * 2, false);
      ctx.lineTo(c.x + r * 0.62, c.y);
      ctx.closePath();
      ctx.fill();
      // veins
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + Math.cos(a) * r * .88, c.y + Math.sin(a) * r * .88);
        ctx.stroke();
      }
      // subtle rim light
      ctx.strokeStyle = 'rgba(190,255,200,0.35)';
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 0.97, gap + 0.25, -gap + Math.PI * 2 - 0.25, false);
      ctx.stroke();
    }
  }
}

/* 水面缺口：没有睡莲，只有一圈涟漪 */
function drawHole(x, y) {
  const c = padCenter(x, y);
  const r = cell * 0.40;
  const t = Date.now() / 1000;

  // dark water
  ctx.fillStyle = 'rgba(2, 18, 24, 0.55)';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, r, r * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();

  // ripples
  for (let i = 0; i < 2; i++) {
    const ph = (t * 0.6 + i * 0.5) % 1;
    ctx.strokeStyle = `rgba(180, 235, 255, ${0.30 * (1 - ph)})`;
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * (0.30 + ph * 0.62), r * (0.22 + ph * 0.45), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBeetles() {
  const now = Date.now();
  state.beetles.forEach(b => {
    if (!b.alive) return;
    const p = beetlePos(b, now);
    const t = now / 500 + b.phase;
    const r = cell * 0.15;
    const bc = BEETLE_COLORS[b.color % BEETLE_COLORS.length];

    // 飞的时候：在水面上留一道影子，影子越远说明飞得越高
    if (p.alt) {
      ctx.fillStyle = 'rgba(0,0,0,' + (0.26 - Math.min(0.16, b.height * 0.2)) + ')';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + b.height * cell, r * 0.72, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    if (!p.alt) {
      ctx.rotate(Math.sin(t * 0.8) * 0.15);
    } else {
      // 身体朝向飞行方向（略微俯仰）
      ctx.rotate(b.angle + Math.PI / 2);
    }

    // shadow
    if (!p.alt) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(0, r * 1.05, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 翅膀（飞行时张开并扇动）—— 沿身体两侧展开
    if (p.alt) {
      const flap = 0.5 + 0.5 * Math.sin(now / 38 + b.flySeed * 3);
      const spread = 0.25 + flap * 0.70;      // 上下扇动的角度
      for (const s2 of [-1, 1]) {
        ctx.save();
        ctx.translate(s2 * r * 0.30, -r * 0.45);
        ctx.rotate(s2 * spread);
        // 翅膀：半透明白色，明显伸出体外
        ctx.fillStyle = 'rgba(226, 244, 255, 0.6)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = Math.max(1, r * 0.11);
        ctx.beginPath();
        ctx.ellipse(s2 * r * 0.62, 0, r * 0.42, r * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // legs
    ctx.strokeStyle = bc.spot;
    ctx.lineWidth = Math.max(1.2, r * 0.16);
    ctx.lineCap = 'round';
    for (const s2 of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s2 * r * 0.55, -r * 0.15); ctx.lineTo(s2 * r * 1.15, r * 0.45);
      ctx.moveTo(s2 * r * 0.55, r * 0.25);  ctx.lineTo(s2 * r * 1.05, r * 0.85);
      ctx.stroke();
    }

    // head
    ctx.fillStyle = bc.spot;
    ctx.beginPath();
    ctx.arc(0, -r * 0.92, r * 0.40, 0, Math.PI * 2);
    ctx.fill();

    // antennae
    ctx.lineWidth = Math.max(1, r * 0.12);
    for (const s2 of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s2 * r * 0.18, -r * 1.15);
      ctx.quadraticCurveTo(s2 * r * 0.45, -r * 1.55, s2 * r * 0.62, -r * 1.35);
      ctx.stroke();
    ctx.fillStyle = bc.spot;
      ctx.beginPath();
      ctx.arc(s2 * r * 0.62, -r * 1.35, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }

    // red shell
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.15, 0, 0, r * 1.1);
    g.addColorStop(0, bc.body);
    g.addColorStop(0.55, bc.mid);
    g.addColorStop(1, bc.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 1.02, 0, 0, Math.PI * 2);
    ctx.fill();
    // 深色描边 —— 让浅色的壳也能从背景里跳出来
    ctx.strokeStyle = bc.dark;
    ctx.lineWidth = Math.max(1, r * 0.13);
    ctx.stroke();

    // shell split + spots
    ctx.fillStyle = bc.spot;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 1.02, 0, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = bc.spot;
    ctx.fillRect(-r * 0.09, -r * 1.05, r * 0.18, r * 2.1);
    ctx.restore();
    ctx.fillStyle = bc.spot;
    ctx.beginPath(); ctx.arc(-r * 0.44, -r * 0.32, r * 0.21, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.44, -r * 0.32, r * 0.21, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-r * 0.44, r * 0.36, r * 0.21, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.44, r * 0.36, r * 0.21, 0, Math.PI * 2); ctx.fill();

    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.36, -r * 0.52, r * 0.22, r * 0.13, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });
}

function drawFrog() {
  const f = state.frog;
  const c = padCenter(f.x, f.y);
  const col = FROG_COLORS[f.color];
  const r = cell * 0.30;
  const bob = Math.sin(Date.now() / 320) * cell * 0.012;
  const breathe = 1 + Math.sin(Date.now() / 500) * 0.02;

  ctx.save();
  ctx.translate(c.x, c.y + bob);

  // shadow on the pad
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, r * 1.05, r * 1.25, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // back legs
  ctx.fillStyle = col.dark;
  for (const s2 of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s2 * r * 0.82, r * 0.52, r * 0.42, r * 0.30, s2 * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // body
  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.45, r * 0.15, 0, 0, r * 1.25);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.18, col.body);
  g.addColorStop(1, col.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.92 * breathe, r * 1.02 * breathe, 0, 0, Math.PI * 2);
  ctx.fill();

  // belly
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.62, r * 0.44, r * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // eye bumps
  for (const s2 of [-1, 1]) {
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.arc(s2 * r * 0.48, -r * 0.86, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s2 * r * 0.48, -r * 0.88, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#12181a';
    ctx.beginPath();
    ctx.arc(s2 * r * 0.48 + r * 0.05, -r * 0.90, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  // cheeks
  ctx.fillStyle = 'rgba(255,120,120,0.35)';
  for (const s2 of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s2 * r * 0.72, r * 0.20, r * 0.17, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // smile
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = Math.max(1.6, r * 0.11);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, r * 0.10, r * 0.46, 0.20 * Math.PI, 0.80 * Math.PI);
  ctx.stroke();

  // front legs
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.beginPath();
  ctx.moveTo(-r * 0.46, r * 0.66); ctx.lineTo(-r * 0.64, r * 0.96);
  ctx.moveTo(r * 0.46, r * 0.66);  ctx.lineTo(r * 0.64, r * 0.96);
  ctx.stroke();

  ctx.restore();

  // direction arrow
  const d = DIRS[f.dir];
  const ax = c.x + d.x * cell * 0.50;
  const ay = c.y + d.y * cell * 0.50;
  const a = Math.atan2(d.y, d.x);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(a);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(cell * 0.062, 0);
  ctx.lineTo(-cell * 0.030, -cell * 0.038);
  ctx.lineTo(-cell * 0.030, cell * 0.038);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGridHint() {
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 1; i < COLS; i++) {
    ctx.beginPath(); ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + ROWS * cell); ctx.stroke();
  }
  for (let i = 1; i < ROWS; i++) {
    ctx.beginPath(); ctx.moveTo(ox, oy + i * cell); ctx.lineTo(ox + COLS * cell, oy + i * cell); ctx.stroke();
  }
}

/* ---------------- interaction ---------------- */
document.querySelectorAll('.pal[data-block]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.running) return;
    snapshot();
    addBlock(btn.dataset.block);
  });
});
const cancelBtn = document.getElementById('pickerCancel');
if (cancelBtn) cancelBtn.addEventListener('click', closePicker);
$('#btnRun').addEventListener('click', runProgram);
$('#btnStep').addEventListener('click', stepOnce);
$('#btnClear').addEventListener('click', clearProgram);
$('#btnUndo').addEventListener('click', undoBlock);
$('#btnReset').addEventListener('click', () => {
  stopProgram();
  loadLevel(state.level);
  toast('已重置');
});
$('#btnSound').addEventListener('click', ev => {
  state.sound = !state.sound;
  ev.currentTarget.innerHTML = `<svg class="ic"><use href="#${state.sound ? 'i-sound' : 'i-mute'}"/></svg>`;
  if (state.sound) blip(700, .08, 'sine', .04);
});

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// tap a pad: frog turns toward / hops there (free play)
canvas.addEventListener('pointerdown', ev => {
  if (state.running) return;
  const rect = canvas.getBoundingClientRect();
  const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
  const gx = Math.floor((px - ox) / cell), gy = Math.floor((py - oy) / cell);
  if (!padAt(gx, gy)) return;
  if (holeAt(gx, gy)) { toast('那里是水面缺口，青蛙跳不过去'); return; }
  const f = state.frog;
  const dx = gx - f.x, dy = gy - f.y;
  if (Math.abs(dx) + Math.abs(dy) === 1) {
    const dir = DIRS.findIndex(d => d.x === dx && d.y === dy);
    if (dir >= 0) { f.dir = dir; }
  }
  f.x = gx; f.y = gy;
  sfxHop();
  draw();
});

/* ---------------- go ---------------- */
resize();
loadLevel(0);
setInterval(() => {
  updateBeetles(Date.now());
  if (!state.running) draw();
}, 60);
