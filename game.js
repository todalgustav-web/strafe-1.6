// STRAFE 1.6 — a tiny GoldSrc-style shooter in the browser.
// Units are "Hammer units" like the original engine: player is 32x72, runs 250 u/s.
import * as THREE from 'three';

/* ============================================================
   SETTINGS
   ============================================================ */
const DEFAULTS = { sens: 2.0, fov: 90, airAccel: 10, bots: 5, volume: 0.5, diff: 'normal', autoBhop: true };
const settings = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem('strafe16') || '{}'); } catch { return {}; } })());
const saveSettings = () => { try { localStorage.setItem('strafe16', JSON.stringify(settings)); } catch {} };

/* ============================================================
   CONSTANTS (GoldSrc-ish movement)
   ============================================================ */
const TICK = 1 / 100;
const GRAVITY = 800, JUMP_V = Math.sqrt(2 * 800 * 45), FRICTION = 4, STOPSPEED = 75, ACCEL = 5;
const HW = 16, STAND_H = 72, DUCK_H = 36, EYE_STAND = 64, EYE_DUCK = 28, STEP = 18, EPS = 0.03;

/* ============================================================
   MAP — each char is a 128x128 cell. North = top.
   #  wall            .  floor (0)       1  raised floor (64)
   t  roofed tunnel / doorway (0)        n s e w  stairs rising toward that direction
   c  crate (64)      C  stacked crates (128)   p  crate on raised floor
   ============================================================ */
const CELL = 128, WALL_TOP = 384, ROOF = 176, FLOOR_BOTTOM = -128, STEPS = 8;
const R = (...s) => s.join('');
const MAP = [
  '#'.repeat(30),
  R('#', 'C.......', '##', '........', '##', '11111111', '#'),
  R('#', '........', '##', '........', '.e', '11111p11', '#'),
  R('#', '...c....', '##', '........', '.e', '11111111', '#'),
  R('#', '........', 'tt', '........', '.e', '11p11111', '#'),
  R('#', '..cC....', 'tt', '........', '##', '11111111', '#'),
  R('#', '........', '##', '........', '##', '11111111', '#'),
  R('#', '........', '##', '##tttt##', '##', '11111111', '#'),
  R('#', '#....###', '##', '##....##', '##', '11##nnnn', '#'),
  R('#', '#tttt###', '##', '##....##', '##', '11##....', '#'),
  R('#', '#tttt###', '##', '##....e1', '11', '11##....', '#'),
  R('#', '#tttt###', '##', '##....e1', '11', '11##....', '#'),
  R('#', '#tttt###', '##', '##....##', '##', '####....', '#'),
  R('#', '#tttt###', '##', '##....##', '##', '####....', '#'),
  R('#', '#tttt###', '##', '##....##', '##', '####....', '#'),
  R('#', '#tttt###', '##', '##....##', '##', '####....', '#'),
  R('#', '#ttttttt', 'tt', 'tt....##', '##', '####....', '#'),
  R('#', '#ttttttt', 'tt', 'tt....##', '##', '####....', '#'),
  R('#', '#tttt###', '##', '##....##', '##', '####....', '#'),
  R('#', '#tttt###', '##', '##....##', '##', '####....', '#'),
  R('#', '#tttt###', '##', '##....#.', '.t', 'tttt....', '#'),
  R('#', '#tttt###', '##', '##....#.', '.t', 'tttt....', '#'),
  R('#', '#tttt###', '##', '##....#.', '.#', '########', '#'),
  R('#', '#tttt...', '..', '........', '..', '....####', '#'),
  R('#', '#####sss', 'ss', 'ssssssss', 'ss', 'ssss####', '#'),
  R('#', '#####111', '11', '11111111', '11', '1111####', '#'),
  R('#', '#####1p1', '11', '11111111', '11', '11p1####', '#'),
  R('#', '#####111', '11', '11111111', '11', '1111####', '#'),
  R('#', '#####111', '11', '11111111', '11', '1111####', '#'),
  '#'.repeat(30),
];
const MW = MAP[0].length, MH = MAP.length;
MAP.forEach((row, i) => { if (row.length !== MW) console.warn('map row', i, 'has length', row.length); });

const CT_SPAWNS = [[2, 13], [3, 15], [4, 12], [5, 16], [2, 17], [5, 13]];
const T_SPAWNS = [[25, 10], [26, 12], [27, 14], [25, 16], [26, 18], [27, 9], [25, 20], [27, 17], [26, 9], [27, 21]];
const GOALS = {
  A: [[3, 24], [5, 27], [6, 22], [2, 22]],
  B: [[2, 3], [6, 6], [4, 7], [7, 2]],
  mid: [[10, 14], [15, 15], [20, 14]],
  long: [[12, 26], [18, 27], [20, 23]],
  cat: [[10, 19], [9, 21]],
  tun: [[16, 10], [13, 3], [20, 3]],
  ct: [[3, 15], [4, 18]],
};
const ALL_GOALS = Object.values(GOALS).flat();

/* ============================================================
   RANDOM
   ============================================================ */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const srand = mulberry32(1337);
const rand = Math.random;
const pick = arr => arr[(rand() * arr.length) | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ============================================================
   RENDERER / SCENE
   ============================================================ */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
document.getElementById('game').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe6d2a6, 2200, 7500);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 2, 14000);
camera.rotation.order = 'YXZ';

function vfov(h) { return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(h) / 2) * 0.75)); }
function applyFov() { camera.fov = vfov(settings.fov); camera.updateProjectionMatrix(); }
applyFov();

// sky
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#5f93c9'); gr.addColorStop(0.55, '#a9c9e3'); gr.addColorStop(1, '#efdcb4');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x9c7a4c, 1.25));
const sun = new THREE.DirectionalLight(0xffe2b0, 2.4);
sun.position.set(MW * CELL / 2 - 1400, 2600, MH * CELL / 2 + 900);
sun.target.position.set(MW * CELL / 2, 0, MH * CELL / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera; sc.left = -2700; sc.right = 2700; sc.top = 2700; sc.bottom = -2700; sc.near = 100; sc.far = 7000;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 1.5;
scene.add(sun, sun.target);

const muzzleLight = new THREE.PointLight(0xffc070, 0, 700, 0);
scene.add(muzzleLight);

/* ============================================================
   PROCEDURAL TEXTURES
   ============================================================ */
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function speckle(g, s, n, colors, maxR, alpha) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.3 + srand() * 0.7); g.fillStyle = colors[(srand() * colors.length) | 0];
    const r = 1 + srand() * maxR; g.fillRect(srand() * s, srand() * s, r, r);
  }
  g.globalAlpha = 1;
}
const TEX = {
  sand: canvasTex(256, (g, s) => {
    g.fillStyle = '#cfae78'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 18; i++) { g.globalAlpha = 0.08; g.fillStyle = srand() < .5 ? '#b08a55' : '#e2c592'; g.beginPath(); g.arc(srand() * s, srand() * s, 20 + srand() * 50, 0, 7); g.fill(); }
    speckle(g, s, 3500, ['#b8925c', '#e0c38e', '#a88250', '#d9bb86'], 2.2, 0.7);
  }),
  wall: canvasTex(256, (g, s) => {
    g.fillStyle = '#a88a5c'; g.fillRect(0, 0, s, s);
    const rows = 4, rh = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -50 : 0;
      while (x < s) {
        const w = 70 + srand() * 60;
        const l = 70 + srand() * 12, hue = 36 + srand() * 6;
        g.fillStyle = `hsl(${hue},${38 + srand() * 10}%,${l}%)`;
        g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
        if (x + w > s) g.fillRect(x + 2 - s, r * rh + 2, w - 4, rh - 4);
        x += w;
      }
    }
    speckle(g, s, 2500, ['#8f7148', '#e9d2a6', '#b39465'], 2, 0.5);
    g.globalAlpha = 0.15; g.fillStyle = '#6d5534';
    for (let i = 0; i < 40; i++) g.fillRect(srand() * s, srand() * s, 1, 6 + srand() * 14);
    g.globalAlpha = 1;
  }),
  tile: canvasTex(256, (g, s) => {
    g.fillStyle = '#9d8259'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      g.fillStyle = `hsl(${35 + srand() * 6},${32 + srand() * 8}%,${62 + srand() * 8}%)`;
      g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
    }
    speckle(g, s, 2500, ['#8a6e48', '#e2cba0', '#b49870'], 2, 0.6);
  }),
  ceil: canvasTex(128, (g, s) => {
    g.fillStyle = '#7d6745'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#5e4c32'; for (let i = 0; i < 4; i++) g.fillRect(0, i * 32, s, 3);
    speckle(g, s, 900, ['#5a472d', '#9c845e'], 2, 0.6);
  }),
  crate: canvasTex(128, (g, s) => {
    g.fillStyle = '#9b6a35'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#7a5027'; g.lineWidth = 2;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, i * s / 6); g.lineTo(s, i * s / 6); g.stroke(); }
    g.strokeStyle = '#5d3b1a'; g.lineWidth = 14; g.strokeRect(7, 7, s - 14, s - 14);
    g.lineWidth = 12; g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.stroke();
    speckle(g, s, 600, ['#6e4620', '#b07c45'], 2, 0.5);
  }),
};

