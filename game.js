/* ============================================================
   Frog Pond — CHM 展项复刻（Iteration 3 规格）
   - 六边形网格：青蛙在 6 个方向之间跳
   - 甲虫落在网格交点上，用 eat 指令吃掉
   - 指令：hop / chirp / eat / left / right / spin / hatch
   - 控制结构：if-else / repeat（可嵌套）
   - 程序纵向堆叠，运行时有一支箭头追踪控制流
   - hatch 孵出新青蛙，几条指令就能让池塘满是青蛙
   ============================================================ */
'use strict';

/* ---------------- 六边形网格 ---------------- */
/* 采用 axial 坐标 (q, r)，尖顶六边形。
   6 个方向的角度依次是 0°, -60°, -120°, 180°, 120°, 60° */
const DIRS = [
  { dq:  1, dr:  0, name: '东' },
  { dq:  1, dr: -1, name: '东北' },
  { dq:  0, dr: -1, name: '西北' },
  { dq: -1, dr:  0, name: '西' },
  { dq: -1, dr:  1, name: '西南' },
  { dq:  0, dr:  1, name: '东南' }
];
const NDIR = 6;
const dirAngle = i => -Math.PI / 3 * i;

/* 池塘范围：半径 3 的六边形（37 格） */
const POND_R = 3;
const CELLS = [];
for (let q = -POND_R; q <= POND_R; q++) {
  for (let r = -POND_R; r <= POND_R; r++) {
    if (Math.abs(q + r) <= POND_R) CELLS.push({ q, r });
  }
}
const cellKey = (q, r) => q + ',' + r;
const CELL_MAP = new Map(CELLS.map(c => [cellKey(c.q, c.r), c]));

/* ---------------- 颜色 ---------------- */
const BEETLE_COLORS = [
  { name: 'red',    body: '#ff7a63', mid: '#e23b2c', dark: '#8f1a12', spot: '#2a0f0c' },
  { name: 'yellow', body: '#ffc93c', mid: '#e09a12', dark: '#96650c', spot: '#3a2a08' },
  { name: 'blue',   body: '#63c8f5', mid: '#2b8ec6', dark: '#14567c', spot: '#0d2a3a' },
  { name: 'white',  body: '#fbfcfc', mid: '#b9c1c6', dark: '#79838a', spot: '#1b2226' }
];
const FROG_COLORS = [
  { name: 'green', body: '#4cc45a', dark: '#2f8f3d', light: '#7ee88a' },
  { name: 'gold',  body: '#f0c04a', dark: '#b78a1c', light: '#ffe08a' },
  { name: 'blue',  body: '#4fb8e8', dark: '#2279ad', light: '#9ddcff' },
  { name: 'pink',  body: '#f07aa8', dark: '#b8467a', light: '#ffb6d1' }
];

/* ---------------- 指令卡片 ---------------- */
const BLOCKS = {
  hop:   { label: '跳',   icon: 'i-hop' },
  chirp: { label: '叫',   icon: 'i-chirp' },
  eat:   { label: '吃',   icon: 'i-eat' },
  left:  { label: '左转', icon: 'i-left' },
  right: { label: '右转', icon: 'i-right' },
  spin:  { label: '转身', icon: 'i-spin' },
  hatch: { label: '孵',   icon: 'i-hatch' },
  if:    { label: '如果', icon: 'i-if' },
  repeat:{ label: '重复', icon: 'i-repeat' }
};

/* if 的条件 */
const CONDITIONS = {
  abug:  { label: '脚下有虫', icon: 'i-cond-abug' },
  bug:   { label: '前面有虫', icon: 'i-cond-bug' },
  empty: { label: '前面是空的', icon: 'i-cond-empty' },
  water: { label: '前面是水', icon: 'i-cond-water' }
};

const REPEAT_NUMS = [2, 3, 4, 5, 6];

/* ---------------- 状态 ---------------- */
const state = {
  frogs: [],            // [{q,r,dir,color,alive,hue}]
  beetles: [],
  holes: [],            // [{q,r}]
  program: [],          // 卡片树
  focus: null,          // 当前插入点
  undoStack: [],
  running: false,
  level: 0,
  sound: true,
  score: 0,
  eaten: 0,
  targetLeft: 0,
  frogColor: 0,         // 当前在编辑哪种颜色的青蛙
  speed: 1
};

const POP = {
  max: 6,
  spawnEvery: 5000,
  nextSpawnAt: 0,
  visitors: true,
  nextFlyAt: 0
};

const FLY = {
  perchMin: 5000, perchMax: 11000,
  cruiseSpeed: 0.9, climbRate: 1.1, hoverHeight: 0.62,
  turnRate: 1.8, flyMin: 3500, flyMax: 7000,
  startleDist: 1.7, startleBoost: 2.2, landRadius: 0.2
};

/* ---------------- 关卡 ---------------- */
const LEVELS = [
  {
    name: '第一课：吃掉甲虫',
    frogs: [{ q: -2, r: 0, dir: 0 }],
    beetles: [[-1, 0], [0, 0]],
    holes: [],
    par: 4,
    hint: '甲虫停在荷叶上。\n青蛙走到它那片叶子上，再用「吃」。'
  },
  {
    name: '第二课：水面挡路',
    frogs: [{ q: -2, r: 1, dir: 0 }],
    beetles: [[1, 0], [2, -1]],
    holes: [[-1, 1], [0, 1]],
    par: 9,
    hint: '深色的格子是水，跳不过去。\n绕着走，别掉下去。'
  },
  {
    name: '第三课：重复',
    frogs: [{ q: -1, r: 1, dir: 0 }],
    beetles: [[0, 1], [1, 1], [2, 1]],
    holes: [],
    par: 4,
    hint: '一整排甲虫，一张一张点太慢了。\n把「跳」和「吃」放进「重复」里。'
  },
  {
    name: '第四课：如果',
    frogs: [{ q: -1, r: 0, dir: 0 }],
    beetles: [[-1, 0], [0, 0], [1, 0], [2, 0]],
    holes: [],
    par: 6,
    hint: '让青蛙自己判断：\n脚下有虫子就吃掉它。'
  },
  {
    name: '第五课：孵出小青蛙',
    frogs: [{ q: -2, r: 0, dir: 0 }],
    beetles: [[-1, 0], [0, 0], [1, 0], [2, 0]],
    holes: [],
    par: 3,
    hint: '「孵」会变出一只新青蛙，\n它们会一起执行这套程序。'
  }
];

