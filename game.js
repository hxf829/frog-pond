/* ============================================================
   Frog Pond — CHM 展项复刻（Iteration 3 规格）
   - 六边形网格：青蛙在 6 个方向之间跳
   - 甲虫落在网格交点上，用 eat 指令吃掉
   - 指令：hop / chirp / eat / left / right / spin
   - 控制结构：if-else / repeat（可嵌套）
   - 程序纵向堆叠，运行时高亮当前卡片
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

const LEAVES = [
  { q: -2, r: .2, radius: 3.55, notch: 4.5, tone: .4 },
  { q: 1.8, r: -.2, radius: 3.35, notch: 5.8, tone: .6 },
  { q: 2.2, r: -3.8, radius: 2.90, notch: 4.5, tone: .3 },
  { q: -2.6, r: 3.7, radius: 2.75, notch: 1.5, tone: .5 },
  { q: -1.25, r: -3.15, radius: 2.08, notch: 2.9, tone: .25 },
  { q: 2.05, r: 2.55, radius: 1.85, notch: .4, tone: .7 },
  { q: -4.9, r: 2.9, radius: 1.38, notch: 2.5, tone: .3 },
  { q: 4.25, r: -2.8, radius: 1.35, notch: 5.5, tone: .55 },
  { q: -3.2, r: 6.05, radius: .95, notch: 1.6, tone: .45 }
];

const LEAF_NOTCH = .2;
const LEAF_TIP = .68;
const LEAF_MAX_SCALE = 1.09;

function leafEdgeScale(leaf, angle) {
  const phase = leaf.tone * 9 + leaf.q * .4 + leaf.r * .2;
  return 1 + .05 * Math.cos(2 * angle + phase) + .023 * Math.sin(3 * angle + phase * .7)
    + .014 * Math.sin(5 * angle + phase * 1.3);
}

const LEAF_OUTLINES = new Map(LEAVES.map(leaf => {
  const points = [];
  for (let index = 0; index <= 96; index++) {
    const angle = leaf.notch + LEAF_NOTCH + (Math.PI * 2 - LEAF_NOTCH * 2) * index / 96;
    const scale = leafEdgeScale(leaf, angle);
    points.push({ x: Math.cos(angle) * scale, y: Math.sin(angle) * scale });
  }
  return [leaf, points];
}));

function leafCoversPoint(leaf, q, r, margin = 1) {
  const x = Math.sqrt(3) * (q - leaf.q + (r - leaf.r) / 2);
  const y = 1.5 * (r - leaf.r);
  const distance = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  if (distance > leaf.radius * leafEdgeScale(leaf, angle) * margin) return false;
  const relative = Math.atan2(Math.sin(angle - leaf.notch), Math.cos(angle - leaf.notch));
  const notchDistance = Math.abs(relative);
  if (notchDistance >= LEAF_NOTCH) return true;
  const edgeAngle = leaf.notch + (relative >= 0 ? LEAF_NOTCH : -LEAF_NOTCH);
  const edge = leaf.radius * leafEdgeScale(leaf, edgeAngle);
  const tip = leaf.radius * LEAF_TIP;
  const notchLimit = tip * edge * Math.sin(LEAF_NOTCH) / (edge * Math.sin(LEAF_NOTCH) * Math.cos(notchDistance)
    - (edge * Math.cos(LEAF_NOTCH) - tip) * Math.sin(notchDistance));
  return distance <= notchLimit;
}

const leafContains = (leaf, q, r) => leafCoversPoint(leaf, q, r, .9);

const minQ = Math.floor(Math.min(...LEAVES.map(leaf => leaf.q - leaf.radius * LEAF_MAX_SCALE * 2 / 3)));
const maxQ = Math.ceil(Math.max(...LEAVES.map(leaf => leaf.q + leaf.radius * LEAF_MAX_SCALE * 2 / 3)));
const minR = Math.floor(Math.min(...LEAVES.map(leaf => leaf.r - leaf.radius * LEAF_MAX_SCALE * 2 / 3)));
const maxR = Math.ceil(Math.max(...LEAVES.map(leaf => leaf.r + leaf.radius * LEAF_MAX_SCALE * 2 / 3)));
const CELLS = [];
for (let q = minQ; q <= maxQ; q++) {
  for (let r = minR; r <= maxR; r++) {
    if (LEAVES.some(leaf => leafContains(leaf, q, r))) CELLS.push({ q, r });
  }
}
const cellKey = (q, r) => q + ',' + r;
const CELL_MAP = new Map(CELLS.map(c => [cellKey(c.q, c.r), c]));
const routeKey = (q, r, nextQ, nextR) => [cellKey(q, r), cellKey(nextQ, nextR)].sort().join('|');
const MAX_WATER_GAP = .3;

function routeWaterGap(q, r, nextQ, nextR) {
  const samples = 64;
  let longest = 0, current = 0;
  for (let step = 1; step < samples; step++) {
    const part = step / samples;
    const sampleQ = q + (nextQ - q) * part;
    const sampleR = r + (nextR - r) * part;
    if (LEAVES.some(leaf => leafCoversPoint(leaf, sampleQ, sampleR))) current = 0;
    else longest = Math.max(longest, ++current);
  }
  return longest * Math.sqrt(3) / samples;
}

const ROUTES = new Set();
for (const cell of CELLS) {
  for (const direction of DIRS.slice(0, 3)) {
    const nextQ = cell.q + direction.dq, nextR = cell.r + direction.dr;
    if (CELL_MAP.has(cellKey(nextQ, nextR))
        && routeWaterGap(cell.q, cell.r, nextQ, nextR) <= MAX_WATER_GAP) {
      ROUTES.add(routeKey(cell.q, cell.r, nextQ, nextR));
    }
  }
}

/* ---------------- 颜色 ---------------- */
const BEETLE_COLORS = [
  { name: 'red', label: '红色', body: '#ff7a63', mid: '#e23b2c', dark: '#8f1a12', spot: '#2a0f0c' },
  { name: 'yellow', label: '黄色', body: '#ffc93c', mid: '#e09a12', dark: '#96650c', spot: '#3a2a08' },
  { name: 'blue', label: '蓝色', body: '#63c8f5', mid: '#2b8ec6', dark: '#14567c', spot: '#0d2a3a' },
  { name: 'white', label: '白色', body: '#fbfcfc', mid: '#b9c1c6', dark: '#79838a', spot: '#1b2226' }
];
const FROG_COLORS = [
  { name: 'green', body: '#4cc45a', dark: '#2f8f3d', light: '#7ee88a' },
  { name: 'gold',  body: '#f0c04a', dark: '#b78a1c', light: '#ffe08a' },
  { name: 'blue',  body: '#4fb8e8', dark: '#2279ad', light: '#9ddcff' },
  { name: 'pink',  body: '#f07aa8', dark: '#b8467a', light: '#ffb6d1' }
];
const FROG_RADIUS_RATIO = .4;
const BEETLE_RADIUS_RATIO = .25;