/* ============================================================
   WORLD GEOMETRY + COLLISION BOXES
   ============================================================ */
const cellInfo = []; // [r][c] -> {ch, h, walk, stair}
const DIRS = { n: [-1, 0], s: [1, 0], e: [0, 1], w: [0, -1] };
function baseHeight(ch) {
  if (ch === '#' || ch === undefined) return null;
  if (ch === '1' || ch === 'p') return 64;
  if (ch === '2') return 128;
  if (ch === '-') return -64;
  if (DIRS[ch]) return null;
  return 0;
}
for (let r = 0; r < MH; r++) {
  cellInfo[r] = [];
  for (let c = 0; c < MW; c++) {
    const ch = MAP[r][c];
    const info = { ch, h: baseHeight(ch), walk: !'#cCp'.includes(ch), stair: null };
    if (DIRS[ch]) {
      const [dr, dc] = DIRS[ch];
      const base = baseHeight(MAP[r - dr]?.[c - dc]) ?? 0, top = baseHeight(MAP[r + dr]?.[c + dc]) ?? 64;
      info.stair = { dr, dc, base, top }; info.h = top;
    }
    cellInfo[r][c] = info;
  }
}
function cellAt(x, z) { const c = Math.floor(x / CELL), r = Math.floor(z / CELL); return (r >= 0 && r < MH && c >= 0 && c < MW) ? cellInfo[r][c] : null; }
function cellCenter(r, c) { return new THREE.Vector3((c + 0.5) * CELL, 0, (r + 0.5) * CELL); }
function floorHeight(x, z) {
  const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
  const info = cellInfo[r]?.[c]; if (!info) return 0;
  if (!info.stair) return info.h ?? 0;
  const { dr, dc, base, top } = info.stair;
  const fx = x / CELL - c, fz = z / CELL - r;
  let f = dc === 1 ? fx : dc === -1 ? 1 - fx : dr === 1 ? fz : 1 - fz;
  const i = Math.min(STEPS - 1, Math.floor(f * STEPS));
  return base + (i + 1) * (top - base) / STEPS;
}

// geometry builder (world-space UVs so textures tile seamlessly)
class GeoBuilder {
  constructor(uvScale) { this.p = []; this.n = []; this.uv = []; this.idx = []; this.s = uvScale; }
  face(corners, nx, ny, nz, ua, va, local, mn, size) {
    const base = this.p.length / 3;
    for (const v of corners) {
      this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz);
      if (local) this.uv.push((v[ua] - mn[ua]) / size[ua], (v[va] - mn[va]) / size[va]);
      else this.uv.push(v[ua] / this.s, v[va] / this.s);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  box(mn, mx, local = false, skipBottom = true) {
    const [x0, y0, z0] = mn, [x1, y1, z1] = mx, size = [x1 - x0, y1 - y0, z1 - z0];
    this.face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 1, 0, 0, 2, 1, local, mn, size);
    this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0, 2, 1, local, mn, size);
    this.face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 0, 1, 0, 0, 2, local, mn, size);
    if (!skipBottom) this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0, -1, 0, 0, 2, local, mn, size);
    this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1, 0, 1, local, mn, size);
    this.face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 0, 0, -1, 0, 1, local, mn, size);
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    const m = new THREE.Mesh(g, material); m.castShadow = m.receiveShadow = true; return m;
  }
}
const builders = { sand: new GeoBuilder(256), wall: new GeoBuilder(128), tile: new GeoBuilder(128), ceil: new GeoBuilder(128), crate: new GeoBuilder(1) };
const boxes = []; // flat [x0,y0,z0,x1,y1,z1]
function solid(mat, mn, mx, local = false) { builders[mat].box(mn, mx, local, mat !== 'ceil'); boxes.push(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]); }

for (let r = 0; r < MH; r++) for (let c = 0; c < MW; c++) {
  const info = cellInfo[r][c], ch = info.ch;
  const x0 = c * CELL, z0 = r * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  if (ch === '#') { solid('wall', [x0, FLOOR_BOTTOM, z0], [x1, WALL_TOP, z1]); continue; }
  if (info.stair) {
    const { dr, dc, base, top } = info.stair;
    for (let i = 0; i < STEPS; i++) {
      const a = i / STEPS, b = (i + 1) / STEPS, h = base + (i + 1) * (top - base) / STEPS;
      let mn, mx;
      if (dc === 1) { mn = [x0 + a * CELL, FLOOR_BOTTOM, z0]; mx = [x0 + b * CELL, h, z1]; }
      else if (dc === -1) { mn = [x1 - b * CELL, FLOOR_BOTTOM, z0]; mx = [x1 - a * CELL, h, z1]; }
      else if (dr === 1) { mn = [x0, FLOOR_BOTTOM, z0 + a * CELL]; mx = [x1, h, z0 + b * CELL]; }
      else { mn = [x0, FLOOR_BOTTOM, z1 - b * CELL]; mx = [x1, h, z1 - a * CELL]; }
      solid('tile', mn, mx);
    }
    continue;
  }
  const h = info.h;
  solid(h > 0 ? 'tile' : 'sand', [x0, FLOOR_BOTTOM, z0], [x1, h, z1]);
  if (ch === 't') solid('ceil', [x0, ROOF, z0], [x1, WALL_TOP, z1]);
  if (ch === 'c' || ch === 'p') solid('crate', [x0 + 16, h, z0 + 16], [x1 - 16, h + 64, z1 - 16], true);
  if (ch === 'C') { solid('crate', [x0 + 16, h, z0 + 16], [x1 - 16, h + 64, z1 - 16], true); solid('crate', [x0 + 28, h + 64, z0 + 24], [x1 - 28, h + 128, z1 - 32], true); }
}
const MATS = {};
for (const k in builders) {
  MATS[k] = new THREE.MeshLambertMaterial({ map: TEX[k] });
  scene.add(builders[k].mesh(MATS[k]));
}
const BOXES = new Float32Array(boxes);
const NBOX = BOXES.length / 6;