/* ---------------- DOM ---------------- */
const $ = s => document.querySelector(s);
const canvas = $('#pond');
const ctx = canvas.getContext('2d');
const programEl = $('#program');
const toastEl = $('#toast');

/* ---------------- 画布尺寸 ---------------- */
let W = 0, H = 0, dpr = 1, hexR = 0, ox = 0, oy = 0;

function hexWidth()  { return Math.sqrt(3) * hexR; }
function hexHeight() { return 2 * hexR; }

function cellCenter(q, r) {
  return {
    x: ox + hexWidth() * (q + r / 2),
    y: oy + hexHeight() * 0.75 * r
  };
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  W = rect.width; H = rect.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutGrid();
  draw();
}

/* 重新计算：让整个六边形池塘居中 */
function layoutGrid() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of CELLS) {
    const x = Math.sqrt(3) * (c.q + c.r / 2);
    const y = 1.5 * c.r;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const spanX = (maxX - minX) + Math.sqrt(3);
  const spanY = (maxY - minY) + 2;
  hexR = Math.min((W - 48) / spanX, (H - 48) / spanY);
  ox = W / 2 - (minX + maxX) / 2 * hexR * 0 - hexR * Math.sqrt(3) * (minX + maxX) / 2 / hexR * 0;
  // x = hexR*sqrt3*(q + r/2) + ox  => 中心对齐
  ox = W / 2 - hexR * Math.sqrt(3) * (minX + maxX) / 2;
  oy = H / 2 - hexR * 1.5 * (minY + maxY) / 2;
}

/* ---------------- 音效 ---------------- */
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
  } catch (e) {}
}
const sfxHop   = () => { blip(320, .10, 'triangle', .05); setTimeout(() => blip(480, .09, 'triangle', .04), 60); };
const sfxEat   = () => { blip(880, .07, 'square', .05); setTimeout(() => blip(1180, .10, 'square', .05), 70); };
const sfxTurn  = () => blip(240, .07, 'sine', .035);
const sfxChirp = () => [620, 840, 1000].forEach((f, i) => setTimeout(() => blip(f, .09, 'sine', .05), i * 70));
const sfxHatch = () => [400, 560, 760, 980].forEach((f, i) => setTimeout(() => blip(f, .10, 'triangle', .05), i * 60));
const sfxError = () => blip(150, .18, 'sawtooth', .04);
const sfxFly   = () => { blip(900, .06, 'sine', .02); setTimeout(() => blip(1250, .06, 'sine', .018), 50); };
const sfxLand  = () => blip(420, .07, 'sine', .025);

/* ---------------- 关卡加载 ---------------- */
function loadLevel(i) {
  state.level = i;
  const L = LEVELS[i];
  const now = Date.now();

  state.holes = (L.holes || []).map(([q, r]) => ({ q, r }));
  state.frogs = (L.frogs || [{ q: 0, r: 0, dir: 0 }]).map(f => ({
    q: f.q, r: f.r, dir: f.dir || 0,
    color: 0, alive: true,
    x: 0, y: 0, hop: 0, hopFrom: null,
    pc: 0, loops: []
  }));

  state.beetles = [];
  (L.beetles || []).forEach(([q, r], k) => {
    state.beetles.push(makeBeetle(q, r, k % BEETLE_COLORS.length, now, true));
  });

  state.targetLeft = state.beetles.length;
  state.eaten = 0;
  state.score = 0;
  state.program = [];
  state.focus = null;
  state.undoStack = [];
  state.running = false;
  state.frogColor = 0;
  state.frogs.forEach(f => f.color = 0);

  POP.nextSpawnAt = 0;
  POP.nextFlyAt = 0;
  POP.visitors = L.visitors !== false;

  ops = [];
  renderProgram();
  updateStats();
  draw();
}

/* ---------------- 六边形辅助 ---------------- */
function isCell(q, r) { return CELL_MAP.has(cellKey(q, r)); }
function holeAt(q, r) { return state.holes.some(h => h.q === q && h.r === r); }
function walkable(q, r) { return isCell(q, r) && !holeAt(q, r); }

/* 青蛙朝向前方那格 */
function aheadOf(f) {
  const d = DIRS[f.dir];
  return { q: f.q + d.dq, r: f.r + d.dr };
}

function frogAt(q, r) {
  return state.frogs.find(f => f.alive && f.q === q && f.r === r) || null;
}
function beetleAt(q, r) {
  return state.beetles.find(b => b.alive && b.q === q && b.r === r) || null;
}

/* ---------------- 甲虫 ---------------- */
function makeBeetle(q, r, color, now, target) {
  const c = cellCenter(q, r);
  return {
    q, r,
    home: { q, r },
    color: color == null ? Math.floor(Math.random() * BEETLE_COLORS.length) : color,
    alive: true,
    target: !!target,
    flying: false, leaving: false, arriving: false,
    returning: false, startled: false,
    x: c.x, y: c.y, height: 0, vx: 0, vy: 0, climb: 0,
    angle: 0, wp: null, phase: Math.random() * 6.28,
    arrivedAt: now, leaveAt: 0, perchUntil: now + 6000, landAt: 0, tookOffAt: now
  };
}

function flyingBeetle() {
  return state.beetles.find(b => b.alive && b.flying && !b.leaving && !b.arriving) || null;
}
function airborneBeetle() {
  return state.beetles.find(b => b.alive && b.flying) || null;
}