/* ---------------- 指令卡片 ---------------- */
const BLOCKS = {
  hop:   { label: '跳',   icon: 'i-hop' },
  chirp: { label: '叫',   icon: 'i-chirp' },
  eat:   { label: '吃',   icon: 'i-eat' },
  left:  { label: '左转', icon: 'i-left' },
  right: { label: '右转', icon: 'i-right' },
  spin:  { label: '转身', icon: 'i-spin' },
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
  eatenByColor: BEETLE_COLORS.map(() => 0),
  completedLevels: new Set(),
  winning: false,
  targetLeft: 0,
  eatAnimations: [],
  frogColor: 0,         // 当前在编辑哪种颜色的青蛙
  speed: 1
};

const execution = {
  cardId: -1,
  branch: null,
  text: '搭好积木，按运行看看',
  kind: 'idle',
  conditions: new Map(),
  loops: new Map()
};

const POP = {
  max: 6,
  spawnEvery: 5000,
  nextSpawnAt: 0,
  visitors: true,
  nextFlyAt: 0,
  // 换虫分两步：新虫先飞进来，快落地时才让旧虫起飞。
  // 这样任何时候荷叶上都还有 6 只，不会出现「少了一只」的空档。
  evictPending: null
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
    name: '自由池塘',
    free: true,
    frogs: [{ q: -2, r: 0, dir: 0 }],
    beetles: [[-1, 0], [0, 0], [1, -1]],
    holes: [],
    hint: '点积木，再按 ▶，让青蛙去吃虫子！'
  },
  {
    name: '第一课：吃掉甲虫',
    frogs: [{ q: -2, r: 0, dir: 0 }],
    beetles: [[-1, 0], [0, 0], [1, 0], [2, 0]],
    holes: [],
    par: 4,
    hint: '让青蛙面对旁边的甲虫，\n再用「吃」伸出舌头。'
  },
  {
    name: '第二课：水面挡路',
    frogs: [{ q: -2, r: 1, dir: 0 }],
    beetles: [[1, 0], [2, -1], [-1, 0], [0, 0]],
    holes: [[-1, 1], [0, 1]],
    par: 9,
    hint: '水面上没有落脚点，跳不过去。\n沿着荷叶上的路线绕过去。'
  },
  {
    name: '第三课：重复',
    frogs: [{ q: -2, r: 1, dir: 0 }],
    beetles: [[-1, 1], [0, 1], [1, 1], [2, 1]],
    holes: [],
    par: 4,
    hint: '一整排甲虫，一张一张点太慢了。\n把「跳」和「吃」放进「重复」里。'
  },
  {
    name: '第四课：如果',
    frogs: [{ q: -2, r: 0, dir: 0 }],
    beetles: [[-1, 0], [0, 0], [1, 0], [2, 0]],
    holes: [],
    par: 6,
    hint: '让青蛙自己判断：\n前面有虫子就吃掉它。'
  },
  {
    name: '第五课：绕一绕',
    frogs: [{ q: -1, r: 0, dir: 0 }],
    beetles: [[0, 0], [-1, 1], [-2, 1], [0, 1]],
    holes: [],
    par: 6,
    hint: '吃掉第一只虫子后，\n转一转，面对另一只。'
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
  for (const leaf of LEAVES) {
    const x = Math.sqrt(3) * (leaf.q + leaf.r / 2);
    const y = 1.5 * leaf.r;
    const radius = leaf.radius * LEAF_MAX_SCALE;
    minX = Math.min(minX, x - radius); maxX = Math.max(maxX, x + radius);
    minY = Math.min(minY, y - radius); maxY = Math.max(maxY, y + radius);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const canvasRect = canvas.getBoundingClientRect();
  const panelRect = $('#panel').getBoundingClientRect();
  let areaLeft = 0, areaWidth = W, areaHeight = H;
  if (panelRect.width < canvasRect.width * .8) {
    areaLeft = Math.min(W - 48, Math.max(0, panelRect.right - canvasRect.left + 8));
    areaWidth = W - areaLeft;
  } else {
    areaHeight = Math.max(48, Math.min(H, panelRect.top - canvasRect.top - 8));
  }
  hexR = Math.max(1, Math.min((areaWidth - 48) / spanX, (areaHeight - 48) / spanY));
  ox = areaLeft + areaWidth / 2 - hexR * (minX + maxX) / 2;
  oy = areaHeight / 2 - hexR * (minY + maxY) / 2;
}

/* ---------------- 音效 ---------------- */
let actx = null;
let frogCroakBufferPromise = null;
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
function prepareFrogCroak() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    if (!frogCroakBufferPromise) {
      const context = actx;
      frogCroakBufferPromise = fetch(window.frogCroakDataURL || 'frog-croak.mp3')
        .then(response => {
          if (!response.ok) throw new Error('Failed to load frog sound');
          return response.arrayBuffer();
        })
        .then(data => context.decodeAudioData(data))
        .catch(() => { frogCroakBufferPromise = null; return null; });
    }
    return frogCroakBufferPromise;
  } catch (e) { return Promise.resolve(null); }
}
function sfxChirp() {
  if (!state.sound) return;
  prepareFrogCroak().then(buffer => {
    if (!buffer || !state.sound) return;
    const source = actx.createBufferSource();
    source.buffer = buffer;
    source.connect(actx.destination);
    source.start();
  }).catch(() => {});
}
const sfxHatch = () => [400, 560, 760, 980].forEach((f, i) => setTimeout(() => blip(f, .10, 'triangle', .05), i * 60));
const sfxError = () => blip(150, .18, 'sawtooth', .04);
const sfxFly   = () => { blip(900, .06, 'sine', .02); setTimeout(() => blip(1250, .06, 'sine', .018), 50); };
const sfxLand  = () => blip(420, .07, 'sine', .025);

/* ---------------- 关卡加载 ---------------- */
function loadLevel(i) {
  clearTimeout(winTimer);
  $('#victory').hidden = true;
  state.winning = false;
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
    state.beetles.push(makeBeetle(q, r, k % BEETLE_COLORS.length, now, !L.free));
  });

  state.targetLeft = state.beetles.length;
  state.eaten = 0;
  state.eatenByColor = BEETLE_COLORS.map(() => 0);
  state.score = 0;
  state.eatAnimations = [];
  state.program = [];
  state.focus = null;
  state.undoStack = [];
  state.running = false;
  resetExecution();
  closePicker();
  state.frogColor = 0;
  state.frogs.forEach(f => f.color = 0);

  POP.nextSpawnAt = 0;
  POP.nextFlyAt = 0;
  POP.evictPending = null;
  POP.visitors = !!L.free;

  ops = [];
  renderProgram();
  updateStats();
  draw();
}