// spatial hash for collision
const hash = Array.from({ length: MW * MH }, () => []);
for (let i = 0; i < NBOX; i++) {
  const o = i * 6;
  const c0 = Math.max(0, Math.floor(BOXES[o] / CELL)), c1 = Math.min(MW - 1, Math.floor((BOXES[o + 3] - 0.001) / CELL));
  const r0 = Math.max(0, Math.floor(BOXES[o + 2] / CELL)), r1 = Math.min(MH - 1, Math.floor((BOXES[o + 5] - 0.001) / CELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) hash[r * MW + c].push(i);
}
const stamp = new Uint32Array(NBOX); let stampId = 1;
function forBoxes(x0, z0, x1, z1, fn) {
  stampId++;
  const c0 = Math.max(0, Math.floor(x0 / CELL)), c1 = Math.min(MW - 1, Math.floor(x1 / CELL));
  const r0 = Math.max(0, Math.floor(z0 / CELL)), r1 = Math.min(MH - 1, Math.floor(z1 / CELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    for (const i of hash[r * MW + c]) { if (stamp[i] === stampId) continue; stamp[i] = stampId; fn(i * 6); }
  }
}
function overlapAt(x, y, z, h) {
  let hit = false;
  forBoxes(x - HW, z - HW, x + HW, z + HW, o => {
    if (!hit && x - HW < BOXES[o + 3] && x + HW > BOXES[o] && y < BOXES[o + 4] && y + h > BOXES[o + 1] && z - HW < BOXES[o + 5] && z + HW > BOXES[o + 2]) hit = true;
  });
  return hit;
}
// move p along one axis by amt, clamp against boxes. returns true if blocked.
function collideAxis(p, axis, amt, h) {
  if (amt === 0) return false;
  if (axis === 0) p.x += amt; else if (axis === 1) p.y += amt; else p.z += amt;
  let hit = false;
  forBoxes(p.x - HW, p.z - HW, p.x + HW, p.z + HW, o => {
    if (p.x - HW < BOXES[o + 3] && p.x + HW > BOXES[o] && p.y < BOXES[o + 4] && p.y + h > BOXES[o + 1] && p.z - HW < BOXES[o + 5] && p.z + HW > BOXES[o + 2]) {
      hit = true;
      if (axis === 0) p.x = amt > 0 ? BOXES[o] - HW - EPS : BOXES[o + 3] + HW + EPS;
      else if (axis === 1) p.y = amt > 0 ? BOXES[o + 1] - h - EPS : BOXES[o + 4] + EPS;
      else p.z = amt > 0 ? BOXES[o + 2] - HW - EPS : BOXES[o + 5] + HW + EPS;
    }
  });
  return hit;
}
// ray vs world. returns {t, nx, ny, nz} or null
function rayWorld(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT, bax = -1;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  for (let o = 0; o < BOXES.length; o += 6) {
    let t0 = -Infinity, t1 = Infinity, ax = -1, a, b;
    a = (BOXES[o] - ox) * ix; b = (BOXES[o + 3] - ox) * ix; if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; ax = 0; } if (b < t1) t1 = b; if (t0 > t1) continue;
    a = (BOXES[o + 1] - oy) * iy; b = (BOXES[o + 4] - oy) * iy; if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; ax = 1; } if (b < t1) t1 = b; if (t0 > t1) continue;
    a = (BOXES[o + 2] - oz) * iz; b = (BOXES[o + 5] - oz) * iz; if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; ax = 2; } if (b < t1) t1 = b; if (t0 > t1) continue;
    if (t0 >= 0 && t0 < best) { best = t0; bax = ax; }
  }
  if (bax < 0) return null;
  const d = [dx, dy, dz][bax];
  return { t: best, nx: bax === 0 ? -Math.sign(d) : 0, ny: bax === 1 ? -Math.sign(d) : 0, nz: bax === 2 ? -Math.sign(d) : 0 };
}
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, mn, mx] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) return Infinity; continue; }
    let a = (mn - o) / d, b = (mx - o) / d; if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return Infinity;
  }
  return t0;
}

// site markers painted on the floor
function siteDecal(letter, r, c) {
  const t = canvasTex(256, (g, s) => {
    g.clearRect(0, 0, s, s); g.fillStyle = 'rgba(170,30,20,0.85)'; g.font = 'bold 200px Impact, Arial Black, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, s / 2, s / 2 + 10);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI;
  const p = cellCenter(r, c); m.position.set(p.x, cellInfo[r][c].h + 0.6, p.z); m.receiveShadow = true;
  scene.add(m);
}
siteDecal('A', 4, 25); siteDecal('B', 2, 5);

/* ============================================================
   NAVIGATION (grid BFS for bots)
   ============================================================ */
function edgeH(info, dr, dc) {
  if (!info || !info.walk) return null;
  if (!info.stair) return info.h;
  const s = info.stair;
  if (dr === s.dr && dc === s.dc) return s.top;
  if (dr === -s.dr && dc === -s.dc) return s.base;
  return null;
}
const nav = [];
for (let r = 0; r < MH; r++) for (let c = 0; c < MW; c++) {
  const list = [];
  for (const [dr, dc] of Object.values(DIRS)) {
    const a = edgeH(cellInfo[r][c], dr, dc), b = edgeH(cellInfo[r + dr]?.[c + dc], -dr, -dc);
    if (a !== null && b !== null && a === b) list.push((r + dr) * MW + c + dc);
  }
  nav[r * MW + c] = list;
}
function findPath(fromR, fromC, toR, toC) {
  const start = fromR * MW + fromC, goal = toR * MW + toC;
  const prev = new Int32Array(MW * MH).fill(-1); prev[start] = start;
  const q = [start];
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi]; if (cur === goal) break;
    for (const n of nav[cur]) if (prev[n] < 0) { prev[n] = cur; q.push(n); }
  }
  if (prev[goal] < 0) return [];
  const out = []; for (let cur = goal; cur !== start; cur = prev[cur]) out.push(cur);
  return out.reverse().map(i => { const v = cellCenter((i / MW) | 0, i % MW); v.x += (rand() - .5) * 30; v.z += (rand() - .5) * 30; return v; });
}

/* ============================================================
   AUDIO (synthesised, no files)
   ============================================================ */
let AC = null, master = null, noiseBuf = null;
function initAudio() {
  if (AC) { AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.gain.value = settings.volume; master.connect(AC.destination);
  noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function sNoise({ vol = 1, freq = 3000, type = 'lowpass', decay = 0.15, q = 0.7, sweep = 0 }) {
  if (!AC) return; const t = AC.currentTime;
  const src = AC.createBufferSource(); src.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + decay);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 0.5); src.stop(t + decay + 0.05);
}
function sTone({ vol = 0.5, f0 = 440, f1 = f0, decay = 0.1, type = 'sine', delay = 0 }) {
  if (!AC) return; const t = AC.currentTime + delay;
  const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + decay);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(master); o.start(t); o.stop(t + decay + 0.05);
}
const SFX = {
  ak() { sNoise({ vol: 0.9, freq: 4200, decay: 0.16 }); sNoise({ vol: 0.5, freq: 900, decay: 0.3 }); sTone({ vol: 0.7, f0: 160, f1: 45, decay: 0.12 }); },
  deagle() { sNoise({ vol: 1, freq: 3000, decay: 0.28 }); sTone({ vol: 0.9, f0: 120, f1: 35, decay: 0.2 }); },
  knife() { sNoise({ vol: 0.35, freq: 1500, type: 'bandpass', decay: 0.18, q: 2, sweep: 5000 }); },
  enemy(dist) { const k = 1 / (1 + dist / 700); sNoise({ vol: 0.8 * k, freq: 900 + 3000 * k, decay: 0.16 + 0.15 * (1 - k) }); sTone({ vol: 0.4 * k, f0: 140, f1: 40, decay: 0.12 }); },
  hit() { sTone({ vol: 0.25, f0: 900, f1: 600, decay: 0.05, type: 'square' }); },
  headshot() { sTone({ vol: 0.35, f0: 2200, f1: 2100, decay: 0.25 }); sTone({ vol: 0.2, f0: 3300, f1: 3200, decay: 0.2 }); },
  hurt() { sNoise({ vol: 0.5, freq: 600, decay: 0.12 }); },
  click() { sTone({ vol: 0.2, f0: 1800, f1: 1500, decay: 0.03, type: 'square' }); },
  reload() { sTone({ vol: 0.25, f0: 700, f1: 500, decay: 0.05, type: 'square' }); sTone({ vol: 0.25, f0: 1200, f1: 900, decay: 0.05, type: 'square', delay: 0.9 }); sTone({ vol: 0.3, f0: 500, f1: 900, decay: 0.07, type: 'square', delay: 1.8 }); },
  land(v) { sNoise({ vol: Math.min(0.4, v / 1500), freq: 500, decay: 0.08 }); },
  step() { sNoise({ vol: 0.06, freq: 700 + rand() * 300, decay: 0.06 }); },
  ricochet() { sNoise({ vol: 0.12, freq: 2500, type: 'bandpass', decay: 0.08, q: 3 }); },
};

/* ============================================================
   EFFECTS: decals, puffs, tracers
   ============================================================ */