function newWaypoint(b) {
  const m = hexR * 0.8;
  b.wp = {
    x: m + Math.random() * Math.max(1, W - m * 2),
    y: m + Math.random() * Math.max(1, H - m * 2)
  };
}

function beetleTakeoff(b, now) {
  if (airborneBeetle()) return;
  const c = cellCenter(b.q, b.r);
  b.flying = true; b.tookOffAt = now; b.returning = false;
  b.x = c.x; b.y = c.y; b.height = 0; b.climb = FLY.climbRate;
  b.landAt = now + FLY.flyMin + Math.random() * (FLY.flyMax - FLY.flyMin);
  const a = -Math.PI / 2 + (Math.random() - .5) * 1.8;
  b.vx = Math.cos(a) * FLY.cruiseSpeed;
  b.vy = Math.sin(a) * FLY.cruiseSpeed;
  b.angle = a;
  newWaypoint(b);
  sfxFly();
}

function beetleLeave(b, now) {
  b.leaving = true; b.leaveAt = now; b.flying = true;
  b.returning = false; b.arriving = false;
  // 朝最近的池塘边飞出去
  const c = cellCenter(b.q, b.r);
  const dl = c.x, dr = W - c.x, dt2 = c.y, db = H - c.y;
  const m = Math.min(dl, dr, dt2, db);
  let a;
  if (m === dl) a = Math.PI + (Math.random() - .5) * .5;
  else if (m === dr) a = (Math.random() - .5) * .5;
  else if (m === dt2) a = -Math.PI / 2 + (Math.random() - .5) * .5;
  else a = Math.PI / 2 + (Math.random() - .5) * .5;
  b.angle = a;
  const spd = FLY.cruiseSpeed * 2.6;
  b.vx = Math.cos(a) * spd; b.vy = Math.sin(a) * spd;
  b.climb = FLY.climbRate * 1.2;
  b.height = Math.max(b.height, .35);
  sfxFly();
}

function beetleStep(b, dt, now) {
  if (b.leaving) {
    b.x += b.vx * hexR * dt / 10;
    b.y += b.vy * hexR * dt / 10;
    b.height += b.climb * dt;
    if (b.height > 1.4) b.climb = 0;
    return;
  }
  const homeC = cellCenter(b.home.q, b.home.r);
  const toHome = Math.hypot(b.x - homeC.x, b.y - homeC.y) / hexR;

  let goal;
  if (b.startled) {
    const f = state.frogs[0];
    const fc = f ? cellCenter(f.q, f.r) : homeC;
    goal = Math.atan2(b.y - fc.y, b.x - fc.x);
    if (now - b.startleAt > 1500) b.startled = false;
  } else if (b.returning) {
    goal = Math.atan2(homeC.y - b.y, homeC.x - b.x);
  } else {
    if (!b.wp) newWaypoint(b);
    if (Math.hypot(b.wp.x - b.x, b.wp.y - b.y) < hexR * .25) newWaypoint(b);
    goal = Math.atan2(b.wp.y - b.y, b.wp.x - b.x);
  }

  let diff = goal - b.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = FLY.turnRate * (b.startled ? 2.2 : 1) * dt;
  b.angle += Math.max(-turn, Math.min(turn, diff));

  let want = FLY.cruiseSpeed * (b.startled ? FLY.startleBoost : 1);
  if (b.returning && !b.startled) {
    want = (b.arriving && toHome > 1.2) ? FLY.cruiseSpeed * 1.9
         : FLY.cruiseSpeed * Math.max(.12, Math.min(1, toHome / 1.2));
  }
  const cur = Math.hypot(b.vx, b.vy);
  const k = cur === 0 ? want : cur + (want - cur) * Math.min(1, dt * 3);
  b.vx = Math.cos(b.angle) * k;
  b.vy = Math.sin(b.angle) * k;

  let wantClimb;
  if (b.startled) wantClimb = FLY.climbRate * 1.3;
  else if (b.returning) {
    wantClimb = toHome < 1.4 ? -FLY.climbRate * .75 : 0;
    if (b.height <= .02) b.climb = 0;
  } else {
    wantClimb = b.height < FLY.hoverHeight ? FLY.climbRate : -.3;
  }
  b.climb += (wantClimb - b.climb) * Math.min(1, dt * 2.5);

  b.x += b.vx * hexR * dt / 10;
  b.y += b.vy * hexR * dt / 10;
  b.height += b.climb * dt;
  if (b.height < 0) { b.height = 0; b.climb = 0; }

  const m = hexR * .6;
  if (!b.arriving && (b.x < m || b.x > W - m || b.y < m || b.y > H - m)) {
    b.x = Math.max(m, Math.min(W - m, b.x));
    b.y = Math.max(m, Math.min(H - m, b.y));
    b.wp = null;
  }

  if (!b.startled && !b.returning && now >= b.landAt) b.returning = true;

  if (!b.startled && b.returning
      && (toHome < FLY.landRadius || (toHome < .8 && b.height <= .20))) {
    b.flying = false; b.returning = false; b.arriving = false;
    b.q = b.home.q; b.r = b.home.r;
    b.height = 0; b.vx = 0; b.vy = 0; b.climb = 0;
    b.perchUntil = now + FLY.perchMin + Math.random() * (FLY.perchMax - FLY.perchMin);
    POP.nextFlyAt = now + 1500;
    sfxLand();
  }
}

function freeCell() {
  const taken = new Set();
  state.beetles.filter(b => b.alive && !b.leaving).forEach(b => taken.add(cellKey(b.q, b.r)));
  state.frogs.filter(f => f.alive).forEach(f => taken.add(cellKey(f.q, f.r)));
  const free = CELLS.filter(c => !holeAt(c.q, c.r) && !taken.has(cellKey(c.q, c.r)));
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)];
}