/* ---------------- 六边形辅助 ---------------- */
function isCell(q, r) { return CELL_MAP.has(cellKey(q, r)); }
function holeAt(q, r) { return state.holes.some(h => h.q === q && h.r === r); }
function walkable(q, r) { return isCell(q, r) && !holeAt(q, r); }
function canHop(q, r, nextQ, nextR) {
  return walkable(q, r) && walkable(nextQ, nextR) && ROUTES.has(routeKey(q, r, nextQ, nextR));
}

/* 青蛙朝向前方那格 */
function aheadOf(f) {
  const d = DIRS[f.dir];
  return { q: f.q + d.dq, r: f.r + d.dr };
}

function frogAt(q, r) {
  return state.frogs.find(f => f.alive && f.q === q && f.r === r) || null;
}
function beetleAt(q, r) {
  return state.beetles.find(b => b.alive && !b.flying && !b.leaving && !b.arriving && b.q === q && b.r === r) || null;
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
  const spd = FLY.cruiseSpeed * 4.2;   // 离场飞得快一点，2 秒左右飞出画面
  b.vx = Math.cos(a) * spd; b.vy = Math.sin(a) * spd;
  b.climb = FLY.climbRate * 1.2;
  b.height = Math.max(b.height, .35);
  sfxFly();
}