const holeGeo = new THREE.CircleGeometry(2.6, 8);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x241a10, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
const holes = []; let holeI = 0;
for (let i = 0; i < 160; i++) { const m = new THREE.Mesh(holeGeo, holeMat); m.visible = false; scene.add(m); holes.push(m); }
function addHole(p, n) {
  const m = holes[holeI++ % holes.length]; m.visible = true;
  m.position.set(p.x + n.x * 0.2, p.y + n.y * 0.2, p.z + n.z * 0.2);
  m.lookAt(p.x + n.x * 10, p.y + n.y * 10, p.z + n.z * 10);
}
const puffTex = canvasTex(64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
const puffs = [];
for (let i = 0; i < 40; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false })); s.visible = false; scene.add(s); puffs.push({ s, t: 0, life: 0, size: 0, vy: 0 }); }
let puffI = 0;
function addPuff(p, color, size = 14, life = 0.35, vy = 20) {
  const P = puffs[puffI++ % puffs.length]; P.s.visible = true; P.s.position.copy(p); P.s.material.color.set(color);
  P.t = 0; P.life = life; P.size = size; P.vy = vy;
}
const tracers = [];
for (let i = 0; i < 24; i++) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8 })); l.visible = false; l.frustumCulled = false; scene.add(l);
  tracers.push({ l, t: 0 });
}
let tracerI = 0;
function addTracer(a, b) {
  const T = tracers[tracerI++ % tracers.length]; const arr = T.l.geometry.attributes.position.array;
  arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
  T.l.geometry.attributes.position.needsUpdate = true; T.l.visible = true; T.t = 0.06; T.l.material.opacity = 0.8;
}
const flashTex = canvasTex(64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,190,80,.9)'); gr.addColorStop(1, 'rgba(255,120,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
function updateEffects(dt) {
  for (const P of puffs) if (P.s.visible) {
    P.t += dt; const k = P.t / P.life;
    if (k >= 1) { P.s.visible = false; continue; }
    P.s.scale.setScalar(P.size * (0.5 + k)); P.s.material.opacity = 0.8 * (1 - k); P.s.position.y += P.vy * dt;
  }
  for (const T of tracers) if (T.l.visible) { T.t -= dt; T.l.material.opacity = Math.max(0, T.t / 0.06) * 0.8; if (T.t <= 0) T.l.visible = false; }
}

/* ============================================================
   VIEWMODEL (separate scene drawn on top)
   ============================================================ */
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xfff2dd, 0x6b5434, 1.6));
const vmSun = new THREE.DirectionalLight(0xffe2b0, 1.8); vmSun.position.set(-1, 2, 1); vmScene.add(vmSun);
const L = c => new THREE.MeshLambertMaterial({ color: c });
function part(group, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); group.add(m); return m;
}
const metal = L(0x2a2a2a), wood = L(0x7a4a22), sleeve = L(0x3e4a2c), glove = L(0x1c1c1c), silver = L(0x9a9a9a);
function makeVM(kind) {
  const g = new THREE.Group();
  let muzzle;
  if (kind === 'ak') {
    part(g, metal, 0.055, 0.075, 0.34, 0, 0, 0);
    part(g, metal, 0.022, 0.022, 0.36, 0, 0.012, -0.33);
    part(g, metal, 0.016, 0.016, 0.3, 0, 0.042, -0.22);
    part(g, wood, 0.066, 0.06, 0.18, 0, -0.006, -0.22);
    part(g, wood, 0.05, 0.085, 0.26, 0, -0.035, 0.28, 0.12);
    part(g, metal, 0.04, 0.17, 0.07, 0, -0.11, -0.05, 0.3);
    part(g, wood, 0.04, 0.1, 0.05, 0, -0.08, 0.1, -0.35);
    part(g, metal, 0.01, 0.04, 0.01, 0, 0.04, -0.47);
    muzzle = new THREE.Vector3(0, 0.012, -0.53);
  } else if (kind === 'deagle') {
    part(g, silver, 0.04, 0.05, 0.24, 0, 0, -0.05);
    part(g, silver, 0.022, 0.022, 0.06, 0, -0.005, -0.18);
    part(g, glove, 0.036, 0.13, 0.06, 0, -0.08, 0.05, -0.25);
    part(g, metal, 0.03, 0.02, 0.06, 0, -0.035, -0.01);
    muzzle = new THREE.Vector3(0, 0, -0.2);
  } else {
    part(g, silver, 0.008, 0.035, 0.22, 0, 0, -0.14);
    part(g, metal, 0.03, 0.035, 0.11, 0, -0.003, 0.02);
    part(g, metal, 0.05, 0.05, 0.012, 0, 0, -0.035);
    muzzle = new THREE.Vector3(0, 0, -0.25);
  }
  // arm + hand
  part(g, sleeve, 0.08, 0.08, 0.32, 0.05, -0.12, 0.25, 0.25);
  part(g, glove, 0.07, 0.07, 0.08, 0.01, -0.07, kind === 'ak' ? 0.1 : 0.05);
  if (kind === 'ak') { part(g, sleeve, 0.08, 0.08, 0.3, -0.12, -0.13, -0.05, 0.2, -0.6); part(g, glove, 0.07, 0.06, 0.08, -0.02, -0.05, -0.2); }
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.copy(muzzle); flash.visible = false; g.add(flash);
  g.visible = false; g.scale.setScalar(0.72); vmScene.add(g);
  return { g, flash, muzzle };
}
const VM = { ak: makeVM('ak'), deagle: makeVM('deagle'), knife: makeVM('knife') };

/* ============================================================
   WEAPONS
   ============================================================ */
const WEAPONS = {
  ak: { name: 'AK-47', dmg: 36, rate: 0.1, auto: true, mag: 30, reserve: 90, reload: 2.45, spread: 0.0045, moveSpread: 0.05, airSpread: 0.13, recoil: 0.8, maxSpeed: 221, hs: 4, falloff: 0.98, sfx: 'ak' },
  deagle: { name: 'Desert Eagle', dmg: 54, rate: 0.225, auto: false, mag: 7, reserve: 35, reload: 2.2, spread: 0.006, moveSpread: 0.045, airSpread: 0.18, recoil: 2.2, maxSpeed: 250, hs: 4, falloff: 0.81, sfx: 'deagle' },
  knife: { name: 'Knife', melee: true, dmg: 40, stab: 65, rate: 0.42, maxSpeed: 250 },
};
const SLOT = { Digit1: 'ak', Digit2: 'deagle', Digit3: 'knife' };

/* ============================================================
   PLAYER
   ============================================================ */
const player = {
  pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: Math.PI, pitch: 0, onGround: false, duck: false, eyeOff: EYE_STAND, hp: 100, alive: true,
  jumpAt: -1, weapon: 'ak', lastWeapon: 'deagle', ammo: {}, nextFire: 0, reloading: 0, drawT: 0,
  shots: 0, punch: 0, punchYaw: 0, stepT: 0, deathT: 0, kills: 0, deaths: 0,
};
const keys = {};
let mouseL = false, mouseR = false, triggerUp = true, simTime = 0, running = false;

function hspeed() { return Math.hypot(player.vel.x, player.vel.z); }