function spawnBeetle(now, atQ, atR, color) {
  let q = atQ, r = atR;
  if (q == null) {
    const c = freeCell();
    if (!c) return null;
    q = c.q; r = c.r;
  }
  const b = makeBeetle(q, r, color, now, false);
  const c = cellCenter(q, r);
  const a = Math.random() * Math.PI * 2;
  b.x = c.x + Math.cos(a) * W * .55;
  b.y = c.y + Math.sin(a) * H * .55;
  b.flying = true; b.arriving = true; b.returning = true;
  b.height = .5; b.climb = 0; b.angle = Math.atan2(c.y - b.y, c.x - b.x);
  b.perchUntil = now + 900;
  return b;
}

function updateBeetles(now) {
  if (!POP.nextSpawnAt) POP.nextSpawnAt = now + POP.spawnEvery;

  if (POP.visitors && now >= POP.nextSpawnAt) {
    POP.nextSpawnAt = now + POP.spawnEvery;
    const living = state.beetles.filter(b => b.alive && !b.leaving);
    if (living.length >= POP.max) {
      const cand = living[Math.floor(Math.random() * living.length)];
      beetleLeave(cand, now);
      const nb = spawnBeetle(now, cand.q, cand.r, cand.target ? cand.color : null);
      if (nb) { nb.target = cand.target; state.beetles.push(nb); }
    } else {
      const nb = spawnBeetle(now);
      if (nb) state.beetles.push(nb);
    }
  }

  const dt = Math.min(.05, (now - (state.lastTick || now)) / 1000);
  state.lastTick = now;
  if (dt <= 0) return;

  const flyer = flyingBeetle();
  if (!flyer) {
    if (!POP.nextFlyAt) POP.nextFlyAt = now;
    if (now >= POP.nextFlyAt) {
      const next = state.beetles.find(b => b.alive && !b.flying && !b.leaving && !b.arriving);
      if (next) { beetleTakeoff(next, now); POP.nextFlyAt = 0; }
      else POP.nextFlyAt = now + 1200;
    }
  } else POP.nextFlyAt = 0;

  state.beetles.forEach(b => {
    if (!b.alive) return;
    if (b.leaving) {
      beetleStep(b, dt, now);
      const pad = hexR * .25;
      if (b.x < -pad || b.x > W + pad || b.y < -pad || b.y > H + pad) b.alive = false;
      else if (now - b.leaveAt > 9000) b.alive = false;
      return;
    }
    if (!b.flying) {
      if (now >= b.perchUntil && !b.arriving) {
        if (!airborneBeetle()) beetleTakeoff(b, now);
        return;
      }
      return;
    }
    beetleStep(b, dt, now);
  });

  state.beetles = state.beetles.filter(b => b.alive);
  updateStats();
}

/* ---------------- 绘制：池塘 ---------------- */
function draw() {
  ctx.clearRect(0, 0, W, H);
  drawWater();
  drawHexPads();
  drawBeetles();
  drawFrogs();
}

function drawWater() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0e3540');
  g.addColorStop(1, '#072027');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const t = Date.now() / 1000;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    const x = (i * 137.5) % W, y = (i * 83.7) % H;
    const r = ((t * 14 + i * 30) % 90) + 10;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * .35, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function hexPath(cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = dirAngle(i) + Math.PI / 6;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* 六边形睡莲：一格一片叶子，格线就是青蛙能走的路 */
function drawHexPads() {
  for (const c of CELLS) {
    const p = cellCenter(c.q, c.r);
    if (holeAt(c.q, c.r)) { drawWaterHole(p); continue; }

    const r = hexR * .96;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    hexPath(p.x + 2, p.y + 5, r);
    ctx.fill();

    // 叶面
    const g = ctx.createRadialGradient(p.x - r * .3, p.y - r * .35, r * .2, p.x, p.y, r);
    g.addColorStop(0, '#5cba6c');
    g.addColorStop(1, '#2f7c47');
    ctx.fillStyle = g;
    hexPath(p.x, p.y, r);
    ctx.fill();

    // 叶脉
    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    ctx.lineWidth = Math.max(1, r * .035);
    for (let i = 0; i < 6; i++) {
      const a = dirAngle(i) + Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(a) * r * .9, p.y + Math.sin(a) * r * .9);
      ctx.stroke();
    }

    // 格线（明确标出可走的路径）
    ctx.strokeStyle = 'rgba(190,255,205,0.30)';
    ctx.lineWidth = Math.max(1, r * .05);
    hexPath(p.x, p.y, r * .99);
    ctx.stroke();
  }
}

function drawWaterHole(p) {
  const r = hexR * .96;
  ctx.fillStyle = 'rgba(2,18,24,0.62)';
  hexPath(p.x, p.y, r);
  ctx.fill();
  const t = Date.now() / 1000;
  for (let i = 0; i < 2; i++) {
    const ph = (t * .6 + i * .5) % 1;
    ctx.strokeStyle = `rgba(170,225,255,${0.30 * (1 - ph)})`;
    ctx.lineWidth = Math.max(1, r * .05);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * (.25 + ph * .6), 0, Math.PI * 2);
    ctx.stroke();
  }
}