function beetleStep(b, dt, now) {
  if (b.leaving) {
    // 速度单位是「格/秒」，乘 hexR 换成像素/秒
    b.x += b.vx * hexR * dt;
    b.y += b.vy * hexR * dt;
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
    // 刚飞进来的那只：一路高速飞到自己的荷叶，别在画面外磨蹭太久
    want = (b.arriving && toHome > 0.8) ? FLY.cruiseSpeed * 5.0
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

  b.x += b.vx * hexR * dt;
  b.y += b.vy * hexR * dt;
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

  // 起点必须严格在画面外（画布四边之外），否则会「凭空出现」。
  // 随机挑一条边，沿这条边在画布外 60~160px 处出生，再飞向自己的荷叶。
  const margin = 60 + Math.random() * 100;
  const side = Math.floor(Math.random() * 4);
  if (side === 0)      { b.x = -margin;              b.y = c.y; }
  else if (side === 1) { b.x = W + margin;           b.y = c.y; }
  else if (side === 2) { b.x = c.x;                  b.y = -margin; }
  else                 { b.x = c.x;                  b.y = H + margin; }

  b.flying = true; b.arriving = true; b.returning = true;
  b.height = .5; b.climb = 0;
  b.angle = Math.atan2(c.y - b.y, c.x - b.x);
  b.perchUntil = now + 900;
  return b;
}

function updateBeetles(now) {
  // 教学关的目标虫留在荷叶上，让孩子有时间观察和尝试。
  if (!POP.visitors) { state.beetles = state.beetles.filter(b => b.alive); updateStats(); return; }
  if (!POP.nextSpawnAt) POP.nextSpawnAt = now + POP.spawnEvery;

  /* 计数口径：只算「停在荷叶上」的虫（不含正在飞入 / 正在离场）。
     这一组任何时候都不允许超过 POP.max。 */
  const onPads = () => state.beetles.filter(b => b.alive && !b.leaving && !b.arriving);

  // 换虫期间旧虫可能被吃掉；不能让失效的引用阻止后续新虫飞入。
  if (POP.evictPending && (!POP.evictPending.alive || POP.evictPending.leaving)) POP.evictPending = null;
  // 换虫第二步：新虫快落到荷叶上时，旧的那只才起飞离场
  if (POP.evictPending && POP.evictPending.alive && !POP.evictPending.leaving) {
    const old = POP.evictPending;
    const nb = state.beetles.find(b => b.alive && b.arriving);
    const near = nb
      ? Math.hypot(nb.x - cellCenter(nb.q, nb.r).x, nb.y - cellCenter(nb.q, nb.r).y) / hexR < 1.6
      : true;
    if (near) { beetleLeave(old, now); POP.evictPending = null; }
  }

  if (POP.visitors && now >= POP.nextSpawnAt) {
    POP.nextSpawnAt = now + POP.spawnEvery;
    const pads = onPads();

    if (POP.evictPending) {
      // 上一组还没换完 —— 这一拍跳过（不会叠加）
    } else if (pads.length >= POP.max) {
      // 满了：新虫先飞进来，旧虫继续留在荷叶上，
      // 等新虫快到时旧虫才起飞 —— 荷叶上不会出现空位。
      const cand = pads[Math.floor(Math.random() * pads.length)];
      const nb = spawnBeetle(now, cand.q, cand.r, cand.target ? cand.color : null);
      if (nb) {
        // 目标甲虫的身份要「转交」给新虫：旧的那只飞走时就不再算目标，
        // 否则目标数量会越换越少，关卡就永远赢不了了。
        nb.target = !!cand.target;
        if (cand.target) {
          cand.target = false;          // 目标身份已经交给新虫
          nb.home = { q: cand.home.q, r: cand.home.r };
        }
        state.beetles.push(nb);
        POP.evictPending = cand;
      }
    } else if (!state.beetles.some(b => b.alive && b.arriving)) {
      // 没满，而且没有正在飞入的 —— 放一只进来
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
  drawTongues();
  drawBeetles();
  drawFrogs();
}

function eatAnimationPoints(animation, now) {
  const progress = Math.max(0, Math.min(1, (now - animation.at) / 650));
  const reach = progress < .35 ? progress / .35 : (1 - progress) / .65;
  const origin = cellCenter(animation.q, animation.r);
  const target = cellCenter(animation.beetle.q, animation.beetle.r);
  const angle = dirAngle(animation.dir);
  const mouth = { x: origin.x + Math.cos(angle) * hexR * FROG_RADIUS_RATIO * .7,
    y: origin.y - hexR * .22 + Math.sin(angle) * hexR * FROG_RADIUS_RATIO * .7 };
  const tip = { x: mouth.x + (target.x - mouth.x) * reach,
    y: mouth.y + (target.y - hexR * .07 - mouth.y) * reach };
  return { progress, mouth, tip, target };
}

function drawTongues() {
  const now = Date.now();
  state.eatAnimations = state.eatAnimations.filter(animation => now - animation.at < 650);
  state.eatAnimations.forEach(animation => {
    const points = eatAnimationPoints(animation, now);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, hexR * .12);
    ctx.strokeStyle = '#e65070';
    ctx.beginPath();
    ctx.moveTo(points.mouth.x, points.mouth.y);
    ctx.lineTo(points.tip.x, points.tip.y);
    ctx.stroke();
    ctx.fillStyle = '#ff9cb0';
    ctx.beginPath();
    ctx.arc(points.tip.x, points.tip.y, Math.max(2, hexR * .09), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
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

function leafPath(cx, cy, r, leaf) {
  ctx.beginPath();
  LEAF_OUTLINES.get(leaf).forEach((point, index) => {
    const x = cx + point.x * r, y = cy + point.y * r;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(cx + Math.cos(leaf.notch) * r * LEAF_TIP, cy + Math.sin(leaf.notch) * r * LEAF_TIP);
  ctx.closePath();
}

function drawHexPads() {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  for (const hole of state.holes) {
    const p = cellCenter(hole.q, hole.r);
    ctx.moveTo(p.x + hexR * .7, p.y);
    ctx.arc(p.x, p.y, hexR * .7, 0, Math.PI * 2);
  }
  ctx.clip('evenodd');

  for (const leaf of LEAVES) {
    const p = cellCenter(leaf.q, leaf.r);
    const r = hexR * leaf.radius;

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    leafPath(p.x + r * .03, p.y + r * .07, r, leaf);
    ctx.fill();

    const g = ctx.createRadialGradient(p.x - r * .3, p.y - r * .35, r * .15, p.x, p.y, r);
    g.addColorStop(0, `hsl(${118 + leaf.tone * 12}, 63%, ${39 + leaf.tone * 7}%)`);
    g.addColorStop(1, `hsl(${125 + leaf.tone * 10}, 70%, ${21 + leaf.tone * 5}%)`);
    ctx.fillStyle = g;
    leafPath(p.x, p.y, r, leaf);
    ctx.fill();

    ctx.strokeStyle = 'rgba(191,255,174,0.12)';
    ctx.lineWidth = Math.max(1, r * .012);
    for (let i = 0; i < 7; i++) {
      const a = leaf.notch + 0.5 + i * (Math.PI * 2 - 1) / 6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const veinLength = r * leafEdgeScale(leaf, a) * .92;
      ctx.lineTo(p.x + Math.cos(a) * veinLength, p.y + Math.sin(a) * veinLength);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(178,255,166,0.24)';
    ctx.lineWidth = Math.max(1, r * .018);
    leafPath(p.x, p.y, r * .99, leaf);
    ctx.stroke();
  }
  ctx.restore();

  state.holes.forEach(hole => drawWaterHole(cellCenter(hole.q, hole.r)));

  ctx.save();
  ctx.strokeStyle = 'rgba(181,255,190,0.36)';
  ctx.lineWidth = Math.max(1, hexR * .035);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const c of CELLS) {
    if (!walkable(c.q, c.r)) continue;
    const p = cellCenter(c.q, c.r);
    for (const [dq, dr] of [[1, 0], [0, 1], [-1, 1]]) {
      if (!canHop(c.q, c.r, c.q + dq, c.r + dr)) continue;
      const n = cellCenter(c.q + dq, c.r + dr);
      ctx.moveTo(p.x, p.y); ctx.lineTo(n.x, n.y);
    }
  }
  ctx.stroke();

  for (const c of CELLS) {
    if (!walkable(c.q, c.r)) continue;
    const p = cellCenter(c.q, c.r);
    ctx.fillStyle = 'rgba(227,255,210,0.65)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, hexR * .065), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWaterHole(p) {
  const r = hexR * .7;
  ctx.fillStyle = 'rgba(2,18,24,0.45)';
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
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
  const caught = state.eatAnimations.map(animation => ({ ...animation.beetle, animation }));
  [...state.beetles, ...caught].forEach(b => {
    if (!b.alive && !b.animation) return;
    const home = cellCenter(b.q, b.r);
    let p = b.flying
      ? { x: b.x, y: b.y - b.height * hexR }
      : { x: home.x, y: home.y - hexR * .07 };
    let scale = 1;
    if (b.animation) {
      const points = eatAnimationPoints(b.animation, now);
      if (points.progress >= .35) {
        p = points.tip;
        scale = Math.max(.1, (1 - points.progress) / .65);
      }
    }
    const bob = b.flying || b.animation ? 0 : Math.sin(now / 500 + b.phase) * hexR * .03;
    const r = hexR * BEETLE_RADIUS_RATIO * scale;
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
    let c = cellCenter(f.q, f.r);
    let jump = 0;
    if (f.hopFrom) {
      const t = Math.min(1, (now - f.hopFrom.at) / 340);
      if (t < 1) {
        const from = cellCenter(f.hopFrom.q, f.hopFrom.r);
        c = { x: from.x + (c.x - from.x) * t, y: from.y + (c.y - from.y) * t };
        jump = Math.sin(Math.PI * t) * hexR * .45;
      } else f.hopFrom = null;
    }
    const r = hexR * FROG_RADIUS_RATIO;
    const col = FROG_COLORS[f.color % FROG_COLORS.length];
    const breathe = 1 + Math.sin(now / 420 + f.q) * .03;

    ctx.save();
    ctx.translate(c.x, c.y - hexR * .22 - jump);

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
    if (f.actionUntil > now && f.actionLabel) {
      ctx.save();
      ctx.font = `bold ${Math.max(12, hexR * .26)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bx = c.x, by = c.y - hexR * 1.05 - jump;
      ctx.fillStyle = '#fff7d2';
      ctx.beginPath();
      ctx.ellipse(bx, by, hexR * .36, hexR * .24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#174a37';
      ctx.fillText(f.actionLabel, bx, by);
      ctx.restore();
    }
  });
}

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
const focusList = f => f.parent ? branchList(f.parent, f.branch) : state.program;

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
  const list = f ? focusList(f) : state.program;
  const index = f ? Math.min(f.index, list.length) : list.length;
  list.splice(index, 0, card);
  state.focus = isSlot(card) ? { parent: card, branch: 'then', index: 0 }
    : { parent: f ? f.parent : null, branch: f ? f.branch : 'then', index: index + 1 };
  renderProgram();
  blip(600, .05, 'sine', .03);
}

function removeCard(id) {
  if (state.running) return;
  const loc = findCard(id);
  if (!loc) return;
  loc.list.splice(loc.index, 1);
  state.focus = null;
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
  snapshot();
  state.program = [];
  state.focus = null;
  renderProgram();
}

function resetProgram() {
  stopProgram();
  state.program = [];
  state.focus = null;
  state.undoStack = [];
  ops = [];
  compiledSource = '';
  state.frogs.forEach(f => { f.pc = 0; f.loops = []; });
  resetExecution();
  closePicker();
  renderProgram();
  programEl.scrollTop = 0;
}

function countCards(list) {
  list = list || state.program;
  let n = 0;
  list.forEach(b => {
    n++;
    if (isSlot(b)) {
      n += countCards(b.children);
      if (b.key === 'if' && b.hasElse) n += countCards(b.elseChildren);
    }
  });
  return n;
}

/* ---------------- 渲染程序栈 ---------------- */
function renderProgram() {
  // 仅在内容变更时丢弃旧指令；选择插入位置不会打断单步。
  if (!state.running && compiledSource !== JSON.stringify(state.program)) {
    ops = [];
    state.frogs.forEach(f => { f.pc = 0; f.loops = []; });
    resetExecution();
  }
  programEl.innerHTML = '';
  if (!state.program.length) {
    const empty = document.createElement('div');
    empty.id = 'progEmpty';
    empty.innerHTML = '<svg class="ic sm"><use href="#i-tap"/></svg><span>点积木，或拖到这里</span>';
    programEl.appendChild(empty);
    programEl._drop = { parent: null, branch: 'then', index: 0 };
  } else {
    programEl._drop = { parent: null, branch: 'then', index: state.program.length };
    const strip = document.createElement('div');
    strip.className = 'stack';
    renderStack(strip, state.program, null, 'then', 0);
    programEl.appendChild(strip);
  }
  const n = countCards();
  $('#progCount').textContent = n + ' 块积木';
  $('#statMoves').textContent = n;
  renderPicker();
  renderExecution();
}

function renderStack(el, cards, parent, branch, depth) {
  for (let i = 0; i <= cards.length; i++) {
    const point = document.createElement('div');
    point.className = 'insertPoint';
    if (state.focus && state.focus.parent === parent && state.focus.branch === branch && state.focus.index === i) {
      point.classList.add('selected');
    }
    point.addEventListener('click', ev => {
      ev.stopPropagation();
      if (state.running || suppressDragClick()) return;
      state.focus = { parent, branch, index: i };
      renderProgram();
    });
    point._drop = { parent, branch, index: i };
    el.appendChild(point);
    if (i < cards.length) {
      const item = renderCard(cards[i], depth);
      item._dropBefore = { parent, branch, index: i };
      item._dropAfter = { parent, branch, index: i + 1 };
      el.appendChild(item);
    }
  }
}

// 使用 Pointer Events，鼠标和 iPad 都能拖动；轻点仍然是原来的添加操作。
let dragging = null;
let ignoreClickUntil = 0;
function suppressDragClick() { return Date.now() < ignoreClickUntil; }
function beginDrag(ev, source) {
  if (state.running || ev.button !== 0 || ev.target.closest('.del, .cond, .num, .elseTgl')) return;
  if (dragging) return;
  dragging = { source, x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId, active: false };
}
function dragTarget(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const point = hit.closest('.insertPoint');
  if (point) return { element: point, drop: point._drop };
  const card = hit.closest('.card, .slotHead');
  const item = card && (card.classList.contains('slotHead') ? card.parentElement : card);
  if (item && item._dropBefore) {
    const rect = item.getBoundingClientRect();
    return { element: item, drop: y < rect.top + rect.height / 2 ? item._dropBefore : item._dropAfter };
  }
  const element = hit.closest('.socket, #program');
  return element ? { element, drop: element._drop } : null;
}
function dragMove(ev) {
  if (!dragging || ev.pointerId !== dragging.pointerId) return;
  if (!dragging.active && Math.hypot(ev.clientX - dragging.x, ev.clientY - dragging.y) < 10) return;
  if (!dragging.active && ev.pointerType === 'touch' && dragging.source.id &&
      programEl.scrollHeight > programEl.clientHeight + 2 &&
      Math.abs(ev.clientY - dragging.y) > Math.abs(ev.clientX - dragging.x)) {
    const scroll = programEl;
    const previous = dragging.y;
    dragging.y = ev.clientY;
    dragging.x = ev.clientX;
    scroll.scrollTop -= ev.clientY - previous;
    dragging.scrolling = true;
    ev.preventDefault();
    return;
  }
  if (dragging.scrolling) {
    programEl.scrollTop -= ev.clientY - dragging.y;
    dragging.y = ev.clientY;
    ev.preventDefault();
    return;
  }
  if (!dragging.active) {
    dragging.active = true;
    const ghost = document.createElement('div');
    ghost.className = 'dragGhost';
    const loc = dragging.source.id && findCard(dragging.source.id);
    const card = loc && loc.list[loc.index];
    const key = dragging.source.key || (card && card.key);
    if (!key || !BLOCKS[key]) { dragging = null; return; }
    ghost.dataset.k = key;
    const original = card && isSlot(card) && programEl.querySelector('[data-id="' + card.id + '"]');
    if (original) {
      ghost.classList.add('ghostStack');
      ghost.style.width = Math.min(240, original.getBoundingClientRect().width) + 'px';
      const copy = original.cloneNode(true);
      copy.classList.remove('active', 'flowParent');
      copy.querySelectorAll('.active, .flowParent, .flowBranch, .selected').forEach(element => {
        element.classList.remove('active', 'flowParent', 'flowBranch', 'selected');
      });
      copy.querySelectorAll('.runtimeBadge').forEach(badge => { badge.hidden = true; });
      ghost.appendChild(copy);
    } else {
      ghost.innerHTML = '<svg class="ic"><use href="#' + BLOCKS[key].icon + '"/></svg><span>' + BLOCKS[key].label + '</span>';
    }
    document.body.appendChild(ghost);
    dragging.ghost = ghost;
  }
  ev.preventDefault();
  dragging.ghost.style.left = ev.clientX + 'px';
  dragging.ghost.style.top = ev.clientY + 'px';
  document.querySelectorAll('.dropTarget').forEach(e => e.classList.remove('dropTarget'));
  const target = dragTarget(ev.clientX, ev.clientY);
  if (target && target.drop) target.element.classList.add('dropTarget');
}
function endDrag(ev) {
  if (!dragging || ev.pointerId !== dragging.pointerId) return;
  const d = dragging;
  dragging = null;
  document.querySelectorAll('.dropTarget').forEach(e => e.classList.remove('dropTarget'));
  if (d.scrolling) { ignoreClickUntil = Date.now() + 400; return; }
  if (!d.active) return;
  ignoreClickUntil = Date.now() + 400;
  d.ghost.remove();
  if (ev.type === 'pointercancel') return;
  const target = dragTarget(ev.clientX, ev.clientY);
  const drop = target && target.drop;
  if (!drop) return;
  if (d.source.key) {
    state.focus = drop;
    addBlock(d.source.key);
    return;
  }
  const loc = findCard(d.source.id);
  if (!loc) return;
  const card = loc.list[loc.index];
  // 不能把容器放进自己或自己的后代里。
  if (drop.parent && (drop.parent === card || (isSlot(card) && findCard(drop.parent.id, [card])))) return;
  snapshot();
  const dest = focusList(drop);
  let index = drop.index;
  if (dest === loc.list && loc.index < index) index--;
  loc.list.splice(loc.index, 1);
  dest.splice(index, 0, card);
  state.focus = { parent: drop.parent, branch: drop.branch, index: index + 1 };
  renderProgram();
}

function renderCard(card, depth) {
  if (isSlot(card)) return renderSlotCard(card, depth);

  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.k = card.key;
  el.dataset.id = card.id;
  el.addEventListener('pointerdown', ev => beginDrag(ev, { id: card.id }));
  el.innerHTML =
    '<svg class="ic"><use href="#' + BLOCKS[card.key].icon + '"/></svg>' +
    '<span class="lbl">' + BLOCKS[card.key].label + '</span>' +
    '<button type="button" class="del" aria-label="删除' + BLOCKS[card.key].label + '积木">×</button>';
  el.addEventListener('click', ev => {
    if (state.running || suppressDragClick()) return;
    if (ev.target.classList.contains('del')) { snapshot(); removeCard(card.id); return; }
    const loc = findCard(card.id);
    if (loc) state.focus = { parent: loc.parent, branch: loc.branch, index: loc.index + 1 };
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
  head.addEventListener('pointerdown', ev => beginDrag(ev, { id: card.id }));

  if (card.key === 'if') {
    const c = CONDITIONS[card.cond] || CONDITIONS.bug;
    head.innerHTML =
      '<svg class="ic"><use href="#i-if"/></svg>' +
      '<span class="slotKeyword">如果</span>' +
      '<button type="button" class="cond" aria-label="选择如果的条件"><svg class="ic sm"><use href="#' + c.icon + '"/></svg>' +
      '<span class="lbl">' + c.label + '</span><span class="swap">▾</span></button>' +
      '<span class="slotKeyword">那么</span>' +
      '<button type="button" class="elseTgl" aria-label="' + (card.hasElse ? '移除否则分支' : '添加否则分支') + '">' + (card.hasElse ? '− 否则' : '+ 否则') + '</button>' +
      '<button type="button" class="del" aria-label="删除如果积木">×</button>' +
      '<span class="runtimeBadge" hidden></span>';
    head.querySelector('.cond').addEventListener('click', ev => {
      if (state.running) return;
      ev.stopPropagation(); snapshot(); openPicker('cond', card);
    });
    head.querySelector('.elseTgl').addEventListener('click', ev => {
      if (state.running) return;
      ev.stopPropagation(); snapshot();
      card.hasElse = !card.hasElse;
      if (!card.hasElse) state.focus = null;
      renderProgram();
    });
  } else {
    head.innerHTML =
      '<svg class="ic"><use href="#i-repeat"/></svg>' +
      '<span class="slotKeyword">重复</span>' +
      '<button type="button" class="num" aria-label="选择重复次数">' + (card.count || 3) + ' 次<span class="swap">▾</span></button>' +
      '<button type="button" class="del" aria-label="删除重复积木">×</button>' +
      '<span class="runtimeBadge" hidden></span>';
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
  const foot = document.createElement('div');
  foot.className = 'slotFoot';
  if (card.key === 'repeat') foot.textContent = '↻';
  foot.setAttribute('aria-hidden', 'true');
  wrap.appendChild(foot);
  return wrap;
}

function renderSocket(card, branch, depth) {
  const body = document.createElement('div');
  body.className = 'socket' + (branch === 'else' ? ' elseSocket' : '');
  const inner = document.createElement('div');
  inner.className = 'stack';
  const kids = branchList(card, branch) || [];
  if (!kids.length) body.classList.add('empty');
  if (!kids.length) {
    const hint = document.createElement('div');
    hint.className = 'socketHint';
    hint.innerHTML = '<span>把积木放进来</span>';
    body.appendChild(hint);
  }
  renderStack(inner, kids, card, branch, depth + 1);
  body._drop = { parent: card, branch, index: kids.length };
  body.appendChild(inner);
  body.addEventListener('click', ev => {
    if (state.running || suppressDragClick()) return;
    const nested = ev.target.closest('.card, .slot');
    if (nested && nested !== body.closest('.slot')) return;
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
      b.addEventListener('click', () => { pickerState.card.cond = k; closePicker(); renderProgram(); });
      items.appendChild(b);
    });
  } else {
    title.textContent = '重复几次？';
    REPEAT_NUMS.forEach(n => {
      const b = document.createElement('button');
      b.className = 'pkItem pkNum';
      b.innerHTML = '<span>' + n + '</span>';
      b.addEventListener('click', () => { pickerState.card.count = n; closePicker(); renderProgram(); });
      items.appendChild(b);
    });
  }
}

/* ============================================================
   编译 + 执行
   卡片树 -> 扁平 ops。每只青蛙有自己的 pc / 循环栈，
   青蛙按编译后的 ops 前进。
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
      if (card.hasElse) compileSeq(card.elseChildren || [], list);
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
let compiledSource = '';
function compileProgram() {
  compiledSource = JSON.stringify(state.program);
  ops = [];
  compileSeq(state.program, ops);
  return ops;
}

function resetExecution() {
  execution.cardId = -1;
  execution.branch = null;
  execution.text = '搭好积木，按运行看看';
  execution.kind = 'idle';
  execution.conditions.clear();
  execution.loops.clear();
}

function clearNestedExecution(cardId) {
  const location = findCard(cardId);
  if (!location) return;
  const card = location.list[location.index];
  const clear = cards => (cards || []).forEach(child => {
    execution.conditions.delete(child.id);
    execution.loops.delete(child.id);
    clear(child.children);
    clear(child.elseChildren);
  });
  clear(card.children);
  clear(card.elseChildren);
}

function setExecution(op, text, kind, branch = null) {
  execution.cardId = op.cardId;
  execution.branch = branch;
  execution.text = text;
  execution.kind = kind;
}

function loopProgressText(progress) {
  return (progress.done ? '完成 ' : '第 ') + progress.current + ' / ' + progress.total + ' 次';
}

/* 条件判定（对某只青蛙） */
function testCond(f, cond) {
  // 「脚下」= 青蛙现在站的这格；「前面」= 下一格
  if (cond === 'abug') return !!beetleAt(f.q, f.r);          // 脚下有虫
  const a = aheadOf(f);
  const canMove = canHop(f.q, f.r, a.q, a.r);
  if (cond === 'water') return !canMove;
  if (cond === 'empty') return canMove && !beetleAt(a.q, a.r);
  if (cond === 'bug') return walkable(a.q, a.r) && !!beetleAt(a.q, a.r);
  return false;
}

/* 执行一条 op，作用于一只青蛙。返回 'jump' 表示 pc 已改好 */
function execOpFor(f, op) {
  switch (op.t) {
    case 'act': {
      const success = doAction(f, op.key);
      const text = success === false
        ? (op.key === 'hop' ? '前面是水，这次跳不过去' : '前面没有停着的虫子')
        : '正在执行：' + BLOCKS[op.key].label;
      setExecution(op, text, success === false ? 'notice' : 'action');
      return 'ok';
    }
    case 'test': {
      const result = testCond(f, op.cond);
      const location = findCard(op.cardId);
      const card = location && location.list[location.index];
      const branch = result ? 'then' : card && card.hasElse ? 'else' : null;
      execution.conditions.set(op.cardId, { result, branch });
      const choice = result ? '是，执行里面的积木' : branch ? '不是，执行否则' : '不是，跳过里面的积木';
      setExecution(op, CONDITIONS[op.cond].label + '？' + choice, result ? 'yes' : 'no', branch);
      if (result) return 'ok';
      f.pc = op.elseTarget;
      return 'jump';
    }
    case 'jmp':
      setExecution(op, '判断完成，继续往下走', 'action', 'then');
      f.pc = op.target;
      return 'jump';
    case 'loop':
      clearNestedExecution(op.cardId);
      f.loops.push({ count: op.count, seen: 0, bodyStart: op.bodyStart, cardId: op.cardId });
      execution.loops.set(op.cardId, { current: 1, total: op.count, done: false });
      setExecution(op, '开始重复：第 1 / ' + op.count + ' 次', 'repeat', 'then');
      return 'ok';
    case 'loopend': {
      const top = f.loops[f.loops.length - 1];
      if (!top) return 'ok';
      top.seen++;
      if (top.seen < top.count) {
        clearNestedExecution(op.cardId);
        execution.loops.set(op.cardId, { current: top.seen + 1, total: top.count, done: false });
        setExecution(op, '第 ' + top.seen + ' 次完成，继续第 ' + (top.seen + 1) + ' 次', 'repeat', 'then');
        f.pc = top.bodyStart;
        return 'jump';
      }
      execution.loops.set(op.cardId, { current: top.count, total: top.count, done: true });
      setExecution(op, '重复完成！一共 ' + top.count + ' 次', 'done');
      f.loops.pop();
      return 'ok';
    }
  }
  return 'ok';
}

/* 一条指令对一只青蛙做了什么 */
function doAction(f, key) {
  f.actionLabel = BLOCKS[key] ? BLOCKS[key].label : '';
  f.actionUntil = Date.now() + 850;
  switch (key) {
    case 'hop': {
      const a = aheadOf(f);
      if (!canHop(f.q, f.r, a.q, a.r)) { toast('前面是水，转个弯试试'); sfxError(); return false; }
      f.hopFrom = { q: f.q, r: f.r, at: Date.now() };
      f.q = a.q; f.r = a.r;
      sfxHop();
      break;
    }
    case 'left':  f.dir = (f.dir + 1) % NDIR; sfxTurn(); break;
    case 'right': f.dir = (f.dir + 5) % NDIR; sfxTurn(); break;
    case 'spin':  f.dir = (f.dir + 3) % NDIR; sfxTurn(); break;
    case 'chirp': sfxChirp(); break;
    case 'eat': {
      const ahead = aheadOf(f);
      const b = beetleAt(ahead.q, ahead.r);
      if (!b) { toast('前面没有虫子，转个方向试试'); sfxError(); return false; }
      state.eatAnimations.push({ q: f.q, r: f.r, dir: f.dir, beetle: b, at: Date.now() });
      b.alive = false;
      state.eaten++;
      state.eatenByColor[b.color % BEETLE_COLORS.length]++;
      state.score += 10;
      toast('好棒！吃到虫子啦');
      updateStats();
      sfxEat();
      checkWin();
      break;
    }
  }
  return true;
}

/* ---------------- 运行循环 ---------------- */
let runTimer = null;
let winTimer = null;
let ruleGuard = 0;

function runProgram() {
  if (state.winning) return;
  if (state.running) { stopProgram(); return; }
  if (!state.program.length) { toast('先加几块积木'); return; }
  compileProgram();
  if (!ops.length) { toast('程序里还没有能做的事'); return; }

  resetExecution();
  state.running = true;
  ruleGuard = 0;
  state.frogs.forEach(f => { f.pc = 0; f.loops = []; });
  if (!state.frogs.length) spawnStartFrog();
  $('#btnRun').querySelector('.nm').textContent = '停止';
  execution.text = '准备出发，跟着亮起来的积木走';
  execution.kind = 'action';
  highlightRun(currentOpCardId());
  runTimer = setTimeout(tickRun, 300);
}

function stopProgram(finished = false) {
  state.running = false;
  clearTimeout(runTimer);
  $('#btnRun').querySelector('.nm').textContent = '运行';
  execution.text = finished ? '程序完成啦！' : '已停止，可以单步继续';
  execution.kind = finished ? 'done' : 'idle';
  if (finished) {
    execution.branch = null;
    highlightRun(-1);
  } else renderExecution();
}

function currentOpCardId() {
  const f = state.frogs[0];
  if (!f || f.pc >= ops.length) return -1;
  return ops[f.pc].cardId;
}

function highlightRun(id) {
  execution.cardId = id;
  renderExecution(true);
}

function renderExecution(scroll = false) {
  const status = $('#execStatus');
  status.dataset.kind = execution.kind;
  $('#execText').textContent = execution.text;
  $('#execIcon').textContent = ({ idle: '✦', action: '▶', yes: '✓', no: '↪', repeat: '↻', done: '✓', notice: '!' })[execution.kind] || '✦';
  const context = $('#execContext');
  context.replaceChildren();
  const scopes = [];
  let location = findCard(execution.cardId);
  if (location) {
    const card = location.list[location.index];
    if (isSlot(card)) scopes.push(card);
    while (location.parent) {
      scopes.push(location.parent);
      location = findCard(location.parent.id);
    }
  }
  scopes.reverse().forEach(card => {
    const decision = execution.conditions.get(card.id);
    const progress = execution.loops.get(card.id);
    const text = progress ? '↻ ' + loopProgressText(progress) : decision
      ? (decision.result ? '✓ 如果成立' : decision.branch === 'else' ? '↪ 否则' : '✕ 跳过') : '';
    if (!text) return;
    const chip = document.createElement('span');
    chip.className = 'execChip';
    chip.textContent = text;
    context.appendChild(chip);
  });
  context.hidden = !context.children.length;

  programEl.querySelectorAll('.active, .flowParent, .flowBranch').forEach(element => {
    element.classList.remove('active', 'flowParent', 'flowBranch');
  });
  programEl.querySelectorAll('.runtimeBadge').forEach(badge => { badge.hidden = true; });

  execution.conditions.forEach((decision, id) => {
    const slot = programEl.querySelector('.slot[data-id="' + id + '"]');
    const badge = slot && slot.querySelector('.runtimeBadge');
    if (!badge) return;
    badge.textContent = decision.result ? '✓ 条件成立' : '✕ 条件不成立';
    badge.dataset.kind = decision.result ? 'yes' : 'no';
    badge.hidden = false;
  });
  execution.loops.forEach((progress, id) => {
    const slot = programEl.querySelector('.slot[data-id="' + id + '"]');
    const badge = slot && slot.querySelector('.runtimeBadge');
    if (!badge) return;
    badge.replaceChildren(document.createTextNode('↻ ' + loopProgressText(progress)));
    if (progress.total <= 6) {
      const dots = document.createElement('span');
      dots.className = 'loopDots';
      dots.setAttribute('aria-hidden', 'true');
      for (let index = 1; index <= progress.total; index++) {
        const dot = document.createElement('span');
        dot.className = 'loopDot' + (progress.done || index < progress.current ? ' completed' :
          index === progress.current ? ' current' : '');
        dots.appendChild(dot);
      }
      badge.appendChild(dots);
    }
    badge.dataset.kind = 'repeat';
    badge.hidden = false;
  });

  const current = programEl.querySelector('[data-id="' + execution.cardId + '"]');
  if (!current) return;
  current.classList.add('active');
  if (current.classList.contains('slot') && execution.branch) {
    const socket = Array.from(current.children).find(child => child.classList.contains('socket') &&
      child.classList.contains('elseSocket') === (execution.branch === 'else'));
    if (socket) socket.classList.add('flowBranch');
  }
  let socket = current.parentElement.closest('.socket');
  while (socket) {
    socket.classList.add('flowBranch');
    const parent = socket.parentElement;
    parent.classList.add('flowParent');
    socket = parent.parentElement.closest('.socket');
  }

  if (!scroll) return;
  const target = current.classList.contains('slot') ? current.querySelector('.slotHead') : current;
  const a = target.getBoundingClientRect(), b = programEl.getBoundingClientRect();
  if (a.top < b.top + 4) programEl.scrollTop -= (b.top + 4 - a.top);
  else if (a.bottom > b.bottom - 4) programEl.scrollTop += (a.bottom - b.bottom + 4);
}

function tickRun() {
  if (!state.running) return;

  const live = state.frogs.filter(f => f.alive);
  if (!live.length) { stopProgram(); return; }

  // 所有青蛙都跑完了吗？
  const busy = live.filter(f => f.pc < ops.length);
  if (!busy.length) {
    stopProgram(true);
    checkWin();
    return;
  }

  const activeId = currentOpCardId();
  busy.forEach(f => {
    if (f.pc >= ops.length) return;
    const op = ops[f.pc];
    const r = execOpFor(f, op);
    if (r !== 'jump') f.pc++;
  });

  draw();
  highlightRun(activeId);

  if (!state.running) return;

  if (++ruleGuard > 3000) { stopProgram(); toast('跑太多步了，停下来休息一下'); return; }
  runTimer = setTimeout(tickRun, 850 / state.speed);
}

function stepOnce() {
  if (state.running || state.winning) return;
  if (!ops.length) { compileProgram(); state.frogs.forEach(f => { f.pc = 0; f.loops = []; }); }
  if (!state.frogs.length) spawnStartFrog();
  const live = state.frogs.filter(f => f.alive && f.pc < ops.length);
  if (!live.length) { toast('程序已经跑完了'); return; }
  const activeId = currentOpCardId();
  live.forEach(f => {
    const op = ops[f.pc];
    const r = execOpFor(f, op);
    if (r !== 'jump') f.pc++;
  });
  draw();
  highlightRun(activeId);
  if (state.frogs.every(f => f.pc >= ops.length)) checkWin();
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
  if (state.winning || !state.eatenByColor.every(count => count > 0)) return;
  state.winning = true;
  if (state.running) stopProgram(true);
  const delay = Math.max(0, ...state.eatAnimations.map(animation => 650 - (Date.now() - animation.at)));
  winTimer = setTimeout(showWin, delay);
}

function showWin() {
  if (!LEVELS[state.level].free) state.completedLevels.add(state.level);
  const remaining = LEVELS.map((level, index) => index).filter(index => index > 0 && !state.completedLevels.has(index));
  const next = remaining.find(index => index > state.level) || remaining[0];
  hideOverlay();
  $('#victory').hidden = false;
  $('#winScreen').hidden = false;
  $('#finalScreen').hidden = true;
  $('#winNext').textContent = next ? '准备进入挑战 ' + next + '…' : '准备庆祝通关…';
  winTimer = setTimeout(() => {
    if (next) {
      loadLevel(next);
    } else {
      $('#winScreen').hidden = true;
      $('#finalScreen').hidden = false;
      $('#victoryRestart').focus();
    }
  }, 3000);
}

function initBugCollection() {
  const collection = $('#collectionBugs');
  BEETLE_COLORS.forEach(color => {
    const item = document.createElement('div');
    item.className = 'collectionBug';
    item.dataset.color = color.name;
    item.setAttribute('role', 'listitem');
    item.style.color = color.body;
    item.innerHTML = '<svg class="collectionIcon" aria-hidden="true"><use href="#i-collection-bug"/></svg>' +
      '<span class="collectionCount" hidden></span>';
    collection.appendChild(item);
  });
}

function updateStats() {
  const left = state.beetles.filter(b => b.alive && (LEVELS[state.level].free ? !b.leaving : b.target)).length;
  const be = $('#statBeetles'); if (be && be.textContent !== String(left)) be.textContent = left;
  const mode = $('#modeSelect'); if (mode && mode.value !== String(state.level)) mode.value = String(state.level);
  const sc = $('#statScore'); if (sc && sc.textContent !== String(state.score)) sc.textContent = state.score;
  $('#collectionBugs').childNodes.forEach((item, index) => {
    const count = state.eatenByColor[index];
    if (item.dataset.count === String(count)) return;
    item.dataset.count = count;
    item.classList.toggle('collected', count > 0);
    item.setAttribute('aria-label', BEETLE_COLORS[index].label + '虫子，吃掉 ' + count + ' 只');
    const badge = item.querySelector('.collectionCount');
    badge.hidden = count === 0;
    badge.textContent = count;
  });
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
  window.addEventListener('pointerdown', () => {
    if (!dragging) ignoreClickUntil = 0;
    if (state.sound) prepareFrogCroak();
  }, true);
  window.addEventListener('pointermove', dragMove, { passive: false });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  $('#modeSelect').addEventListener('change', ev => {
    stopProgram();
    hideOverlay();
    loadLevel(Number(ev.target.value));
  });
  document.querySelectorAll('.pal[data-block]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.running || suppressDragClick()) return;
      addBlock(btn.dataset.block);
    });
    btn.addEventListener('pointerdown', ev => beginDrag(ev, { key: btn.dataset.block }));
  });

  $('#btnRun').addEventListener('click', runProgram);
  $('#btnStep').addEventListener('click', stepOnce);
  $('#btnClear').addEventListener('click', clearProgram);
  $('#btnUndo').addEventListener('click', undoBlock);

  const rs = $('#btnReset');
  if (rs) rs.addEventListener('click', resetProgram);
  $('#victoryRestart').addEventListener('click', () => {
    state.completedLevels.clear();
    loadLevel(0);
  });
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
    if (state.running || state.winning) return;
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
    if (di < 0 || !canHop(f.q, f.r, c.q, c.r)) return;
    f.hopFrom = { q: f.q, r: f.r, at: Date.now() };
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
    '① 点积木，排好青蛙的动作。\n' +
    '② 按 ▶，看青蛙动起来。\n' +
    '③ 面对相邻落脚点上的虫子，再按「吃」伸出舌头。\n\n' +
    '沿荷叶上的路线跳，也可以点路线连接的相邻落脚点。积木可以拖动。';
  showOverlay('知道了', hideOverlay);
}

/* ---------------- 启动 ---------------- */
function boot() {
  resize();
  bindUI();
  initBugCollection();
  loadLevel(0);
  toast('点积木，再按 ▶');

  hideOverlay();

  setInterval(() => {
    updateBeetles(Date.now());
    if (!state.running) draw();
    else draw();
  }, 50);
}

boot();