function physicsTick(dt) {
  const p = player, P = p.pos;
  simTime += dt;
  p.prev.copy(P);
  if (!p.alive) return;

  // ---- duck (ducking in the air pulls the legs up, like GoldSrc) ----
  const wantDuck = keys.ControlLeft || keys.ControlRight || keys.KeyC;
  if (wantDuck && !p.duck) {
    if (!p.onGround) { P.y += STAND_H - DUCK_H; p.prev.y += STAND_H - DUCK_H; p.eyeOff -= STAND_H - DUCK_H; }
    p.duck = true;
  } else if (!wantDuck && p.duck) {
    if (p.onGround) { if (!overlapAt(P.x, P.y, P.z, STAND_H)) p.duck = false; }
    else if (!overlapAt(P.x, P.y - 36, P.z, STAND_H)) { P.y -= 36; p.prev.y -= 36; p.eyeOff += 36; p.duck = false; }
    else if (!overlapAt(P.x, P.y, P.z, STAND_H)) p.duck = false;
  }
  const H = p.duck ? DUCK_H : STAND_H;

  // ---- wish direction ----
  const fm = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), sm = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * fm + cy * sm, wz = -cy * fm - sy * sm;
  const wl = Math.hypot(wx, wz);
  let wishspeed = 0;
  if (wl > 0) {
    wx /= wl; wz /= wl;
    wishspeed = WEAPONS[p.weapon].maxSpeed;
    if (p.duck && p.onGround) wishspeed *= 0.333; else if (keys.ShiftLeft || keys.ShiftRight) wishspeed *= 0.52;
  }

  // ---- jump: friction is skipped on the tick you jump => bhop ----
  let jumped = false;
  const wantJump = (settings.autoBhop && keys.Space) || (simTime - p.jumpAt < 0.06);
  if (p.onGround && wantJump) { p.vel.y = JUMP_V; p.onGround = false; jumped = true; p.jumpAt = -1; }

  if (p.onGround) {
    const sp = hspeed();
    if (sp > 0.1) {
      const control = sp < STOPSPEED ? STOPSPEED : sp;
      const ns = Math.max(0, sp - control * FRICTION * dt) / sp;
      p.vel.x *= ns; p.vel.z *= ns;
    } else { p.vel.x = p.vel.z = 0; }
    const cur = p.vel.x * wx + p.vel.z * wz, add = wishspeed - cur;
    if (add > 0) { const as = Math.min(add, ACCEL * dt * wishspeed); p.vel.x += as * wx; p.vel.z += as * wz; }
  } else {
    // air acceleration: wishspeed capped at 30 for the projection, but the accel uses the full wishspeed
    const cur = p.vel.x * wx + p.vel.z * wz, add = Math.min(wishspeed, 30) - cur;
    if (add > 0) { const as = Math.min(add, settings.airAccel * wishspeed * dt); p.vel.x += as * wx; p.vel.z += as * wz; }
    p.vel.y -= GRAVITY * dt * 0.5;
  }

  const wasGround = p.onGround, fallSpeed = -p.vel.y;

  // ---- horizontal move with step-up ----
  const sx = P.x, syy = P.y, sz = P.z;
  let hx = collideAxis(P, 0, p.vel.x * dt, H), hz = collideAxis(P, 2, p.vel.z * dt, H);
  if ((hx || hz) && wasGround) {
    const ax = P.x, ay = P.y, az = P.z;
    P.set(sx, syy, sz);
    collideAxis(P, 1, STEP, H);
    const hx2 = collideAxis(P, 0, p.vel.x * dt, H), hz2 = collideAxis(P, 2, p.vel.z * dt, H);
    collideAxis(P, 1, -(P.y - syy), H);
    if ((P.x - sx) ** 2 + (P.z - sz) ** 2 > (ax - sx) ** 2 + (az - sz) ** 2 + 1e-4) { hx = hx2; hz = hz2; }
    else P.set(ax, ay, az);
  }
  if (hx) p.vel.x = 0;
  if (hz) p.vel.z = 0;

  // ---- vertical ----
  if (p.vel.y !== 0 && collideAxis(P, 1, p.vel.y * dt, H)) p.vel.y = 0;
  if (!p.onGround) p.vel.y -= GRAVITY * dt * 0.5;

  // ---- ground check (+ step down stairs) ----
  const probe = d => { const q = { x: P.x, y: P.y, z: P.z }; return collideAxis(q, 1, -d, H) ? q.y : null; };
  let g = null;
  if (p.vel.y <= 0) {
    g = probe(1);
    if (g === null && wasGround && !jumped) g = probe(STEP + 1);
  }
  if (g !== null) {
    if (!wasGround && fallSpeed > 300) SFX.land(fallSpeed);
    P.y = g; p.onGround = true; p.vel.y = 0;
  } else p.onGround = false;

  // footsteps
  if (p.onGround && hspeed() > 150 && !(keys.ShiftLeft || p.duck)) { p.stepT -= dt; if (p.stepT <= 0) { SFX.step(); p.stepT = 0.33; } }
}

/* ============================================================
   SHOOTING
   ============================================================ */
function currentSpread() {
  const w = WEAPONS[player.weapon]; if (w.melee) return 0;
  let s;
  if (!player.onGround) s = w.airSpread;
  else s = w.spread + w.moveSpread * clamp((hspeed() - 60) / 190, 0, 1);
  if (player.duck && player.onGround) s *= 0.7;
  if (w.auto) s += Math.min(player.shots, 12) * 0.0028;
  return s;
}
function viewDir(yaw, pitch) { return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); }
function eyePos() { return new THREE.Vector3(player.pos.x, player.pos.y + player.eyeOff, player.pos.z); }

// nearest hit: world or bot
function traceShot(o, d, range) {
  const wh = rayWorld(o.x, o.y, o.z, d.x, d.y, d.z, range);
  let best = wh ? wh.t : range, bot = null, head = false;
  for (const b of bots) {
    if (!b.alive || !b.active) continue;
    const { x, y, z } = b.pos;
    const th = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, x - 8, y + 60, z - 8, x + 8, y + 76, z + 8);
    if (th < best) { best = th; bot = b; head = true; }
    const tb = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, x - 14, y, z - 14, x + 14, y + 60, z + 14);
    if (tb < best) { best = tb; bot = b; head = false; }
  }
  return { t: best, bot, head, world: !bot && wh ? wh : null };
}

function fire(alt = false) {
  const p = player, w = WEAPONS[p.weapon];
  if (p.drawT > 0 || p.reloading > 0 || !p.alive) return;
  const o = eyePos();
  if (w.melee) {
    const d = viewDir(p.yaw, p.pitch);
    const h = traceShot(o, d, 64);
    p.nextFire = simTime + (alt ? 1.0 : w.rate);
    SFX.knife(); vmKick = alt ? 0.12 : 0.07; vmKnifeSwing = 1;
    if (h.bot) { damageBot(h.bot, alt ? w.stab : w.dmg, false, w.name); addPuff(o.clone().addScaledVector(d, h.t), 0xaa1010, 12); }
    else if (h.world) { SFX.ricochet(); addPuff(o.clone().addScaledVector(d, h.t), 0xc8b090, 8); }
    return;
  }
  const am = p.ammo[p.weapon];
  if (am.mag <= 0) { SFX.click(); p.nextFire = simTime + 0.25; if (am.res > 0) startReload(); return; }
  am.mag--; p.shots++;
  p.nextFire = simTime + w.rate;

  // spread cone around (view + punch)
  const sp = currentSpread();
  const yaw = p.yaw + p.punchYaw, pitch = p.pitch + p.punch;
  const d = viewDir(yaw, pitch);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), up = new THREE.Vector3().crossVectors(right, d);
  const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * sp;
  d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();

  const h = traceShot(o, d, 8192);
  const hit = o.clone().addScaledVector(d, h.t);
  if (h.bot) {
    const dmg = w.dmg * (h.head ? w.hs : 1) * Math.pow(w.falloff, h.t / 500);
    damageBot(h.bot, dmg, h.head, w.name);
    addPuff(hit, 0x9a0c0c, h.head ? 22 : 14, 0.4, 5);
  } else if (h.world) {
    const n = new THREE.Vector3(h.world.nx, h.world.ny, h.world.nz);
    addHole(hit, n); addPuff(hit.clone().addScaledVector(n, 2), 0xd8c49a, 16, 0.5, 25);
  }
  const muzzleWorld = o.clone().addScaledVector(viewDir(p.yaw, p.pitch), 30).add(new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)).multiplyScalar(6)).add(new THREE.Vector3(0, -6, 0));
  if (rand() < 0.5) addTracer(muzzleWorld, hit);

  // recoil (view punch)
  const kick = w.recoil * (1 + Math.min(p.shots, 8) * 0.12) * (p.onGround ? 1 : 1.6);
  p.punch += THREE.MathUtils.degToRad(kick);
  if (p.shots > 3 || !w.auto) p.punchYaw += THREE.MathUtils.degToRad((rand() - 0.5) * kick * 1.2);
  p.punch = Math.min(p.punch, THREE.MathUtils.degToRad(12));

  SFX[w.sfx]();
  vmKick = w.auto ? 0.035 : 0.07; vmFlashT = 0.04;
  muzzleLight.position.copy(muzzleWorld); muzzleLight.intensity = 3; muzzleT = 0.04;

  // gunfire alerts nearby bots
  for (const b of bots) if (b.alive && b.active && b.pos.distanceTo(p.pos) < 2200 && !b.sees) { b.alertT = 3; b.hunt(p.pos); }
}
function startReload() {
  const p = player, w = WEAPONS[p.weapon]; if (w.melee) return;
  const am = p.ammo[p.weapon]; if (p.reloading > 0 || am.mag >= w.mag || am.res <= 0) return;
  p.reloading = w.reload; SFX.reload();
}
function switchWeapon(name) {
  const p = player; if (name === p.weapon || !p.alive) return;
  p.lastWeapon = p.weapon; p.weapon = name; p.reloading = 0; p.drawT = 0.45; p.shots = 0;
  for (const k in VM) VM[k].g.visible = k === name;
  updateHUD(true);
}