/* ---------------- 绘制：甲虫 ---------------- */
function drawBeetles() {
  const now = Date.now();
  state.beetles.forEach(b => {
    if (!b.alive) return;
    const home = cellCenter(b.q, b.r);
    const p = b.flying
      ? { x: b.x, y: b.y - b.height * hexR }
      : { x: home.x, y: home.y - hexR * .07 };
    const bob = b.flying ? 0 : Math.sin(now / 500 + b.phase) * hexR * .03;
    const r = hexR * .21;
    const bc = BEETLE_COLORS[b.color % BEETLE_COLORS.length];

    if (b.flying) {
      ctx.fillStyle = 'rgba(0,0,0,' + (0.26 - Math.min(.16, b.height * .2)) + ')';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + b.height * hexR, r * .7, r * .24, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(b.flying ? b.angle + Math.PI / 2 : Math.sin(now / 900 + b.phase) * .08);

    if (b.flying) {
      const flap = .5 + .5 * Math.sin(now / 38 + b.phase * 3);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * r * .3, -r * .45);
        ctx.rotate(s * (.25 + flap * .7));
        ctx.fillStyle = 'rgba(226,244,255,0.55)';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(1, r * .11);
        ctx.beginPath();
        ctx.ellipse(s * r * .62, 0, r * .42, r * .78, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    // 腿
    ctx.strokeStyle = bc.spot;
    ctx.lineWidth = Math.max(1.2, r * .16);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * .55, -r * .15); ctx.lineTo(s * r * 1.1, r * .45);
      ctx.moveTo(s * r * .55, r * .25);  ctx.lineTo(s * r * 1.0, r * .85);
      ctx.stroke();
    }

    // 头
    ctx.fillStyle = bc.spot;
    ctx.beginPath();
    ctx.ellipse(0, -r * .62, r * .62, r * .48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bc.spot;
    ctx.lineWidth = Math.max(1.2, r * .13);
    ctx.beginPath();
    ctx.moveTo(-r * .3, -r * .95); ctx.lineTo(-r * .55, -r * 1.35);
    ctx.moveTo(r * .3, -r * .95);  ctx.lineTo(r * .55, -r * 1.35);
    ctx.stroke();

    // 身体
    const bg = ctx.createRadialGradient(-r * .25, -r * .45, r * .15, 0, 0, r * 1.25);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(.18, bc.body);
    bg.addColorStop(1, bc.dark);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * .92, r * 1.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(18,30,26,0.55)';
    ctx.lineWidth = Math.max(1.2, r * .1);
    ctx.stroke();

    // 翅缝与斑点
    ctx.strokeStyle = bc.spot;
    ctx.lineWidth = Math.max(1.2, r * .1);
    ctx.beginPath();
    ctx.moveTo(0, -r * .1); ctx.lineTo(0, r * .95);
    ctx.stroke();
    ctx.fillStyle = bc.spot;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(s * r * .42, r * .05, r * .17, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * r * .38, r * .55, r * .15, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  });
}

/* ---------------- 绘制：青蛙 ---------------- */
function drawFrogs() {
  const now = Date.now();
  state.frogs.forEach(f => {
    if (!f.alive) return;
    const c = cellCenter(f.q, f.r);
    const r = hexR * .34;
    const col = FROG_COLORS[f.color % FROG_COLORS.length];
    const breathe = 1 + Math.sin(now / 420 + f.q) * .03;

    ctx.save();
    ctx.translate(c.x, c.y - hexR * .22);

    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, hexR * .34, r * .95, r * .38, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(dirAngle(f.dir));

    const body = r * 1.0;
    // 身体：椭圆，头朝 +x
    const g = ctx.createRadialGradient(-body * .2, -body * .3, body * .2, 0, 0, body * 1.3);
    g.addColorStop(0, col.light);
    g.addColorStop(.45, col.body);
    g.addColorStop(1, col.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, body * 1.02 * breathe, body * .88 * breathe, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,40,24,.45)';
    ctx.lineWidth = Math.max(1.2, body * .07);
    ctx.stroke();

    // 背上的深色小斑点
    ctx.fillStyle = 'rgba(20,70,35,.28)';
    for (const [dx, dy, rr] of [[-.30,-.22,.13],[-.10,.26,.11],[-.52,.05,.10]]) {
      ctx.beginPath();
      ctx.arc(body*dx, body*dy, body*rr, 0, Math.PI*2);
      ctx.fill();
    }

    // 两只凸出的眼睛（青蛙最明显的特征）
    for (const s2 of [-1, 1]) {
      const ex = body * .52, ey = s2 * body * .46;
      // 眼泡：凸出身体轮廓
      ctx.fillStyle = col.body;
      ctx.beginPath();
      ctx.arc(ex, ey, body * .40, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,40,24,.5)';
      ctx.lineWidth = Math.max(1.2, body * .07);
      ctx.stroke();
      // 眼白
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex + body * .06, ey, body * .27, 0, Math.PI * 2);
      ctx.fill();
      // 瞳孔朝前
      ctx.fillStyle = '#101a16';
      ctx.beginPath();
      ctx.arc(ex + body * .15, ey, body * .14, 0, Math.PI * 2);
      ctx.fill();
      // 高光
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.arc(ex + body * .10, ey - body * .08, body * .05, 0, Math.PI * 2);
      ctx.fill();
    }

    // 嘴：一条微笑的弧
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = Math.max(1.4, body * .09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(body * .30, 0, body * .40, -0.75, 0.75);
    ctx.stroke();

    // 四条腿：从身体两侧向外伸出（画在最上层，清楚可见）
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = Math.max(2.6, body * .21);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const sx of [-1, 1]) {
      // 后腿
      ctx.beginPath();
      ctx.moveTo(-body * .38, sx * body * .62);
      ctx.lineTo(-body * .92, sx * body * 1.10);
      ctx.stroke();
      // 前腿
      ctx.beginPath();
      ctx.moveTo(body * .30, sx * body * .64);
      ctx.lineTo(body * .66, sx * body * 1.10);
      ctx.stroke();
    }

    ctx.restore();

    // 朝向小箭头
    const a = dirAngle(f.dir);
    const ax = Math.cos(a) * hexR * .72, ay = Math.sin(a) * hexR * .72;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(hexR * .13, 0);
    ctx.lineTo(-hexR * .06, -hexR * .085);
    ctx.lineTo(-hexR * .06, hexR * .085);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  });
}

/* 运行时：在程序栈左侧显示一支箭头，追踪控制流（DOM 实现） */
function placeRunCursor() { /* 由 highlightRun 中的 CSS 负责，不需要 canvas 绘制 */ }

/* ============================================================
   程序：一棵卡片树
   普通卡片是叶子；「如果」「重复」是容器，里面可以再塞卡片
   ============================================================ */

let cardSeq = 1;
function newCard(key, extra) {
  const c = Object.assign({ key, id: cardSeq++ }, extra || {});
  if (c.key === 'if' || c.key === 'repeat') c.children = [];
  if (c.key === 'if') c.elseChildren = [];
  return c;
}
const isSlot = c => c.key === 'if' || c.key === 'repeat';
const branchList = (c, br) => (c.key === 'if' && br === 'else') ? c.elseChildren : c.children;

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

function snapshot() {
  state.undoStack.push(JSON.stringify(state.program));
  if (state.undoStack.length > 60) state.undoStack.shift();
}

function addBlock(key) {
  if (state.running) return;
  snapshot();
  const card = newCard(key, key === 'if' ? { cond: 'bug' } : key === 'repeat' ? { count: 3 } : null);
  const f = state.focus;
  if (f) {
    const list = branchList(f.parent, f.branch);
    list.splice(f.index, 0, card);
    state.focus = isSlot(card) ? { parent: card, branch: 'then', index: 0 }
                              : { parent: f.parent, branch: f.branch, index: f.index + 1 };
  } else {
    state.program.push(card);
    if (isSlot(card)) state.focus = { parent: card, branch: 'then', index: 0 };
  }
  renderProgram();
  blip(600, .05, 'sine', .03);
}

function removeCard(id) {
  if (state.running) return;
  const loc = findCard(id);
  if (!loc) return;
  loc.list.splice(loc.index, 1);
  if (state.focus && !findCard(state.focus.parent.id)) state.focus = null;
  renderProgram();
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

/* ---------------- 渲染程序栈 ---------------- */
function renderProgram() {
  programEl.innerHTML = '';
  if (!state.program.length) {
    programEl.innerHTML = '<div id="progEmpty">' +
      '<svg class="ic sm"><use href="#i-tap"/></svg><span>点下面的卡片，把它排进程序</span>' +
      '<svg class="ic sm"><use href="#i-run"/></svg><span>再按这个跑起来</span></div>';
  } else {
    const start = document.createElement('div');
    start.className = 'startCap';
    start.innerHTML = '<span class="stxt">开始</span>' +
      '<svg class="ic"><use href="#i-run"/></svg>';
    programEl.appendChild(start);

    const strip = document.createElement('div');
    strip.className = 'stack';
    state.program.forEach(b => strip.appendChild(renderCard(b, 0)));
    programEl.appendChild(strip);

    const end = document.createElement('div');
    end.className = 'endCap';
    programEl.appendChild(end);
  }
  const n = countCards();
  $('#progCount').textContent = n + ' 张卡片';
  $('#statMoves').textContent = n;
  renderPicker();
}

function renderCard(card, depth) {
  if (isSlot(card)) return renderSlotCard(card, depth);

  const el = document.createElement('div');
  el.className = 'card';
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
    if (loc) state.focus = loc.parent ? { parent: loc.parent, branch: loc.branch, index: loc.index } : null;
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
      '<span class="cond"><svg class="ic sm"><use href="#' + c.icon + '"/></svg>' +
      '<span class="lbl">' + c.label + '</span><span class="swap">⇄</span></span>' +
      '<span class="elseTgl">否则</span><span class="del">×</span>';
    head.querySelector('.cond').addEventListener('click', ev => {
      if (state.running) return;
      ev.stopPropagation(); snapshot(); openPicker('cond', card);
    });
    head.querySelector('.elseTgl').addEventListener('click', ev => {
      if (state.running) return;
      ev.stopPropagation(); snapshot();
      card.hasElse = !card.hasElse;
      renderProgram();
    });
  } else {
    head.innerHTML =
      '<svg class="ic"><use href="#i-repeat"/></svg>' +
      '<span class="num">' + (card.count || 3) + ' 次<span class="swap">⇄</span></span>' +
      '<span class="del">×</span>';
    head.querySelector('.num').addEventListener('click', ev => {
      if (state.running) return;
      ev.stopPropagation(); snapshot(); openPicker('num', card);
    });
  }
  head.querySelector('.del').addEventListener('click', ev => {
    if (state.running) return;
    ev.stopPropagation(); snapshot(); removeCard(card.id);
  });

  wrap.appendChild(head);
  wrap.appendChild(renderSocket(card, 'then', depth));
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
  body.className = 'socket' + (branch === 'else' ? ' elseSocket' : '');
  const inner = document.createElement('div');
  inner.className = 'stack';
  const kids = branchList(card, branch) || [];
  if (kids.length) kids.forEach(b => inner.appendChild(renderCard(b, depth + 1)));
  else {
    const hint = document.createElement('div');
    hint.className = 'socketHint';
    hint.innerHTML = '<span>把卡片塞进来</span>';
    body.appendChild(hint);
  }
  body.appendChild(inner);
  body.addEventListener('click', ev => {
    if (state.running) return;
    if (ev.target.closest('.card') || ev.target.closest('.slot')) return;
    state.focus = { parent: card, branch, index: (branchList(card, branch) || []).length };
    renderProgram();
  });
  return body;
}

/* ---------------- 选择器 ---------------- */
let pickerState = null;
function openPicker(mode, card) { pickerState = { mode, card }; renderPicker(); }
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
      b.addEventListener('click', () => { pickerState.card.cond = k; closePicker(); });
      items.appendChild(b);
    });
  } else {
    title.textContent = '重复几次？';
    REPEAT_NUMS.forEach(n => {
      const b = document.createElement('button');
      b.className = 'pkItem pkNum';
      b.innerHTML = '<span>' + n + '</span>';
      b.addEventListener('click', () => { pickerState.card.count = n; closePicker(); });
      items.appendChild(b);
    });
  }
}