/* ============================================================
   BOTS
   ============================================================ */
const BOT_NAMES = ['Gravel', 'Mirage', 'Scorpion', 'Dune', 'Viper', 'Sandman', 'Jackal', 'Cobra', 'Nomad', 'Sirocco', 'Falcon', 'Rattler'];
const DIFF = { easy: { acc: 0.6, react: 1.6, dmg: 0.8 }, normal: { acc: 1, react: 1, dmg: 1 }, hard: { acc: 1.35, react: 0.6, dmg: 1.15 } };
function makeBotMesh() {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const cloth = L(0x7a6644), pants = L(0x4d4535), vest = L(0x3a3628), mask = L(0x1d1d1d), skin = L(0xb48a64), gunM = L(0x222222);
  const leg = x => { const pv = new THREE.Group(); pv.position.set(x, 32, 0); const m = new THREE.Mesh(new THREE.BoxGeometry(10, 32, 11), pants); m.position.y = -16; pv.add(m); g.add(pv); return pv; };
  const legL = leg(-6), legR = leg(6);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); g.add(m); return m; };
  add(new THREE.BoxGeometry(26, 30, 15), cloth, 0, 47, 0);
  add(new THREE.BoxGeometry(28, 18, 17), vest, 0, 50, 0);
  add(new THREE.BoxGeometry(14, 15, 14), mask, 0, 69, 0);
  add(new THREE.BoxGeometry(10, 4, 1), skin, 0, 71, -7.2);
  add(new THREE.BoxGeometry(8, 8, 24), cloth, 11, 53, -9, 0.15);
  add(new THREE.BoxGeometry(8, 8, 22), cloth, -9, 52, -13, 0.1, -0.5);
  add(new THREE.BoxGeometry(4, 7, 36), gunM, 4, 55, -26);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; scene.add(g);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(26); flash.position.set(4, 56, -46); flash.visible = false; g.add(flash);
  return { g, legL, legR, flash };
}
class Bot {
  constructor(i) {
    this.name = BOT_NAMES[i % BOT_NAMES.length]; this.m = makeBotMesh();
    this.pos = new THREE.Vector3(); this.active = false;
  }
  spawn(r, c) {
    const p = cellCenter(r, c); p.x += (rand() - .5) * 40; p.z += (rand() - .5) * 40; p.y = floorHeight(p.x, p.z);
    Object.assign(this, { alive: true, active: true, hp: 100, yaw: 0, path: [], sees: false, seeT: 0, react: 0, fireCd: 0, burst: 0, walkT: 0, deathT: 0, alertT: 0, lastKnown: null, flashT: 0, idleT: rand() * 1.5, strafe: 0 });
    this.pos.copy(p);
    this.m.g.visible = true; this.m.g.rotation.set(0, 0, 0); this.m.g.position.copy(p);
    this.goTo(pick([GOALS.A, GOALS.B, GOALS.mid, GOALS.long, GOALS.B])[0]);
  }
  goTo([r, c]) {
    const sr = Math.floor(this.pos.z / CELL), sc = Math.floor(this.pos.x / CELL);
    this.path = findPath(sr, sc, r, c);
  }
  hunt(v) { this.goTo([Math.floor(v.z / CELL), Math.floor(v.x / CELL)]); }
  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 68, this.pos.z); }
  canSee() {
    if (!player.alive) return false;
    const e = this.eye(), pe = eyePos();
    const dx = pe.x - e.x, dz = pe.z - e.z, dist = Math.hypot(dx, pe.y - e.y, dz);
    if (dist > 4000) return false;
    if (this.alertT <= 0 && !this.sees) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if ((fx * dx + fz * dz) / Math.hypot(dx, dz) < Math.cos(THREE.MathUtils.degToRad(80))) return false;
    }
    for (const ty of [pe.y, player.pos.y + (player.duck ? 20 : 40)]) {
      const d = new THREE.Vector3(pe.x - e.x, ty - e.y, pe.z - e.z); const len = d.length(); d.divideScalar(len);
      const h = rayWorld(e.x, e.y, e.z, d.x, d.y, d.z, len);
      if (!h) return true;
    }
    return false;
  }
  update(dt) {
    const g = this.m.g;
    if (!this.alive) {
      this.deathT += dt; g.rotation.x = -Math.min(1, this.deathT * 3.5) * Math.PI / 2;
      g.position.y = this.pos.y + 6 * Math.min(1, this.deathT * 3.5); return;
    }
    const D = DIFF[settings.diff];
    this.alertT -= dt; this.seeT -= dt; this.flashT -= dt;
    this.m.flash.visible = this.flashT > 0;
    if (this.seeT <= 0) {
      this.seeT = 0.1;
      const s = this.canSee();
      if (s && !this.sees) this.react = (0.35 + rand() * 0.4) * D.react;
      this.sees = s;
      if (s) this.lastKnown = player.pos.clone();
    }
    let moving = false;
    if (this.sees) {
      const pe = eyePos();
      this.turnTo(Math.atan2(-(pe.x - this.pos.x), -(pe.z - this.pos.z)), 14, dt);
      this.react -= dt;
      if (this.react <= 0) {
        this.fireCd -= dt;
        if (this.fireCd <= 0) { this.shoot(); this.burst++; this.fireCd = this.burst % (3 + ((rand() * 3) | 0)) === 0 ? 0.45 + rand() * 0.4 : 0.12; }
      }
      // little strafe while fighting
      this.strafe -= dt;
      if (this.strafe < -0.6) this.strafe = 0.5 + rand() * 0.6;
      if (this.strafe > 0) {
        const sdir = Math.sin(simTime * 2 + this.name.length) > 0 ? 1 : -1;
        const nx = this.pos.x + Math.cos(this.yaw) * sdir * 90 * dt, nz = this.pos.z - Math.sin(this.yaw) * sdir * 90 * dt;
        const ci = cellAt(nx, nz); if (ci && ci.walk && Math.abs(floorHeight(nx, nz) - this.pos.y) < 20) { this.pos.x = nx; this.pos.z = nz; moving = true; }
      }
    } else {
      if (this.path.length === 0) {
        this.idleT -= dt;
        if (this.idleT <= 0) {
          this.idleT = 0.5 + rand() * 2;
          if (this.lastKnown && rand() < 0.75) { this.hunt(this.lastKnown); this.lastKnown = null; }
          else this.goTo(pick(ALL_GOALS));
        }
      } else {
        const wp = this.path[0];
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, dist = Math.hypot(dx, dz);
        const step = 190 * dt;
        if (dist <= step) { this.pos.x = wp.x; this.pos.z = wp.z; this.path.shift(); }
        else { this.pos.x += dx / dist * step; this.pos.z += dz / dist * step; }
        this.turnTo(Math.atan2(-dx, -dz), 7, dt);
        moving = true;
      }
    }
    this.pos.y = floorHeight(this.pos.x, this.pos.z);
    if (moving) this.walkT += dt * 9;
    const sw = moving ? Math.sin(this.walkT) * 0.6 : 0;
    this.m.legL.rotation.x = sw; this.m.legR.rotation.x = -sw;
    g.position.copy(this.pos); g.rotation.y = this.yaw;
  }
  turnTo(target, rate, dt) {
    let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += clamp(d, -rate * dt, rate * dt);
  }
  shoot() {
    const D = DIFF[settings.diff];
    const e = this.eye(); e.y -= 12;
    const dist = e.distanceTo(player.pos);
    SFX.enemy(dist);
    this.flashT = 0.05;
    let chance = 0.42 * D.acc - dist / 6000 - hspeed() / 1100 - (player.onGround ? 0 : 0.12) - (player.duck ? 0.04 : 0);
    if (this.burst % 5 === 0) chance += 0.1; // first bullet accuracy
    chance = clamp(chance, 0.05, 0.75);
    const target = new THREE.Vector3(player.pos.x, player.pos.y + (player.duck ? 24 : 44), player.pos.z);
    if (rand() < chance) {
      const hs = rand() < 0.05 * D.acc;
      damagePlayer(hs ? 85 : (16 + rand() * 12) * D.dmg, this, hs);
      addTracer(e, target);
    } else {
      const miss = target.clone().add(new THREE.Vector3((rand() - .5) * 90, (rand() - .3) * 70, (rand() - .5) * 90));
      const d = miss.clone().sub(e).normalize();
      const h = rayWorld(e.x, e.y, e.z, d.x, d.y, d.z, 8000);
      if (h) {
        const p = e.clone().addScaledVector(d, h.t); addTracer(e, p);
        const n = new THREE.Vector3(h.nx, h.ny, h.nz); addHole(p, n); addPuff(p.clone().addScaledVector(n, 2), 0xd8c49a, 14, 0.45, 25);
        if (p.distanceTo(eyePos()) < 120) SFX.ricochet();
      } else addTracer(e, miss);
    }
  }
}
const bots = Array.from({ length: 10 }, (_, i) => new Bot(i));