/* ============================================================
   编译 + 执行
   卡片树 -> 扁平 ops。每只青蛙有自己的 pc / 循环栈，
   所有青蛙按同一套 ops 同步推进（hatch 出来的新青蛙从 0 开始）。
   ============================================================ */

function compileSeq(cards, list) {
  cards.forEach(card => {
    if (card.key === 'if') {
      const testIdx = list.length;
      list.push({ t: 'test', cond: card.cond, elseTarget: 0, cardId: card.id });
      compileSeq(card.children || [], list);
      const jmpIdx = list.length;
      list.push({ t: 'jmp', target: 0, cardId: card.id });
      const elseStart = list.length;
      compileSeq(card.elseChildren || [], list);
      list[testIdx].elseTarget = elseStart;
      list[jmpIdx].target = list.length;
    } else if (card.key === 'repeat') {
      if (!(card.children || []).length) return;
      list.push({ t: 'loop', count: Math.max(1, card.count || 1), bodyStart: list.length + 1, cardId: card.id });
      compileSeq(card.children, list);
      list.push({ t: 'loopend', cardId: card.id });
    } else {
      list.push({ t: 'act', key: card.key, cardId: card.id });
    }
  });
}

let ops = [];
function compileProgram() {
  ops = [];
  compileSeq(state.program, ops);
  return ops;
}

/* 条件判定（对某只青蛙） */
function testCond(f, cond) {
  // 「脚下」= 青蛙现在站的这格；「前面」= 下一格
  if (cond === 'abug') return !!beetleAt(f.q, f.r);          // 脚下有虫
  const a = aheadOf(f);
  const inGrid = isCell(a.q, a.r);
  const isWater = inGrid && holeAt(a.q, a.r);
  if (cond === 'water') return isWater || !inGrid;           // 前面是水/池边
  if (cond === 'empty') return inGrid && !isWater && !beetleAt(a.q, a.r);  // 前面是空荷叶
  if (cond === 'bug')   return inGrid && !isWater && !!beetleAt(a.q, a.r); // 前面有虫
  return false;
}

/* 执行一条 op，作用于一只青蛙。返回 'jump' 表示 pc 已改好 */
function execOpFor(f, op) {
  switch (op.t) {
    case 'act':
      doAction(f, op.key);
      return 'ok';
    case 'test':
      if (testCond(f, op.cond)) return 'ok';
      f.pc = op.elseTarget;
      return 'jump';
    case 'jmp':
      f.pc = op.target;
      return 'jump';
    case 'loop':
      f.loops.push({ count: op.count, seen: 0, bodyStart: op.bodyStart });
      return 'ok';
    case 'loopend': {
      const top = f.loops[f.loops.length - 1];
      if (!top) return 'ok';
      top.seen++;
      if (top.seen < top.count) { f.pc = top.bodyStart; return 'jump'; }
      f.loops.pop();
      return 'ok';
    }
  }
  return 'ok';
}

/* 一条指令对一只青蛙做了什么 */
function doAction(f, key) {
  switch (key) {
    case 'hop': {
      const a = aheadOf(f);
      if (!walkable(a.q, a.r)) { sfxError(); return; }
      f.q = a.q; f.r = a.r;
      sfxHop();
      break;
    }
    case 'left':  f.dir = (f.dir + 5) % NDIR; sfxTurn(); break;
    case 'right': f.dir = (f.dir + 1) % NDIR; sfxTurn(); break;
    case 'spin':  f.dir = (f.dir + 3) % NDIR; sfxTurn(); break;
    case 'chirp': sfxChirp(); break;
    case 'eat': {
      // 甲虫落在荷叶上 —— 青蛙站到那片叶子上就能吃掉它
      const b = beetleAt(f.q, f.r);
      if (!b) { sfxError(); return; }
      b.alive = false;
      state.eaten++;
      state.score += 10;
      updateStats();
      sfxEat();
      break;
    }
    case 'hatch': {
      if (state.frogs.filter(x => x.alive).length >= 12) return;
      const a = aheadOf(f);
      if (!walkable(a.q, a.r) || frogAt(a.q, a.r)) return;
      state.frogs.push({
        q: a.q, r: a.r, dir: f.dir, color: f.color, alive: true,
        x: 0, y: 0, hop: 0, hopFrom: null,
        pc: f.pc, loops: []
      });
      updateStats();
      sfxHatch();
      break;
    }
  }
}

/* ---------------- 运行循环 ---------------- */
let runTimer = null;
let ruleGuard = 0;

function runProgram() {
  if (state.running) { stopProgram(); return; }
  if (!state.program.length) { toast('先加几张卡片'); return; }
  compileProgram();
  if (!ops.length) { toast('程序里还没有能做的事'); return; }

  state.running = true;
  ruleGuard = 0;
  state.frogs.forEach(f => { f.pc = 0; f.loops = []; });
  if (!state.frogs.length) spawnStartFrog();
  $('#btnRun').querySelector('.nm').textContent = '停止';
  tickRun();
}

function stopProgram() {
  state.running = false;
  clearTimeout(runTimer);
  $('#btnRun').querySelector('.nm').textContent = '运行';
  highlightRun(-1);
}

function currentOpCardId() {
  const f = state.frogs[0];
  if (!f || f.pc >= ops.length) return -1;
  return ops[f.pc].cardId;
}

function highlightRun(id) {
  programEl.querySelectorAll('.active').forEach(e => e.classList.remove('active'));
  if (id < 0) return;
  const el = programEl.querySelector('[data-id="' + id + '"]');
  if (!el) return;
  el.classList.add('active');
  // 让正在执行的那张卡片始终可见
  const wrap = $('#program');
  if (wrap) {
    const a = el.getBoundingClientRect(), b = wrap.getBoundingClientRect();
    if (a.top < b.top + 4) wrap.scrollTop -= (b.top + 4 - a.top);
    else if (a.bottom > b.bottom - 4) wrap.scrollTop += (a.bottom - b.bottom + 4);
  }
}

function tickRun() {
  if (!state.running) return;

  const live = state.frogs.filter(f => f.alive);
  if (!live.length) { stopProgram(); return; }

  // 所有青蛙都跑完了吗？
  const busy = live.filter(f => f.pc < ops.length);
  if (!busy.length) {
    stopProgram();
    setTimeout(checkWin, 250);
    return;
  }

  let acted = false;
  busy.forEach(f => {
    if (f.pc >= ops.length) return;
    const op = ops[f.pc];
    const r = execOpFor(f, op);
    if (r !== 'jump') f.pc++;
    acted = true;
  });

  draw();
  highlightRun(currentOpCardId());

  if (++ruleGuard > 3000) { stopProgram(); toast('跑太多步了，停下来休息一下'); return; }
  runTimer = setTimeout(tickRun, 520 / state.speed);
}