function damageBot(b, dmg, head, weaponName) {
  if (!b.alive) return;
  b.hp -= dmg;
  b.alertT = 3; b.lastKnown = player.pos.clone();
  if (!b.sees) b.turnTo(Math.atan2(-(player.pos.x - b.pos.x), -(player.pos.z - b.pos.z)), 100, 1);
  if (head) SFX.headshot(); else SFX.hit();
  if (b.hp <= 0) {
    b.alive = false; b.deathT = 0; b.m.flash.visible = false;
    player.kills++;
    killFeed('You', 'ct', weaponName, b.name, 'tt', head, true);
  }
}
function damagePlayer(dmg, from, hs) {
  const p = player; if (!p.alive || game.phase !== 'live') return;
  p.hp = Math.max(0, Math.round(p.hp - dmg));
  dmgFlash = Math.min(1, dmgFlash + 0.5); SFX.hurt();
  p.punch += THREE.MathUtils.degToRad(1.5); // aim punch
  if (p.hp <= 0) {
    p.alive = false; p.deaths++; p.deathT = 0;
    for (const k in VM) VM[k].g.visible = false;
    killFeed(from.name, 'tt', 'AK-47', 'You', 'ct', hs, true);
  }
  updateHUD();
}

/* ============================================================
   ROUNDS
   ============================================================ */
const ROUND_TIME = 115;
const game = { ct: 0, t: 0, phase: 'live', time: ROUND_TIME, endT: 0 };
function startRound() {
  const p = player;
  const [r, c] = pick(CT_SPAWNS); const s = cellCenter(r, c);
  p.pos.set(s.x + (rand() - .5) * 30, cellInfo[r][c].h + EPS, s.z + (rand() - .5) * 30); p.prev.copy(p.pos);
  p.vel.set(0, 0, 0); p.yaw = Math.PI; p.pitch = 0; p.hp = 100; p.alive = true; p.duck = false; p.eyeOff = EYE_STAND; p.onGround = false;
  p.punch = p.punchYaw = 0; p.reloading = 0; p.shots = 0; p.drawT = 0.3;
  for (const k of ['ak', 'deagle']) p.ammo[k] = { mag: WEAPONS[k].mag, res: WEAPONS[k].reserve };
  for (const k in VM) VM[k].g.visible = k === p.weapon;
  const spawns = [...T_SPAWNS].sort(() => rand() - .5);
  bots.forEach((b, i) => {
    if (i < settings.bots) b.spawn(...spawns[i % spawns.length]);
    else { b.active = false; b.alive = false; b.m.g.visible = false; }
  });
  for (const h of holes) h.visible = false;
  game.phase = 'live'; game.time = ROUND_TIME;
  showCenter('', '');
  updateHUD(true);
}
function endRound(winner) {
  if (game.phase !== 'live') return;
  game.phase = 'end'; game.endT = 4.5;
  if (winner === 'ct') game.ct++; else game.t++;
  showCenter(winner === 'ct' ? 'Counter-Terrorists Win' : 'Terrorists Win', player.alive ? 'Next round starting…' : 'You died — next round starting…');
  updateHUD(true);
}
function updateRound(dt) {
  if (game.phase === 'live') {
    game.time -= dt;
    if (!player.alive) endRound('t');
    else if (bots.every(b => !b.active || !b.alive)) endRound('ct');
    else if (game.time <= 0) endRound('ct');
  } else {
    game.endT -= dt;
    if (game.endT <= 0) startRound();
  }
}

/* ============================================================
   HUD
   ============================================================ */
const $ = id => document.getElementById(id);
const hud = { hp: $('hpVal'), hpBox: $('hp'), speed: $('speedVal'), speedBox: $('speed'), mag: $('magVal'), res: $('resVal'), wname: $('weaponName'), timer: $('timer'), ct: $('ctScore'), t: $('tScore'), alive: $('alive'), feed: $('feed'), center: $('center'), dmg: $('dmg'), cross: document.querySelectorAll('#crosshair i') };
let dmgFlash = 0, crossGap = 6;
function showCenter(title, sub) { hud.center.innerHTML = title ? `${title}<small>${sub}</small>` : ''; hud.center.classList.toggle('show', !!title); }
function killFeed(a, ac, weapon, v, vc, hs, me) {
  const d = document.createElement('div'); if (me) d.className = 'me';
  d.innerHTML = `<span class="${ac}">${a}</span><span class="w">[${weapon}]</span><span class="${vc}">${v}</span>${hs ? '<span class="hs">✛HS</span>' : ''}`;
  hud.feed.appendChild(d); setTimeout(() => d.remove(), 5000);
  while (hud.feed.children.length > 5) hud.feed.firstChild.remove();
}
let lastHudTxt = '';
function updateHUD(force) {
  const p = player, w = WEAPONS[p.weapon];
  const t = Math.max(0, Math.ceil(game.time));
  const sp = Math.round(hspeed());
  const am = w.melee ? null : p.ammo[p.weapon];
  const txt = [p.hp, sp, am?.mag, am?.res, t, game.ct, game.t, p.weapon].join();
  if (txt === lastHudTxt && !force) return; lastHudTxt = txt;
  hud.hp.textContent = p.hp; hud.hpBox.classList.toggle('low', p.hp <= 25);
  hud.speed.textContent = sp; hud.speedBox.className = sp > 450 ? 'vfast' : sp > 280 ? 'fast' : '';
  hud.mag.textContent = am ? am.mag : '—'; hud.res.textContent = am ? am.res : '—'; hud.wname.textContent = w.name;
  hud.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  hud.ct.textContent = game.ct; hud.t.textContent = game.t;
  const alive = bots.filter(b => b.active && b.alive).length;
  hud.alive.textContent = `Terrorists alive: ${alive}  ·  K ${p.kills} / D ${p.deaths}`;
}
function updateCrosshair(dt) {
  const target = 5 + currentSpread() * 700 + (player.shots > 0 && simTime - player.nextFire < 0.15 ? 4 : 0);
  crossGap += (target - crossGap) * Math.min(1, dt * 14);
  const g = crossGap;
  const [t, b, l, r] = hud.cross;
  t.style.top = `${-g - 8}px`; b.style.top = `${g}px`; l.style.left = `${-g - 8}px`; r.style.left = `${g}px`;
}

/* ============================================================
   INPUT
   ============================================================ */