function stepOnce() {
  if (state.running) return;
  if (!ops.length) { compileProgram(); state.frogs.forEach(f => { f.pc = 0; f.loops = []; }); }
  if (!state.frogs.length) spawnStartFrog();
  const live = state.frogs.filter(f => f.alive && f.pc < ops.length);
  if (!live.length) { toast('程序已经跑完了'); return; }
  live.forEach(f => {
    const op = ops[f.pc];
    const r = execOpFor(f, op);
    if (r !== 'jump') f.pc++;
  });
  draw();
  highlightRun(currentOpCardId());
}

function spawnStartFrog() {
  const L = LEVELS[state.level];
  const st = (L.frogs && L.frogs[0]) || { q: 0, r: 0, dir: 0 };
  state.frogs.push({
    q: st.q, r: st.r, dir: st.dir || 0, color: state.frogColor, alive: true,
    x: 0, y: 0, hop: 0, hopFrom: null, pc: 0, loops: []
  });
}

/* ---------------- 过关 ---------------- */
function checkWin() {
  const left = state.beetles.filter(b => b.target && b.alive).length;
  const par = LEVELS[state.level].par || 8;
  if (state.targetLeft > 0 && left === 0) {
    const used = countCards();
    const perfect = used <= par;
    $('#ovTitle').textContent = perfect ? '完美！' : '过关！';
    $('#ovBody').textContent = perfect
      ? `你用 ${used} 张卡片吃掉了全部甲虫，非常高效。`
      : `你用 ${used} 张卡片吃掉了全部甲虫，试试 ${par} 张以内？`;
    setOverlayIcon('i-trophy');
    const next = state.level + 1 < LEVELS.length;
    showOverlay(next ? '下一课' : '再玩一次', () => {
      hideOverlay();
      if (next) loadLevel(state.level + 1); else loadLevel(0);
    });
  }
}

function updateStats() {
  const left = state.beetles.filter(b => b.alive && b.target).length;
  const be = $('#statBeetles'); if (be) be.textContent = left;
  const lv = $('#statLevel'); if (lv) lv.textContent = state.level + 1;
  const sc = $('#statScore'); if (sc) sc.textContent = state.score;
}

/* ---------------- 覆盖层 / 提示 ---------------- */
function setOverlayIcon(id) {
  const el = $('#ovIcon');
  if (el) el.innerHTML = '<use href="#' + id + '"/>';
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
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

/* ---------------- 交互 ---------------- */
function bindUI() {
  document.querySelectorAll('.pal[data-block]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.running) return;
      addBlock(btn.dataset.block);
    });
  });

  $('#btnRun').addEventListener('click', runProgram);
  $('#btnStep').addEventListener('click', stepOnce);
  $('#btnClear').addEventListener('click', clearProgram);
  $('#btnUndo').addEventListener('click', undoBlock);

  const rs = $('#btnReset');
  if (rs) rs.addEventListener('click', () => { stopProgram(); loadLevel(state.level); });
  const sb = $('#btnSound');
  if (sb) sb.addEventListener('click', ev => {
    state.sound = !state.sound;
    ev.currentTarget.innerHTML = '<svg class="ic"><use href="#' + (state.sound ? 'i-sound' : 'i-mute') + '"/></svg>';
    if (state.sound) blip(700, .07, 'sine', .04);
  });
  const hp = $('#btnHelp');
  if (hp) hp.addEventListener('click', showHelp);

  const pc = document.getElementById('pickerCancel');
  if (pc) pc.addEventListener('click', closePicker);

  // 点池塘：把青蛙放上去（自由探索）
  canvas.addEventListener('pointerdown', ev => {
    if (state.running) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const c = hexAtPoint(x, y);
    if (!c) return;
    const f = state.frogs[0];
    if (!f) return;
    if (!walkable(c.q, c.r) || frogAt(c.q, c.r)) return;
    // 只允许跳到相邻的一格
    const dq = c.q - f.q, dr = c.r - f.r;
    const di = DIRS.findIndex(d => d.dq === dq && d.dr === dr);
    if (di < 0) return;
    f.dir = di; f.q = c.q; f.r = c.r;
    sfxHop(); draw();
  });

  window.addEventListener('resize', () => { resize(); draw(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { resize(); draw(); }, 220));
}

/* 找到点在哪一格 */
function hexAtPoint(px, py) {
  let best = null, bestD = Infinity;
  for (const c of CELLS) {
    const p = cellCenter(c.q, c.r);
    const d = Math.hypot(px - p.x, py - p.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD < hexR * .95 ? best : null;
}

function showHelp() {
  $('#ovTitle').textContent = '怎么玩';
  setOverlayIcon('i-frog');
  $('#ovBody').textContent =
    '① 点下面的卡片，把命令排进程序。\n' +
    '② 按 ▶ 让它跑起来。\n' +
    '③ 让青蛙走到甲虫面前，用「吃」吃掉它。\n\n' +
    '「如果」和「重复」可以把别的卡片塞进凹槽里。\n' +
    '试试「孵」——它会变出一只新青蛙，跟着一起做！';
  showOverlay('知道了', hideOverlay);
}

/* ---------------- 启动 ---------------- */
function boot() {
  resize();
  bindUI();
  loadLevel(0);

  const L = LEVELS[0];
  $('#ovTitle').textContent = L.name;
  $('#ovBody').textContent = L.hint || '';
  setOverlayIcon('i-frog');
  if (location.hash === '#skip') hideOverlay();
  else showOverlay('开始', hideOverlay);

  setInterval(() => {
    updateBeetles(Date.now());
    if (!state.running) draw();
    else draw();
  }, 50);
}

boot();