addEventListener('keydown', e => {
  if (!running) return;
  if (e.code === 'Space' && !keys.Space) player.jumpAt = simTime;
  keys[e.code] = true;
  if (SLOT[e.code]) switchWeapon(SLOT[e.code]);
  if (e.code === 'KeyQ') switchWeapon(player.lastWeapon);
  if (e.code === 'KeyR') startReload();
  if (['Space', 'Tab', 'ControlLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('wheel', e => { if (running) { player.jumpAt = simTime; e.preventDefault(); } }, { passive: false });
addEventListener('mousedown', e => {
  if (!running) return;
  if (e.button === 0) { mouseL = true; triggerUp = true; }
  if (e.button === 2) mouseR = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
let swayX = 0, swayY = 0;
addEventListener('mousemove', e => {
  if (!running || !player.alive) return;
  const k = settings.sens * 0.022 * Math.PI / 180;
  player.yaw -= e.movementX * k; player.pitch -= e.movementY * k;
  player.pitch = clamp(player.pitch, -1.55, 1.55);
  swayX += e.movementX * 0.00006 * settings.sens; swayY += e.movementY * 0.00006 * settings.sens;
});

/* ============================================================
   MENU / POINTER LOCK
   ============================================================ */
const menu = $('menu'), hudEl = $('hud');
function bindSetting(id, key, fmt = v => v, parse = parseFloat, onChange) {
  const el = $(id), out = $(id + 'Out');
  if (el.type === 'checkbox') { el.checked = settings[key]; el.onchange = () => { settings[key] = el.checked; saveSettings(); }; return; }
  el.value = settings[key]; if (out) out.textContent = fmt(settings[key]);
  el.oninput = () => { settings[key] = parse(el.value); if (out) out.textContent = fmt(settings[key]); saveSettings(); onChange?.(); };
}
bindSetting('sens', 'sens', v => v.toFixed(1));
bindSetting('fov', 'fov', v => v + '°', parseFloat, applyFov);
bindSetting('aa', 'airAccel');
bindSetting('bots', 'bots', v => v, v => parseInt(v));
bindSetting('vol', 'volume', v => Math.round(v * 100) + '%', parseFloat, () => { if (master) master.gain.value = settings.volume; });
bindSetting('diff', 'diff', v => v, v => v);
bindSetting('autobhop', 'autoBhop');

let started = false;
$('play').onclick = () => {
  initAudio();
  const r = canvas.requestPointerLock?.({ unadjustedMovement: true });
  if (r && r.catch) r.catch(() => canvas.requestPointerLock()?.catch?.(() => {}));
};
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  running = locked;
  menu.classList.toggle('hidden', locked);
  hudEl.classList.toggle('hidden', !locked && !started);
  if (locked) {
    if (!started) { started = true; startRound(); }
    $('play').textContent = 'RESUME';
  } else {
    for (const k in keys) keys[k] = false; mouseL = mouseR = false;
    $('stats').textContent = started ? `Score CT ${game.ct} – ${game.t} T   ·   Kills ${player.kills}   ·   Deaths ${player.deaths}` : '';
  }
});

/* ============================================================
   MAIN LOOP
   ============================================================ */
let vmKick = 0, vmFlashT = 0, muzzleT = 0, vmKnifeSwing = 0, bobT = 0, acc = 0, last = performance.now();
const vmBase = { ak: [0.15, -0.155, -0.36], deagle: [0.13, -0.12, -0.3], knife: [0.15, -0.13, -0.28] };

function update(dt) {
  const p = player;
  // weapons
  if (p.alive) {
    p.drawT = Math.max(0, p.drawT - dt);
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) { const w = WEAPONS[p.weapon], am = p.ammo[p.weapon]; const take = Math.min(w.mag - am.mag, am.res); am.mag += take; am.res -= take; p.reloading = 0; p.shots = 0; }
    }
    const w = WEAPONS[p.weapon];
    if (mouseL && simTime >= p.nextFire && (w.auto || w.melee || triggerUp)) { fire(false); triggerUp = false; }
    else if (mouseR && w.melee && simTime >= p.nextFire) fire(true);
    if (!mouseL) { triggerUp = true; if (simTime > p.nextFire + 0.05) p.shots = Math.max(0, p.shots - dt * 25); }
    // recoil recovery
    const rec = Math.min(1, dt * (mouseL && w.auto ? 3 : 9));
    p.punch -= p.punch * rec; p.punchYaw -= p.punchYaw * rec;
    // auto reload when empty
    if (!w.melee && p.ammo[p.weapon].mag === 0 && p.ammo[p.weapon].res > 0 && p.reloading <= 0 && simTime > p.nextFire) startReload();
  }
  for (const b of bots) if (b.active) b.update(dt);
  updateRound(dt);
  updateEffects(dt);
  p.eyeOff += ((p.duck ? EYE_DUCK : EYE_STAND) - p.eyeOff) * Math.min(1, dt * 14);
  if (!p.alive) p.deathT += dt;
  dmgFlash = Math.max(0, dmgFlash - dt * 1.8); hud.dmg.style.opacity = dmgFlash;
  muzzleT -= dt; if (muzzleT <= 0) muzzleLight.intensity = 0;
  updateHUD(); updateCrosshair(dt);
}

function render(dt) {
  const p = player, a = clamp(acc / TICK, 0, 1);
  const x = p.prev.x + (p.pos.x - p.prev.x) * a, y = p.prev.y + (p.pos.y - p.prev.y) * a, z = p.prev.z + (p.pos.z - p.prev.z) * a;
  if (p.alive) {
    camera.position.set(x, y + p.eyeOff, z);
    camera.rotation.set(p.pitch + p.punch, p.yaw + p.punchYaw, 0);
  } else {
    const k = Math.min(1, p.deathT * 2.5);
    camera.position.set(x, y + p.eyeOff - k * (p.eyeOff - 12), z);
    camera.rotation.set(p.pitch * (1 - k), p.yaw, k * 0.5);
  }
  // viewmodel
  const vm = VM[p.weapon], base = vmBase[p.weapon];
  const sp = p.onGround ? hspeed() : 0;
  bobT += dt * (sp > 20 ? 10 : 0);
  const bob = Math.min(1, sp / 250) * 0.008;
  swayX *= Math.pow(0.0005, dt); swayY *= Math.pow(0.0005, dt);
  vmKick *= Math.pow(0.0001, dt); vmKnifeSwing = Math.max(0, vmKnifeSwing - dt * 3);
  const draw = p.drawT > 0 ? p.drawT / 0.45 : 0;
  const rl = p.reloading > 0 ? Math.sin(Math.min(1, (WEAPONS[p.weapon].reload - p.reloading) / WEAPONS[p.weapon].reload) * Math.PI) : 0;
  vm.g.position.set(base[0] + Math.cos(bobT * 0.5) * bob - clamp(swayX, -0.04, 0.04), base[1] + Math.abs(Math.sin(bobT * 0.5)) * bob - draw * 0.25 - rl * 0.12 + clamp(swayY, -0.04, 0.04) + (p.onGround ? 0 : 0.01), base[2] + vmKick);
  vm.g.rotation.set(vmKick * 1.5 - rl * 0.7 + draw * 0.6, vmKnifeSwing * 0.9, vmKnifeSwing * -0.6 + rl * 0.3);
  vmFlashT -= dt; vm.flash.visible = vmFlashT > 0; if (vm.flash.visible) vm.flash.rotation.z = rand() * 6;

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  if (p.alive) renderer.render(vmScene, vmCam);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) {
    acc += dt;
    while (acc >= TICK) { physicsTick(TICK); acc -= TICK; }
    update(dt);
  } else if (!started) {
    // attract mode: slow orbit over the map
    const t = now / 1000 * 0.05;
    camera.position.set(MW * CELL / 2 + Math.cos(t) * 1700, 1500, MH * CELL / 2 + Math.sin(t) * 1700);
    camera.lookAt(MW * CELL / 2, 0, MH * CELL / 2);
    renderer.clear(); renderer.render(scene, camera); return;
  }
  render(dt);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = vmCam.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
});

// debug hook for testing
window.__game = { player, bots, game, keys, startRound, physicsTick, settings, findPath, floorHeight, set running(v) { running = v; }, get running() { return running; } };

requestAnimationFrame(frame);
