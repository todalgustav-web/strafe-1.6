// STRAFE 1.6 — a tiny GoldSrc-style shooter in the browser.
// Units are "Hammer units" like the original engine: player is 32x72, runs 250 u/s.
import * as THREE from 'three';

/* ============================================================
   SETTINGS + TUNABLE PHYSICS (most are console cvars)
   ============================================================ */
const DEFAULTS = { name: 'Player', sens: 2.0, fov: 90, airAccel: 10, bots: 5, volume: 0.5, diff: 'normal', autoBhop: true, radio: true, showfps: false, showpos: false, crosshairColor: '50 250 50' };
const settings = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem('strafe16') || '{}'); } catch { return {}; } })());
const saveSettings = () => { try { localStorage.setItem('strafe16', JSON.stringify(settings)); } catch {} };

const phys = { gravity: 800, friction: 4, stopspeed: 75, accelerate: 5 };
const rules = { roundtime: 1.92, freezetime: 3, buytime: 1.5, startmoney: 800 };
const cheats = { enabled: false, god: false, noclip: false };

const TICK = 1 / 100;
const HW = 16, STAND_H = 72, DUCK_H = 36, EYE_STAND = 64, EYE_DUCK = 28, STEP = 18, EPS = 0.03;
const jumpV = () => Math.sqrt(2 * phys.gravity * 45);

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
camera.fov = vfov(settings.fov); camera.updateProjectionMatrix();

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
   EXTRA SOUNDS
   ============================================================ */
SFX.shot = kind => ({
  pistol() { sNoise({ vol: 0.7, freq: 3800, decay: 0.12 }); sTone({ vol: 0.5, f0: 170, f1: 60, decay: 0.08 }); },
  deagle() { sNoise({ vol: 1, freq: 3000, decay: 0.28 }); sTone({ vol: 0.9, f0: 120, f1: 35, decay: 0.2 }); },
  smg() { sNoise({ vol: 0.6, freq: 5000, decay: 0.09 }); sTone({ vol: 0.35, f0: 200, f1: 70, decay: 0.07 }); },
  rifle() { sNoise({ vol: 0.9, freq: 4200, decay: 0.16 }); sNoise({ vol: 0.5, freq: 900, decay: 0.3 }); sTone({ vol: 0.7, f0: 160, f1: 45, decay: 0.12 }); },
  shotgun() { sNoise({ vol: 1, freq: 2200, decay: 0.35 }); sTone({ vol: 1, f0: 110, f1: 30, decay: 0.25 }); },
  sniper() { sNoise({ vol: 1, freq: 2600, decay: 0.55 }); sNoise({ vol: 0.6, freq: 600, decay: 0.8 }); sTone({ vol: 1, f0: 90, f1: 25, decay: 0.35 }); },
  heavy() { sNoise({ vol: 0.95, freq: 3500, decay: 0.18 }); sTone({ vol: 0.8, f0: 130, f1: 40, decay: 0.12 }); },
}[kind] || (() => {}))();
SFX.buy = () => { sTone({ vol: 0.2, f0: 600, f1: 600, decay: 0.05, type: 'square' }); sTone({ vol: 0.2, f0: 900, f1: 900, decay: 0.07, type: 'square', delay: 0.06 }); };
SFX.deny = () => sTone({ vol: 0.2, f0: 220, f1: 180, decay: 0.15, type: 'square' });
SFX.zoom = () => sTone({ vol: 0.15, f0: 1400, f1: 1000, decay: 0.04, type: 'square' });
SFX.bolt = () => { sTone({ vol: 0.2, f0: 600, f1: 400, decay: 0.05, type: 'square', delay: 0.35 }); sTone({ vol: 0.2, f0: 800, f1: 1100, decay: 0.06, type: 'square', delay: 0.7 }); };
function radio(text) {
  if (!settings.radio || !('speechSynthesis' in window)) return;
  try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.15; u.pitch = 0.7; u.volume = Math.min(1, settings.volume * 1.6); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
}

/* ============================================================
   WEAPONS  (CS 1.6 in-game names, approximate stats)
   ============================================================ */
const WEAPONS = {
  knife: { name: 'Knife', short: 'knife', slot: 3, melee: true, dmg: 40, stab: 65, rate: 0.42, speed: 250, model: { type: 'knife' } },
  glock: { name: '9x19mm Sidearm', short: 'glock18', cat: 'pistol', slot: 2, price: 400, dmg: 25, rate: 0.15, mag: 20, res: 120, reload: 2.2, spread: 0.008, move: 0.035, air: 0.15, recoil: 1.2, speed: 250, falloff: 0.75, ammoCost: 20, snd: 'pistol', model: { type: 'pistol', c: 'b', len: 0.19 } },
  usp: { name: 'K&M .45 Tactical', short: 'usp', cat: 'pistol', slot: 2, price: 500, dmg: 34, rate: 0.15, mag: 12, res: 100, reload: 2.7, spread: 0.007, move: 0.035, air: 0.15, recoil: 1.6, speed: 250, falloff: 0.79, ammoCost: 25, snd: 'pistol', model: { type: 'pistol', c: 'b', len: 0.21 } },
  p228: { name: '228 Compact', short: 'p228', cat: 'pistol', slot: 2, price: 600, dmg: 32, rate: 0.15, mag: 13, res: 52, reload: 2.7, spread: 0.007, move: 0.035, air: 0.15, recoil: 1.5, speed: 250, falloff: 0.8, ammoCost: 50, snd: 'pistol', model: { type: 'pistol', c: 'm', len: 0.19 } },
  deagle: { name: 'Night Hawk .50C', short: 'deagle', cat: 'pistol', slot: 2, price: 650, dmg: 54, rate: 0.225, mag: 7, res: 35, reload: 2.2, spread: 0.006, move: 0.045, air: 0.18, recoil: 2.4, speed: 250, falloff: 0.81, ammoCost: 40, snd: 'deagle', model: { type: 'pistol', c: 's', g: 'b', len: 0.25 } },
  fiveseven: { name: 'ES Five-Seven', short: 'fiveseven', cat: 'pistol', slot: 2, price: 750, dmg: 25, rate: 0.15, mag: 20, res: 100, reload: 2.7, spread: 0.007, move: 0.035, air: 0.15, recoil: 1.2, speed: 250, falloff: 0.885, ammoCost: 50, snd: 'pistol', model: { type: 'pistol', c: 'g', g: 'b', len: 0.21 } },
  m3: { name: 'Leone 12 Gauge Super', short: 'm3', cat: 'shotgun', slot: 1, price: 1700, dmg: 20, pellets: 9, rate: 0.88, mag: 8, res: 32, reload: 3.4, spread: 0.065, move: 0.01, air: 0.08, recoil: 4.5, speed: 230, falloff: 0.7, ammoCost: 65, snd: 'shotgun', model: { type: 'long', rl: 0.22, bl: 0.42, stock: 0.24, f: 'b', tube: true, pump: true } },
  xm1014: { name: 'Leone YG1265 Auto Shotgun', short: 'xm1014', cat: 'shotgun', slot: 1, price: 3000, dmg: 20, pellets: 6, rate: 0.25, mag: 7, res: 32, reload: 3.4, spread: 0.07, move: 0.01, air: 0.08, recoil: 3.2, speed: 240, falloff: 0.7, ammoCost: 65, snd: 'shotgun', model: { type: 'long', rl: 0.26, bl: 0.38, stock: 0.22, f: 'b', tube: true } },
  tmp: { name: 'Schmidt Machine Pistol', short: 'tmp', cat: 'smg', slot: 1, price: 1250, dmg: 20, auto: true, rate: 0.07, mag: 30, res: 120, reload: 2.1, spread: 0.01, move: 0.03, air: 0.12, recoil: 0.45, speed: 250, falloff: 0.85, ammoCost: 20, snd: 'smg', model: { type: 'long', rl: 0.2, bl: 0.14, mag: 'straight', f: 'b', fgrip: true } },
  mp5: { name: 'K&M Sub-Machine Gun', short: 'mp5navy', cat: 'smg', slot: 1, price: 1500, dmg: 26, auto: true, rate: 0.075, mag: 30, res: 120, reload: 2.6, spread: 0.009, move: 0.03, air: 0.12, recoil: 0.5, speed: 250, falloff: 0.84, ammoCost: 20, snd: 'smg', model: { type: 'long', rl: 0.26, bl: 0.12, hg: 0.12, stock: 0.16, mag: 'curved', f: 'b' } },
  ump45: { name: 'K&M UMP45', short: 'ump45', cat: 'smg', slot: 1, price: 1700, dmg: 30, auto: true, rate: 0.105, mag: 25, res: 100, reload: 3.5, spread: 0.009, move: 0.03, air: 0.12, recoil: 0.6, speed: 250, falloff: 0.82, ammoCost: 25, snd: 'smg', model: { type: 'long', rl: 0.3, bl: 0.1, hg: 0.12, stock: 0.18, mag: 'straight', f: 'b', rc: 'b' } },
  p90: { name: 'ES C90', short: 'p90', cat: 'smg', slot: 1, price: 2350, dmg: 21, auto: true, rate: 0.066, mag: 50, res: 100, reload: 3.4, spread: 0.01, move: 0.03, air: 0.12, recoil: 0.45, speed: 245, falloff: 0.885, ammoCost: 50, snd: 'smg', model: { type: 'long', rl: 0.42, bl: 0.08, mag: 'top', bull: true, rc: 'b', f: 'b', fat: true } },
  famas: { name: 'Clarion 5.56', short: 'famas', cat: 'rifle', slot: 1, price: 2250, dmg: 30, auto: true, rate: 0.09, mag: 25, res: 90, reload: 3.3, spread: 0.005, move: 0.045, air: 0.13, recoil: 0.7, speed: 240, falloff: 0.96, ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.5, bl: 0.12, mag: 'straight', bull: true, handle: 0.3, rc: 'b', f: 'b' } },
  scout: { name: 'Schmidt Scout', short: 'scout', cat: 'rifle', slot: 1, price: 2750, dmg: 75, rate: 1.25, mag: 10, res: 90, reload: 2.0, sniper: true, spread: 0.035, scoped: 0.0012, move: 0.07, air: 0.02, recoil: 2.5, speed: 260, falloff: 0.98, scope: [40, 15], bolt: true, ammoCost: 80, snd: 'sniper', model: { type: 'long', rl: 0.24, bl: 0.4, stock: 0.26, mag: 'small', f: 'b', scope: true } },
  m4a1: { name: 'Maverick M4A1 Carbine', short: 'm4a1', cat: 'rifle', slot: 1, price: 3100, dmg: 32, auto: true, rate: 0.09, mag: 30, res: 90, reload: 3.05, spread: 0.0042, move: 0.045, air: 0.13, recoil: 0.7, speed: 230, falloff: 0.97, ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.28, bl: 0.3, hg: 0.17, stock: 0.22, mag: 'straight', handle: 0.14, rc: 'b', f: 'b' } },
  aug: { name: 'Bullpup', short: 'aug', cat: 'rifle', slot: 1, price: 3500, dmg: 32, auto: true, rate: 0.09, mag: 30, res: 90, reload: 3.3, spread: 0.0042, scoped: 0.0032, move: 0.045, air: 0.13, recoil: 0.65, speed: 240, falloff: 0.96, scope: [55], ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.48, bl: 0.18, mag: 'straight', bull: true, rc: 'o', f: 'o', smallScope: true } },
  sg550: { name: 'Krieg 550 Commando', short: 'sg550', cat: 'rifle', slot: 1, price: 4200, dmg: 70, auto: true, rate: 0.25, mag: 30, res: 90, reload: 3.35, sniper: true, spread: 0.04, scoped: 0.003, move: 0.07, air: 0.15, recoil: 1.2, speed: 210, falloff: 0.98, scope: [40, 15], ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.3, bl: 0.38, hg: 0.14, stock: 0.26, mag: 'straight', f: 'g', rc: 'g', scope: true } },
  awp: { name: 'Magnum Sniper Rifle', short: 'awp', cat: 'rifle', slot: 1, price: 4750, dmg: 115, rate: 1.45, mag: 10, res: 30, reload: 2.5, sniper: true, spread: 0.05, scoped: 0.0007, move: 0.09, air: 0.2, recoil: 3, speed: 210, scopeSpeed: 150, falloff: 0.99, scope: [40, 10], bolt: true, ammoCost: 125, snd: 'sniper', model: { type: 'long', rl: 0.3, bl: 0.46, stock: 0.28, mag: 'small', f: 'o', rc: 'o', scope: true } },
  m249: { name: 'ES M249 Para', short: 'm249', cat: 'mg', slot: 1, price: 5750, dmg: 32, auto: true, rate: 0.1, mag: 100, res: 200, reload: 4.7, spread: 0.007, move: 0.06, air: 0.15, recoil: 0.85, speed: 220, falloff: 0.97, ammoCost: 60, snd: 'heavy', model: { type: 'long', rl: 0.34, bl: 0.34, hg: 0.14, stock: 0.22, mag: 'box', f: 'b', fat: true } },
  ak47: { name: 'CV-47', short: 'ak47', cat: 'rifle', slot: 1, price: 2500, team: 'T', dmg: 36, auto: true, rate: 0.1, mag: 30, res: 90, reload: 2.45, spread: 0.0045, move: 0.05, air: 0.13, recoil: 0.8, speed: 221, falloff: 0.98, ammoCost: 80, snd: 'rifle', model: { type: 'long', rl: 0.3, bl: 0.32, hg: 0.17, stock: 0.25, mag: 'curved', f: 'w' } },
  galil: { name: 'IDF Defender', short: 'galil', cat: 'rifle', slot: 1, price: 2000, team: 'T', dmg: 30, auto: true, rate: 0.09, mag: 35, res: 90, reload: 2.45, spread: 0.005, move: 0.05, air: 0.13, recoil: 0.7, speed: 240, falloff: 0.98, ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.3, bl: 0.28, hg: 0.15, stock: 0.22, mag: 'curved', f: 'b' } },
};
const BUY_MENU = [
  { name: 'Handgun', items: ['glock', 'usp', 'p228', 'deagle', 'fiveseven'] },
  { name: 'Shotgun', items: ['m3', 'xm1014'] },
  { name: 'Sub-Machine Gun', items: ['tmp', 'mp5', 'ump45', 'p90'] },
  { name: 'Rifle', items: ['famas', 'scout', 'm4a1', 'aug', 'sg550', 'awp'] },
  { name: 'Machine Gun', items: ['m249'] },
  { name: 'Primary Ammo', action: 'pammo' },
  { name: 'Secondary Ammo', action: 'sammo' },
  { name: 'Equipment', items: ['vest', 'vesthelm'] },
];
const EQUIP = { vest: { name: 'Kevlar Vest', price: 650 }, vesthelm: { name: 'Kevlar Vest & Helmet', price: 1000 } };
const ALIASES = { glock18: 'glock', mp5navy: 'mp5', kevlar: 'vest', assaultsuit: 'vesthelm', '9x19mm': 'glock', km45: 'usp', nighthawk: 'deagle', fn57: 'fiveseven', '12gauge': 'm3', autoshotgun: 'xm1014', mp: 'tmp', smg: 'mp5', c90: 'p90', clarion: 'famas', m4: 'm4a1', bullpup: 'aug', krieg550: 'sg550', magnum: 'awp', cv47: 'ak47', defender: 'galil', primammo: 'pammo', secammo: 'sammo', buyammo1: 'pammo', buyammo2: 'sammo' };

/* ---------- gun model specs (shared by 3D viewmodel and buy-menu picture) ---------- */
const PAL = { m: 0x2b2b2b, b: 0x171717, s: 0xa0a0a0, w: 0x7a4a22, g: 0x4a4a4a, o: 0x4d5a36 };
function gunParts(spec) {
  const P = [], add = (z, y, l, h, w, c, r = 0) => P.push({ z, y, l, h, w, c, r });
  if (spec.type === 'knife') {
    add(-0.14, 0, 0.22, 0.035, 0.008, 's'); add(0.02, -0.003, 0.11, 0.035, 0.03, 'm'); add(-0.035, 0, 0.012, 0.05, 0.05, 'm');
    return { parts: P, muzzle: [-0.25, 0] };
  }
  if (spec.type === 'pistol') {
    const L = spec.len;
    add(-0.04, 0, L, 0.045, 0.034, spec.c); add(-0.04 - L / 2 - 0.008, -0.004, 0.02, 0.022, 0.022, 'm');
    add(0.035, -0.072, 0.055, 0.12, 0.032, spec.g || 'b', -0.25); add(-0.02, -0.035, 0.07, 0.015, 0.012, 'm');
    return { parts: P, muzzle: [-0.04 - L / 2 - 0.02, -0.004] };
  }
  const rl = spec.rl, bl = spec.bl, f = spec.f || 'b', rc = spec.rc || 'm', fat = spec.fat ? 1.35 : 1;
  add(0, 0, rl, 0.07 * fat, 0.055 * fat, rc);
  add(-rl / 2 - bl / 2, 0.012, bl, 0.022, 0.022, 'm');
  if (spec.hg) add(-rl / 2 - spec.hg / 2 + 0.03, -0.004, spec.hg, 0.062, 0.064, f);
  if (spec.stock) add(rl / 2 + spec.stock / 2 - 0.01, -0.025, spec.stock, 0.085, 0.05, f, 0.1);
  const gripZ = spec.bull ? -rl * 0.12 : 0.07;
  add(gripZ, -0.085, 0.05, 0.1, 0.04, 'b', -0.35);
  const magZ = spec.bull ? rl * 0.22 : -0.06;
  if (spec.mag === 'curved') add(magZ, -0.11, 0.07, 0.17, 0.04, 'm', 0.3);
  else if (spec.mag === 'straight') add(magZ, -0.1, 0.06, 0.15, 0.036, 'm', 0.1);
  else if (spec.mag === 'box') add(magZ, -0.09, 0.13, 0.12, 0.09, 'g');
  else if (spec.mag === 'small') add(magZ + 0.02, -0.055, 0.07, 0.05, 0.04, 'm');
  else if (spec.mag === 'top') add(-0.02, 0.05, rl * 0.7, 0.03, 0.05, 'g');
  if (spec.handle) add(-0.02, 0.055 * fat, spec.handle, 0.035, 0.02, rc);
  if (spec.scope) { add(-0.03, 0.085, 0.3, 0.05, 0.05, 'b'); add(-0.175, 0.085, 0.035, 0.07, 0.07, 'b'); add(0.115, 0.085, 0.03, 0.065, 0.065, 'b'); add(-0.07, 0.05, 0.02, 0.03, 0.02, 'm'); add(0.05, 0.05, 0.02, 0.03, 0.02, 'm'); }
  if (spec.smallScope) add(-0.05, 0.07, 0.16, 0.04, 0.04, 'b');
  if (spec.tube) add(-rl / 2 - bl / 2 + 0.02, -0.024, bl * 0.85, 0.028, 0.028, 'm');
  if (spec.pump) add(-rl / 2 - 0.13, -0.024, 0.13, 0.045, 0.05, f);
  if (spec.fgrip) add(-rl / 2 + 0.02, -0.07, 0.035, 0.08, 0.03, 'b', 0.15);
  return { parts: P, muzzle: [-rl / 2 - bl - 0.01, 0.012], gripZ, bull: spec.bull };
}
function drawGunPic(cv, id) {
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  const w = WEAPONS[id]; if (!w) { // equipment
    g.fillStyle = 'rgba(255,190,80,.85)'; g.beginPath(); const cx = cv.width / 2, cy = cv.height / 2;
    g.moveTo(cx, cy - 45); g.lineTo(cx + 40, cy - 30); g.lineTo(cx + 34, cy + 20); g.lineTo(cx, cy + 48); g.lineTo(cx - 34, cy + 20); g.lineTo(cx - 40, cy - 30); g.closePath(); g.fill();
    if (id === 'vesthelm') { g.beginPath(); g.arc(cx + 70, cy - 10, 26, Math.PI, 0); g.fill(); g.fillRect(cx + 40, cy - 12, 60, 8); }
    return;
  }
  const { parts } = gunParts(w.model);
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of parts) { z0 = Math.min(z0, p.z - p.l / 2); z1 = Math.max(z1, p.z + p.l / 2); y0 = Math.min(y0, p.y - p.h / 2 - 0.05); y1 = Math.max(y1, p.y + p.h / 2); }
  const s = Math.min((cv.width - 30) / (z1 - z0), (cv.height - 20) / (y1 - y0));
  const cx = cv.width / 2 - (z0 + z1) / 2 * s, cy = cv.height / 2 + (y0 + y1) / 2 * s;
  for (const p of parts) {
    g.save(); g.translate(cx + p.z * s, cy - p.y * s); g.rotate(p.r);
    const c = new THREE.Color(PAL[p.c]).lerp(new THREE.Color(0xffc060), 0.55);
    g.fillStyle = '#' + c.getHexString(); g.strokeStyle = 'rgba(0,0,0,.5)';
    g.fillRect(-p.l * s / 2, -p.h * s / 2, p.l * s, p.h * s); g.strokeRect(-p.l * s / 2, -p.h * s / 2, p.l * s, p.h * s);
    g.restore();
  }
}

/* ============================================================
   VIEWMODEL (separate scene drawn on top)
   ============================================================ */
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xfff2dd, 0x6b5434, 1.6));
const vmSun = new THREE.DirectionalLight(0xffe2b0, 1.8); vmSun.position.set(-1, 2, 1); vmScene.add(vmSun);
const matCache = {};
const L = c => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c }));
function box(group, color, w, h, d, x, y, z, rx = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), L(color)); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); group.add(m); return m;
}
const SLEEVE = 0x2c3346, GLOVE = 0x1a1a1a;
const VM = {};
function getVM(id) {
  if (VM[id]) return VM[id];
  const w = WEAPONS[id], g = new THREE.Group();
  const { parts, muzzle, gripZ, bull } = gunParts(w.model);
  for (const p of parts) box(g, PAL[p.c], p.w, p.h, p.l, 0, p.y, p.z, p.r);
  const type = w.model.type;
  // arms
  if (type === 'knife') { box(g, SLEEVE, 0.08, 0.08, 0.3, 0.04, -0.06, 0.2, 0.2); box(g, GLOVE, 0.07, 0.07, 0.08, 0, -0.01, 0.03); }
  else if (type === 'pistol') {
    box(g, SLEEVE, 0.08, 0.08, 0.3, 0.05, -0.15, 0.24, 0.35); box(g, GLOVE, 0.065, 0.075, 0.075, 0.012, -0.085, 0.04);
    box(g, SLEEVE, 0.08, 0.08, 0.3, -0.09, -0.17, 0.2, 0.35, -0.35); box(g, GLOVE, 0.06, 0.07, 0.07, -0.03, -0.095, 0.04);
  } else {
    box(g, SLEEVE, 0.08, 0.08, 0.32, 0.05, -0.13, gripZ + 0.17, 0.25); box(g, GLOVE, 0.07, 0.07, 0.08, 0.01, -0.075, gripZ + 0.02);
    const fz = bull ? -w.model.rl / 2 + 0.02 : -w.model.rl / 2 - 0.05;
    box(g, SLEEVE, 0.08, 0.08, 0.3, -0.12, -0.13, fz + 0.18, 0.2, -0.6); box(g, GLOVE, 0.07, 0.06, 0.08, -0.025, -0.05, fz);
  }
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.set(0, muzzle[1], muzzle[0]); flash.visible = false; g.add(flash);
  g.scale.setScalar(0.72); g.visible = false; vmScene.add(g);
  const base = type === 'pistol' ? [0.13, -0.12, -0.3] : type === 'knife' ? [0.15, -0.13, -0.28] : [0.15, -0.155, -0.36 + (bull ? -0.04 : 0)];
  return (VM[id] = { g, flash, base });
}

/* ============================================================
   PLAYER
   ============================================================ */
const player = {
  pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: Math.PI, pitch: 0, onGround: false, duck: false, eyeOff: EYE_STAND, hp: 100, armor: 0, helmet: false, alive: true,
  money: 800, primary: null, secondary: 'usp', weapon: 'usp', lastWeapon: 'knife', ammo: {},
  jumpAt: -1, nextFire: 0, reloading: 0, drawT: 0, shots: 0, punch: 0, punchYaw: 0, zoom: 0, rezoomAt: -1, rezoomLevel: 0,
  stepT: 0, deathT: 0, kills: 0, deaths: 0, lossStreak: 0,
};
const keys = {};
let mouseL = false, mouseR = false, triggerUp = true, rTriggerUp = true, simTime = 0, running = false, started = false;

const hspeed = () => Math.hypot(player.vel.x, player.vel.z);
const curW = () => WEAPONS[player.weapon];
function moveSpeed() {
  const w = curW();
  if (player.zoom && w.scopeSpeed) return w.scopeSpeed;
  return w.speed;
}

function physicsTick(dt) {
  const p = player, P = p.pos;
  simTime += dt;
  p.prev.copy(P);
  if (!p.alive) return;
  const frozen = game.freeze > 0, input = !uiBlocksInput();

  const fm = input ? (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) : 0, sm = input ? (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) : 0;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);

  if (cheats.noclip) {
    const d = viewDir(p.yaw, p.pitch), sp = (keys.ShiftLeft ? 1200 : 500) * dt;
    P.x += (d.x * fm + cy * sm) * sp; P.y += (d.y * fm + ((keys.Space ? 1 : 0) - (keys.ControlLeft ? 1 : 0))) * sp; P.z += (d.z * fm - sy * sm) * sp;
    p.vel.set(0, 0, 0); p.onGround = false; return;
  }

  // ---- duck (ducking in the air pulls the legs up, like GoldSrc) ----
  const wantDuck = input && (keys.ControlLeft || keys.ControlRight || keys.KeyC);
  if (wantDuck && !p.duck) {
    if (!p.onGround) { P.y += STAND_H - DUCK_H; p.prev.y += STAND_H - DUCK_H; p.eyeOff -= STAND_H - DUCK_H; }
    p.duck = true;
  } else if (!wantDuck && p.duck) {
    if (p.onGround) { if (!overlapAt(P.x, P.y, P.z, STAND_H)) p.duck = false; }
    else if (!overlapAt(P.x, P.y - 36, P.z, STAND_H)) { P.y -= 36; p.prev.y -= 36; p.eyeOff += 36; p.duck = false; }
    else if (!overlapAt(P.x, P.y, P.z, STAND_H)) p.duck = false;
  }
  const H = p.duck ? DUCK_H : STAND_H;

  let wx = -sy * fm + cy * sm, wz = -cy * fm - sy * sm;
  const wl = Math.hypot(wx, wz);
  let wishspeed = 0;
  if (wl > 0 && !frozen) {
    wx /= wl; wz /= wl;
    wishspeed = moveSpeed();
    if (p.duck && p.onGround) wishspeed *= 0.333; else if (keys.ShiftLeft || keys.ShiftRight) wishspeed *= 0.52;
  }

  // ---- jump: friction is skipped on the tick you jump => bhop ----
  let jumped = false;
  const wantJump = input && !frozen && ((settings.autoBhop && keys.Space) || (simTime - p.jumpAt < 0.06));
  if (p.onGround && wantJump) { p.vel.y = jumpV(); p.onGround = false; jumped = true; p.jumpAt = -1; }

  if (p.onGround) {
    const sp = hspeed();
    if (sp > 0.1) {
      const control = sp < phys.stopspeed ? phys.stopspeed : sp;
      const ns = Math.max(0, sp - control * phys.friction * dt) / sp;
      p.vel.x *= ns; p.vel.z *= ns;
    } else { p.vel.x = p.vel.z = 0; }
    const cur = p.vel.x * wx + p.vel.z * wz, add = wishspeed - cur;
    if (add > 0) { const as = Math.min(add, phys.accelerate * dt * wishspeed); p.vel.x += as * wx; p.vel.z += as * wz; }
  } else {
    // air acceleration: wishspeed capped at 30 for the projection, but the accel uses the full wishspeed
    const cur = p.vel.x * wx + p.vel.z * wz, add = Math.min(wishspeed, 30) - cur;
    if (add > 0) { const as = Math.min(add, settings.airAccel * wishspeed * dt); p.vel.x += as * wx; p.vel.z += as * wz; }
    p.vel.y -= phys.gravity * dt * 0.5;
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

  if (p.vel.y !== 0 && collideAxis(P, 1, p.vel.y * dt, H)) p.vel.y = 0;
  if (!p.onGround) p.vel.y -= phys.gravity * dt * 0.5;

  const probe = d => { const q = { x: P.x, y: P.y, z: P.z }; return collideAxis(q, 1, -d, H) ? q.y : null; };
  let g = null;
  if (p.vel.y <= 0) {
    g = probe(1);
    if (g === null && wasGround && !jumped) g = probe(STEP + 1);
  }
  if (g !== null) {
    if (!wasGround && fallSpeed > 300) SFX.land(fallSpeed);
    if (!wasGround && fallSpeed > 580) damagePlayer((fallSpeed - 580) * 0.25, null, false, 'world');
    P.y = g; p.onGround = true; p.vel.y = 0;
  } else p.onGround = false;
  if (P.y < -2000) damagePlayer(999, null, false, 'world');

  if (p.onGround && hspeed() > 150 && !(keys.ShiftLeft || p.duck)) { p.stepT -= dt; if (p.stepT <= 0) { SFX.step(); p.stepT = 0.33; } }
}

/* ============================================================
   SHOOTING
   ============================================================ */
function currentSpread() {
  const w = curW(); if (w.melee) return 0;
  const p = player;
  let s = w.sniper ? (p.zoom ? w.scoped : w.spread) : (p.zoom && w.scoped ? w.scoped : w.spread);
  if (!p.onGround) s += w.air;
  else s += w.move * clamp((hspeed() - 60) / 190, 0, 1) * (w.sniper && p.zoom ? 1.5 : 1);
  if (p.duck && p.onGround) s *= 0.75;
  if (w.auto) s += Math.min(p.shots, 12) * 0.0028 * (w.cat === 'smg' ? 1.3 : 1);
  return s;
}
function viewDir(yaw, pitch) { return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); }
function eyePos() { return new THREE.Vector3(player.pos.x, player.pos.y + player.eyeOff, player.pos.z); }

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
  const p = player, w = curW();
  if (p.drawT > 0 || p.reloading > 0 || !p.alive || game.freeze > 0) return;
  const o = eyePos();
  if (w.melee) {
    const d = viewDir(p.yaw, p.pitch), h = traceShot(o, d, 64);
    p.nextFire = simTime + (alt ? 1.0 : w.rate);
    SFX.knife(); vmKick = alt ? 0.12 : 0.07; vmKnifeSwing = 1;
    if (h.bot) { damageBot(h.bot, alt ? w.stab : w.dmg, false, 'knife'); addPuff(o.clone().addScaledVector(d, h.t), 0xaa1010, 12); }
    else if (h.world) { SFX.ricochet(); addPuff(o.clone().addScaledVector(d, h.t), 0xc8b090, 8); }
    return;
  }
  const am = p.ammo[p.weapon];
  if (am.mag <= 0) { SFX.click(); p.nextFire = simTime + 0.25; if (am.res > 0) startReload(); return; }
  am.mag--; p.shots++;
  p.nextFire = simTime + w.rate;

  const sp = currentSpread();
  const yaw = p.yaw + p.punchYaw, pitch = p.pitch + p.punch;
  const fwd = viewDir(yaw, pitch);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), up = new THREE.Vector3().crossVectors(right, fwd);
  const muzzleWorld = o.clone().addScaledVector(viewDir(p.yaw, p.pitch), 30).addScaledVector(right, 6).add(new THREE.Vector3(0, -6, 0));
  const hitBots = new Map();
  for (let i = 0; i < (w.pellets || 1); i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * sp;
    const d = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    const h = traceShot(o, d, 8192);
    const hit = o.clone().addScaledVector(d, h.t);
    if (h.bot) {
      const dmg = w.dmg * (h.head ? 4 : 1) * Math.pow(w.falloff, h.t / 500);
      const e = hitBots.get(h.bot) || { dmg: 0, head: false }; e.dmg += dmg; e.head ||= h.head; hitBots.set(h.bot, e);
      if (i < 3) addPuff(hit, 0x9a0c0c, h.head ? 22 : 14, 0.4, 5);
    } else if (h.world) {
      const n = new THREE.Vector3(h.world.nx, h.world.ny, h.world.nz);
      addHole(hit, n); if (i < 3) addPuff(hit.clone().addScaledVector(n, 2), 0xd8c49a, 16, 0.5, 25);
    }
    if (i === 0 && rand() < 0.5) addTracer(muzzleWorld, hit);
  }
  for (const [b, e] of hitBots) damageBot(b, e.dmg, e.head, w.short);

  const kick = w.recoil * (1 + Math.min(p.shots, 8) * (w.auto ? 0.12 : 0)) * (p.onGround ? 1 : 1.6);
  p.punch = Math.min(p.punch + THREE.MathUtils.degToRad(kick), THREE.MathUtils.degToRad(12));
  if (p.shots > 3 || !w.auto) p.punchYaw += THREE.MathUtils.degToRad((rand() - 0.5) * kick * 1.2);

  SFX.shot(w.snd);
  vmKick = w.auto ? 0.035 : 0.07; vmFlashT = 0.04;
  muzzleLight.position.copy(muzzleWorld); muzzleLight.intensity = 3; muzzleT = 0.04;
  if (w.bolt) { SFX.bolt(); if (p.zoom) { p.rezoomLevel = p.zoom; p.zoom = 0; p.rezoomAt = simTime + w.rate * 0.9; } }

  for (const b of bots) if (b.alive && b.active && b.pos.distanceTo(p.pos) < 2200 && !b.sees) { b.alertT = 3; b.hunt(p.pos); }
}
function toggleZoom() {
  const w = curW(); if (!w.scope || player.reloading > 0) return;
  player.zoom = (player.zoom + 1) % (w.scope.length + 1); player.rezoomAt = -1; SFX.zoom();
}
function startReload() {
  const p = player, w = curW(); if (w.melee) return;
  const am = p.ammo[p.weapon]; if (p.reloading > 0 || am.mag >= w.mag || am.res <= 0) return;
  p.reloading = w.reload; p.zoom = 0; p.rezoomAt = -1; SFX.reload();
}
function switchWeapon(id) {
  const p = player; if (!id || id === p.weapon || !p.alive) return;
  p.lastWeapon = p.weapon; p.weapon = id; p.reloading = 0; p.drawT = 0.45; p.shots = 0; p.zoom = 0; p.rezoomAt = -1;
  for (const k in VM) VM[k].g.visible = false;
  getVM(id).g.visible = true;
  updateHUD(true);
}
function giveWeapon(id, select = true) {
  const w = WEAPONS[id]; if (!w) return false;
  const p = player;
  if (w.slot === 1) { if (p.primary) delete p.ammo[p.primary]; p.primary = id; }
  else if (w.slot === 2) { if (p.secondary) delete p.ammo[p.secondary]; p.secondary = id; }
  if (!w.melee) p.ammo[id] = { mag: w.mag, res: w.slot === 2 && id === 'usp' ? 24 : w.slot === 2 && id === 'glock' ? 40 : w.res };
  if (select) { p.weapon = null; switchWeapon(id); }
  return true;
}

/* ============================================================
   BOTS
   ============================================================ */
const BOT_NAMES = ['Gravel', 'Mirage', 'Scorpion', 'Dune', 'Viper', 'Sandman', 'Jackal', 'Cobra', 'Nomad', 'Sirocco', 'Falcon', 'Rattler'];
const DIFF = { easy: { acc: 0.6, react: 1.6, dmg: 0.8 }, normal: { acc: 1, react: 1, dmg: 1 }, hard: { acc: 1.35, react: 0.6, dmg: 1.15 } };
const BOT_GUNS = ['ak47', 'ak47', 'ak47', 'ak47', 'galil', 'galil', 'mp5', 'deagle', 'glock', 'awp', 'm3'];
let botStop = false;
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
  const gun = add(new THREE.BoxGeometry(4, 7, 36), gunM, 4, 55, -26);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; scene.add(g);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(26); flash.position.set(4, 56, -46); flash.visible = false; g.add(flash);
  return { g, legL, legR, flash, gun };
}
class Bot {
  constructor(i) {
    this.name = BOT_NAMES[i % BOT_NAMES.length]; this.m = makeBotMesh();
    this.pos = new THREE.Vector3(); this.active = false; this.alive = false; this.kills = 0; this.deaths = 0; this.ping = 20 + ((rand() * 50) | 0);
  }
  spawn(r, c) {
    const p = cellCenter(r, c); p.x += (rand() - .5) * 40; p.z += (rand() - .5) * 40; p.y = floorHeight(p.x, p.z);
    Object.assign(this, { alive: true, active: true, hp: 100, yaw: 0, path: [], sees: false, los: false, spotT: 0, seeT: 0, react: 0, fireCd: 0, burst: 0, walkT: 0, deathT: 0, alertT: 0, lastKnown: null, flashT: 0, idleT: rand() * 1.5, strafe: 0 });
    this.gun = pick(BOT_GUNS);
    const W = WEAPONS[this.gun]; this.m.gun.scale.z = W.slot === 2 ? 0.45 : W.sniper ? 1.4 : 1;
    this.pos.copy(p);
    this.m.g.visible = true; this.m.g.rotation.set(0, 0, 0); this.m.g.position.copy(p);
    this.goTo(pick([GOALS.A, GOALS.B, GOALS.mid, GOALS.long, GOALS.B])[0]);
  }
  goTo([r, c]) { this.path = findPath(Math.floor(this.pos.z / CELL), Math.floor(this.pos.x / CELL), r, c); }
  hunt(v) { this.goTo([Math.floor(v.z / CELL), Math.floor(v.x / CELL)]); }
  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 68, this.pos.z); }
  lineOfSight() {
    if (!player.alive) return false;
    const e = this.eye(), pe = eyePos();
    if (e.distanceTo(pe) > 4000) return false;
    for (const ty of [pe.y, player.pos.y + (player.duck ? 20 : 40)]) {
      const d = new THREE.Vector3(pe.x - e.x, ty - e.y, pe.z - e.z); const len = d.length(); d.divideScalar(len);
      if (!rayWorld(e.x, e.y, e.z, d.x, d.y, d.z, len)) return true;
    }
    return false;
  }
  facesPlayer(deg) {
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    return (-Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz) / Math.hypot(dx, dz) > Math.cos(THREE.MathUtils.degToRad(deg));
  }
  update(dt) {
    const g = this.m.g;
    if (!this.alive) {
      this.deathT += dt; g.rotation.x = -Math.min(1, this.deathT * 3.5) * Math.PI / 2;
      g.position.y = this.pos.y + 6 * Math.min(1, this.deathT * 3.5); return;
    }
    const D = DIFF[settings.diff];
    this.alertT -= dt; this.seeT -= dt; this.flashT -= dt; this.spotT -= dt;
    this.m.flash.visible = this.flashT > 0;
    if (this.seeT <= 0) {
      this.seeT = 0.1;
      this.los = this.lineOfSight();
      // radar: player spots this bot if it is in front of the player
      if (this.los) { const f = viewDir(player.yaw, 0), dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z; if ((f.x * dx + f.z * dz) / Math.hypot(dx, dz) > 0.5) this.spotT = 1; }
      const s = this.los && (this.sees || this.alertT > 0 || this.facesPlayer(80)) && !botStop;
      if (s && !this.sees) this.react = (0.35 + rand() * 0.4) * D.react;
      this.sees = s;
      if (s) this.lastKnown = player.pos.clone();
    }
    let moving = false;
    if (botStop || game.freeze > 0) { /* frozen */ }
    else if (this.sees) {
      const pe = eyePos();
      this.turnTo(Math.atan2(-(pe.x - this.pos.x), -(pe.z - this.pos.z)), 14, dt);
      this.react -= dt;
      if (this.react <= 0) {
        this.fireCd -= dt;
        if (this.fireCd <= 0) {
          this.shoot(); this.burst++;
          const W = WEAPONS[this.gun];
          this.fireCd = W.auto ? (this.burst % (3 + ((rand() * 3) | 0)) === 0 ? 0.45 + rand() * 0.4 : W.rate * 1.2) : W.rate + 0.15 + rand() * 0.35;
        }
      }
      this.strafe -= dt;
      if (this.strafe < -0.6) this.strafe = 0.5 + rand() * 0.6;
      if (this.strafe > 0 && !WEAPONS[this.gun].sniper) {
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
    const D = DIFF[settings.diff], W = WEAPONS[this.gun];
    const e = this.eye(); e.y -= 12;
    const dist = e.distanceTo(player.pos);
    SFX.enemy(dist);
    this.flashT = 0.05;
    let chance = 0.42 * D.acc - dist / 6000 - hspeed() / 1100 - (player.onGround ? 0 : 0.12) - (player.duck ? 0.04 : 0);
    if (this.burst % 5 === 0) chance += 0.1;
    if (W.sniper) chance += 0.1;
    if (W.pellets) chance -= dist / 3000;
    chance = clamp(chance, 0.04, 0.75);
    const target = new THREE.Vector3(player.pos.x, player.pos.y + (player.duck ? 24 : 44), player.pos.z);
    if (rand() < chance) {
      const hs = rand() < 0.05 * D.acc;
      let dmg = W.dmg * (W.pellets ? Math.max(1, W.pellets * (1 - dist / 1200)) * 0.6 : 1) * (0.65 + rand() * 0.25) * D.dmg;
      if (hs) dmg *= 4;
      damagePlayer(dmg, this, hs, this.gun);
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

/* ============================================================
   DAMAGE + MONEY
   ============================================================ */
function addMoney(n, quiet) {
  const p = player, before = p.money;
  p.money = clamp(Math.round(p.money + n), 0, 16000);
  const d = p.money - before; if (!d || quiet) { updateHUD(true); return; }
  hud.mDelta.textContent = (d > 0 ? '+' : '−') + Math.abs(d);
  hud.mDelta.className = 'show ' + (d > 0 ? 'plus' : 'minus');
  clearTimeout(addMoney.t); addMoney.t = setTimeout(() => hud.mDelta.className = '', 1600);
  updateHUD(true);
}
function damageBot(b, dmg, head, weapon) {
  if (!b.alive) return;
  b.hp -= dmg;
  b.alertT = 3; b.lastKnown = player.pos.clone(); b.spotT = 1;
  if (!b.sees) b.turnTo(Math.atan2(-(player.pos.x - b.pos.x), -(player.pos.z - b.pos.z)), 100, 1);
  if (head) SFX.headshot(); else SFX.hit();
  if (b.hp <= 0) {
    b.alive = false; b.deathT = 0; b.m.flash.visible = false; b.deaths++;
    player.kills++;
    addMoney(300);
    killFeed(settings.name, 'ct', weapon, b.name, 'tt', head, true);
  }
}
function damagePlayer(dmg, from, hs, weapon) {
  const p = player; if (!p.alive || game.phase !== 'live' || cheats.god) return;
  let hpDmg = dmg;
  if (p.armor > 0 && (!hs || p.helmet) && from) {
    hpDmg = dmg * 0.5; let armorDmg = dmg * 0.25;
    if (armorDmg > p.armor) { hpDmg += (armorDmg - p.armor) * 2; armorDmg = p.armor; }
    p.armor = Math.max(0, Math.round(p.armor - armorDmg)); if (!p.armor) p.helmet = false;
  }
  p.hp = Math.max(0, Math.round(p.hp - hpDmg));
  dmgFlash = Math.min(1, dmgFlash + 0.5); SFX.hurt();
  p.punch += THREE.MathUtils.degToRad(1.5);
  if (p.hp <= 0) {
    p.alive = false; p.deaths++; p.deathT = 0; p.zoom = 0;
    for (const k in VM) VM[k].g.visible = false;
    if (from) { from.kills++; killFeed(from.name, 'tt', WEAPONS[weapon]?.short || weapon, settings.name, 'ct', hs, true); }
    else killFeed(settings.name, 'ct', weapon, '', '', false, true);
  }
  updateHUD(true);
}

/* ============================================================
   ROUNDS
   ============================================================ */
const game = { ct: 0, t: 0, phase: 'live', time: 115, freeze: 0, endT: 0, roundStart: 0, restartAt: -1 };
function defaultLoadout() {
  const p = player;
  p.primary = null; p.secondary = null; p.ammo = {}; p.armor = 0; p.helmet = false;
  giveWeapon('usp', false); p.weapon = 'usp';
}
function startRound() {
  const p = player;
  if (!p.alive || !p.secondary) defaultLoadout();
  const [r, c] = pick(CT_SPAWNS); const s = cellCenter(r, c);
  p.pos.set(s.x + (rand() - .5) * 30, cellInfo[r][c].h + EPS, s.z + (rand() - .5) * 30); p.prev.copy(p.pos);
  p.vel.set(0, 0, 0); p.yaw = Math.PI; p.pitch = 0; p.hp = 100; p.alive = true; p.duck = false; p.eyeOff = EYE_STAND; p.onGround = false;
  p.punch = p.punchYaw = 0; p.reloading = 0; p.shots = 0; p.drawT = 0.3; p.zoom = 0; p.rezoomAt = -1;
  for (const k in VM) VM[k].g.visible = false;
  if (!WEAPONS[p.weapon] || (p.weapon !== 'knife' && !p.ammo[p.weapon])) p.weapon = p.primary || p.secondary;
  getVM(p.weapon).g.visible = true;
  const spawns = [...T_SPAWNS].sort(() => rand() - .5);
  bots.forEach((b, i) => {
    if (i < settings.bots) b.spawn(...spawns[i % spawns.length]);
    else { b.active = false; b.alive = false; b.m.g.visible = false; }
  });
  for (const h of holes) h.visible = false;
  game.phase = 'live'; game.time = rules.roundtime * 60; game.freeze = rules.freezetime; game.roundStart = simTime;
  showCenter('', '');
  if (game.freeze <= 0) radio('Go go go!');
  updateHUD(true);
}
function newGame() {
  game.ct = game.t = 0; player.kills = player.deaths = 0; player.lossStreak = 0; player.money = rules.startmoney;
  for (const b of bots) b.kills = b.deaths = 0;
  player.alive = false; startRound();
  feed('Game started. Press B in the buy zone to buy weapons.');
}
function endRound(winner) {
  if (game.phase !== 'live') return;
  game.phase = 'end'; game.endT = 5;
  if (winner === 'ct') { game.ct++; player.lossStreak = 0; addMoney(3250); }
  else { game.t++; addMoney(1400 + 500 * Math.min(player.lossStreak, 4)); player.lossStreak++; }
  const title = winner === 'ct' ? 'Counter-Terrorists Win!' : 'Terrorists Win!';
  showCenter(title, '');
  radio(winner === 'ct' ? 'Counter-terrorists win.' : 'Terrorists win.');
  updateHUD(true);
}
function updateRound(dt) {
  if (game.restartAt > 0 && simTime >= game.restartAt) { game.restartAt = -1; newGame(); return; }
  if (game.freeze > 0) {
    game.freeze -= dt;
    if (game.freeze <= 0) radio('Go go go!');
    return;
  }
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
function inBuyZone() {
  const r = Math.floor(player.pos.z / CELL), c = Math.floor(player.pos.x / CELL);
  return r >= 1 && r <= 6 && c >= 11 && c <= 19;
}
const buyTimeLeft = () => rules.buytime * 60 + rules.freezetime - (simTime - game.roundStart);
function canBuy(silent) {
  const msg = !player.alive ? 'You can\'t buy while dead.' : !inBuyZone() ? 'You are not in a buy zone.' : buyTimeLeft() <= 0 ? `${Math.round(rules.buytime * 60)} seconds have passed.\nYou can't buy anything now.` : null;
  if (msg && !silent) { cprint(msg); SFX.deny(); }
  return !msg;
}
function buy(id) {
  id = ALIASES[id] || id;
  const p = player;
  if (!canBuy()) return false;
  const deny = m => { cprint(m); SFX.deny(); return false; };
  if (id === 'pammo' || id === 'sammo') {
    const wid = id === 'pammo' ? p.primary : p.secondary; if (!wid) return deny('You have no weapon for that ammo.');
    const w = WEAPONS[wid], am = p.ammo[wid];
    if (am.res >= w.res) return deny('You can\'t carry any more ammo.');
    if (p.money < w.ammoCost) return deny('You have insufficient funds!');
    am.res = Math.min(w.res, am.res + w.mag); addMoney(-w.ammoCost); SFX.reload(); return true;
  }
  if (EQUIP[id]) {
    const e = EQUIP[id];
    if (p.armor >= 100 && (id === 'vest' || p.helmet)) return deny('You already have kevlar!');
    let price = e.price; if (id === 'vesthelm' && p.armor >= 100) price = 350;
    if (p.money < price) return deny('You have insufficient funds!');
    p.armor = 100; if (id === 'vesthelm') p.helmet = true; addMoney(-price); SFX.buy(); return true;
  }
  const w = WEAPONS[id];
  if (!w || w.melee) return deny(`Unknown item "${id}".`);
  if (w.team === 'T' && !cheats.enabled) return deny('This item is not available to your team.');
  if (p.primary === id || p.secondary === id) return deny('You already have one!');
  if (p.money < w.price) return deny('You have insufficient funds!');
  addMoney(-w.price); giveWeapon(id); SFX.buy(); return true;
}

/* ============================================================
   HUD
   ============================================================ */
const $ = id => document.getElementById(id);
const hud = {
  hp: $('hpVal'), hpBox: $('hp'), ap: $('apVal'), speed: $('speedVal'), speedBox: $('speed'), mag: $('magVal'), res: $('resVal'), ammoBox: $('ammo'), wname: $('wname'),
  timer: $('timerVal'), timerBox: $('timer'), ct: $('ctScore'), t: $('tScore'), feed: $('feed'), center: $('center'), cprint: $('cprint'), dmg: $('dmg'),
  money: $('moneyVal'), moneyBox: $('money'), mDelta: $('moneyDelta'), buyicon: $('buyicon'), scope: $('scope'), cross: $('crosshair'), crossI: document.querySelectorAll('#crosshair i'), fps: $('fps'),
  radar: $('radar').getContext('2d'), score: $('scoreboard'),
};
let dmgFlash = 0, crossGap = 6;
function showCenter(title, sub) { hud.center.innerHTML = title ? `${title}${sub ? `<br><small>${sub}</small>` : ''}` : ''; hud.center.classList.toggle('show', !!title); }
function cprint(msg) {
  hud.cprint.innerHTML = msg.replace(/\n/g, '<br>'); hud.cprint.classList.add('show');
  clearTimeout(cprint.t); cprint.t = setTimeout(() => hud.cprint.classList.remove('show'), 2200);
}
function feed(text) { conPrint(text, 'dim'); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function killFeed(a, ac, weapon, v, vc, hs, me) {
  const d = document.createElement('div'); if (me) d.className = 'me';
  d.innerHTML = `<span class="${ac}">${esc(a)}</span><span class="w">${esc(weapon)}</span>${hs ? '<span class="hs">⌖</span>' : ''}<span class="${vc}" style="margin-left:6px">${esc(v)}</span>`;
  hud.feed.appendChild(d); setTimeout(() => d.remove(), 6000);
  while (hud.feed.children.length > 5) hud.feed.firstChild.remove();
  conPrint(`${a} killed ${v || 'self'} with ${weapon}${hs ? ' (headshot)' : ''}`, 'dim');
}
let lastHudTxt = '';
function updateHUD(force) {
  const p = player, w = curW();
  const t = Math.max(0, Math.ceil(game.freeze > 0 ? game.freeze : game.time));
  const sp = Math.round(hspeed());
  const am = w.melee ? null : p.ammo[p.weapon];
  const txt = [p.hp, p.armor, sp, am?.mag, am?.res, t, game.ct, game.t, p.weapon, p.money].join();
  if (txt === lastHudTxt && !force) return; lastHudTxt = txt;
  hud.hp.textContent = p.hp; hud.hpBox.classList.toggle('low', p.hp <= 25);
  hud.ap.textContent = p.armor;
  hud.speed.textContent = sp; hud.speedBox.className = sp > 450 ? 'vfast' : sp > 280 ? 'fast' : '';
  hud.ammoBox.classList.toggle('hidden', !am);
  if (am) { hud.mag.textContent = am.mag; hud.res.textContent = am.res; hud.ammoBox.classList.toggle('low', am.mag <= Math.ceil(w.mag * 0.2)); }
  hud.wname.textContent = w.name;
  hud.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  hud.timerBox.classList.toggle('low', game.freeze <= 0 && t <= 15);
  hud.ct.textContent = game.ct; hud.t.textContent = game.t;
  hud.money.textContent = p.money;
}
function updateCrosshair(dt) {
  const w = curW(), p = player;
  const scoped = p.zoom > 0 && w.scope;
  hud.scope.classList.toggle('hidden', !(scoped && w.sniper));
  hud.cross.classList.toggle('hidden', !p.alive || (w.sniper && !p.zoom) || (scoped && w.sniper));
  const target = 5 + currentSpread() * 700 + (p.shots > 0 && simTime - p.nextFire < 0.15 ? 4 : 0);
  crossGap += (target - crossGap) * Math.min(1, dt * 14);
  const g = crossGap, [t, b, l, r] = hud.crossI;
  t.style.top = `${-g - 7}px`; b.style.top = `${g}px`; l.style.left = `${-g - 7}px`; r.style.left = `${g}px`;
}

/* ---------- radar ---------- */
const RPX = 5; // pixels per cell
const radarMap = document.createElement('canvas'); radarMap.width = MW * RPX; radarMap.height = MH * RPX;
{
  const g = radarMap.getContext('2d');
  for (let r = 0; r < MH; r++) for (let c = 0; c < MW; c++) {
    const i = cellInfo[r][c]; if (i.ch === '#') continue;
    g.fillStyle = i.ch === 't' ? 'rgba(120,140,110,.55)' : i.h > 0 || i.stair ? 'rgba(170,190,150,.6)' : 'rgba(150,170,130,.5)';
    g.fillRect(c * RPX, r * RPX, RPX, RPX);
  }
  g.fillStyle = 'rgba(255,80,60,.9)'; g.font = 'bold 14px Tahoma'; g.fillText('A', 24.6 * RPX, 4.9 * RPX); g.fillText('B', 4.6 * RPX, 2.9 * RPX);
}
function drawRadar() {
  const g = hud.radar, S = 170, C = S / 2, k = RPX / CELL;
  g.clearRect(0, 0, S, S);
  g.save(); g.beginPath(); g.arc(C, C, C - 2, 0, 7); g.fillStyle = 'rgba(30,40,25,.55)'; g.fill(); g.clip();
  g.translate(C, C); g.rotate(player.yaw); g.translate(-player.pos.x * k, -player.pos.z * k);
  g.drawImage(radarMap, 0, 0);
  for (const b of bots) {
    if (!b.active) continue;
    if (b.alive && b.spotT <= 0) continue;
    g.fillStyle = b.alive ? '#ff3030' : 'rgba(255,60,60,.4)';
    if (b.alive) { g.beginPath(); g.arc(b.pos.x * k, b.pos.z * k, 3.2, 0, 7); g.fill(); }
    else { g.save(); g.translate(b.pos.x * k, b.pos.z * k); g.rotate(-player.yaw); g.fillRect(-3, -0.8, 6, 1.6); g.fillRect(-0.8, -3, 1.6, 6); g.restore(); }
  }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(C, C); g.lineTo(C - 60, C - 60); g.moveTo(C, C); g.lineTo(C + 60, C - 60); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(C, C, 3, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,160,0,.5)'; g.lineWidth = 1.5; g.beginPath(); g.arc(C, C, C - 2, 0, 7); g.stroke(); g.lineWidth = 1;
}

/* ---------- scoreboard ---------- */
function renderScoreboard() {
  const row = (cls, name, k, d, ping, dead, me) => `<tr class="${dead ? 'dead' : ''} ${me ? 'me' : ''}"><td>${esc(name)}${dead ? ' <small>DEAD</small>' : ''}</td><td class="num">${k}</td><td class="num">${d}</td><td class="num">${ping}</td></tr>`;
  const head = (cls, title, score, n) => `<table class="${cls}"><tr><th>${title} — ${n} player${n === 1 ? '' : 's'}</th><th class="num">${score}</th><th class="num">Deaths</th><th class="num">Latency</th></tr>`;
  const act = bots.filter(b => b.active).sort((a, b) => b.kills - a.kills);
  hud.score.innerHTML = `<h2><span>STRAFE 1.6 · de_dunes</span><span>Round ${game.ct + game.t + 1}</span></h2>` +
    head('ct', 'Counter-Terrorists', game.ct, 1) + row('ct', settings.name, player.kills, player.deaths, 5, !player.alive, true) + '</table>' +
    head('tt', 'Terrorists', game.t, act.length) + act.map(b => row('tt', b.name, b.kills, b.deaths, 'BOT', !b.alive)).join('') + '</table>';
}

/* ============================================================
   BUY MENU
   ============================================================ */
const bm = { el: $('buymenu'), list: $('bmList'), pic: $('bmPic'), stats: $('bmStats'), money: $('bmMoney'), open: false, page: -1 };
function openBuyMenu() {
  if (!canBuy()) return;
  bm.open = true; bm.page = -1; bm.el.classList.remove('hidden'); renderBuyMenu();
}
function closeBuyMenu() { bm.open = false; bm.el.classList.add('hidden'); }
function itemInfo(id) {
  const w = WEAPONS[id], e = EQUIP[id];
  if (e) return { name: e.name, price: e.price, stats: id === 'vest' ? 'Body armor.\nAbsorbs about half of body damage.' : 'Body armor + helmet.\nHelmet protects against headshots.' };
  return {
    name: w.name, price: w.price,
    stats: `Price        $${w.price}\nDamage       ${w.dmg}${w.pellets ? ' x ' + w.pellets : ''}\nRate of fire ${Math.round(60 / w.rate)} rpm\nMagazine     ${w.mag} / ${w.res}\nMove speed   ${w.speed}${w.scope ? '\nScope        ' + w.scope.length + ' zoom level' + (w.scope.length > 1 ? 's' : '') : ''}${w.auto ? '\nFire mode    automatic' : '\nFire mode    semi-automatic'}`,
  };
}
function bmShow(id) {
  if (!id) { bm.pic.getContext('2d').clearRect(0, 0, 300, 120); bm.stats.textContent = ''; return; }
  drawGunPic(bm.pic, id); bm.stats.textContent = itemInfo(id).stats;
}
function renderBuyMenu() {
  bm.money.textContent = `$${player.money}`;
  bm.list.innerHTML = '';
  const add = (key, label, price, na, onPick, hoverId) => {
    const d = document.createElement('div'); if (na) d.className = 'na';
    d.innerHTML = `<span><span class="k">${key}</span>${esc(label)}</span>${price != null ? `<span class="p">$${price}</span>` : ''}`;
    d.onclick = onPick; d.onmouseenter = () => bmShow(hoverId); bm.list.appendChild(d);
  };
  if (bm.page < 0) {
    BUY_MENU.forEach((c, i) => add(i + 1, c.name, null, false, () => bmKey(i + 1)));
    add(0, 'Cancel', null, false, () => bmKey(0));
    bmShow(player.primary || player.secondary);
  } else {
    const cat = BUY_MENU[bm.page];
    cat.items.forEach((id, i) => { const inf = itemInfo(id); add(i + 1, inf.name, inf.price, player.money < inf.price, () => bmKey(i + 1), id); });
    add(0, 'Back', null, false, () => bmKey(0));
    bmShow(cat.items[0]);
  }
}
function bmKey(n) {
  if (bm.page < 0) {
    if (n === 0) return closeBuyMenu();
    const cat = BUY_MENU[n - 1]; if (!cat) return;
    if (cat.action) { buy(cat.action); renderBuyMenu(); return; }
    bm.page = n - 1; renderBuyMenu();
  } else {
    if (n === 0) { bm.page = -1; renderBuyMenu(); return; }
    const id = BUY_MENU[bm.page].items[n - 1]; if (!id) return;
    if (buy(id)) closeBuyMenu(); else renderBuyMenu();
  }
}

/* ============================================================
   CONSOLE
   ============================================================ */
const con = { el: $('console'), out: $('conOut'), input: $('conIn'), sug: $('conSug'), history: [], hi: -1, sel: -1 };
function conPrint(text, cls) {
  const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text;
  con.out.appendChild(d);
  while (con.out.children.length > 400) con.out.firstChild.remove();
  con.out.scrollTop = con.out.scrollHeight;
}
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const CVARS = {
  sensitivity: { get: () => settings.sens, set: v => settings.sens = clamp(num(v, 2), 0.05, 50), desc: 'Mouse sensitivity' },
  fov: { get: () => settings.fov, set: v => { settings.fov = clamp(num(v, 90), 50, 130); }, desc: 'Field of view (horizontal at 4:3)' },
  default_fov: { alias: 'fov' },
  volume: { get: () => settings.volume, set: v => { settings.volume = clamp(num(v, .5), 0, 1); if (master) master.gain.value = settings.volume; }, desc: 'Master volume 0-1' },
  name: { get: () => settings.name, set: v => settings.name = String(v).slice(0, 24) || 'Player', desc: 'Your player name' },
  sv_airaccelerate: { get: () => settings.airAccel, set: v => settings.airAccel = num(v, 10), desc: 'Air acceleration (10 = classic, 100 = kz/bhop servers)' },
  sv_accelerate: { get: () => phys.accelerate, set: v => phys.accelerate = num(v, 5), desc: 'Ground acceleration' },
  sv_friction: { get: () => phys.friction, set: v => phys.friction = num(v, 4), desc: 'Ground friction' },
  sv_stopspeed: { get: () => phys.stopspeed, set: v => phys.stopspeed = num(v, 75) },
  sv_gravity: { get: () => phys.gravity, set: v => phys.gravity = num(v, 800), desc: 'World gravity' },
  sv_autobunnyhopping: { get: () => +settings.autoBhop, set: v => settings.autoBhop = num(v, 1) !== 0, desc: '1 = hold jump to bhop' },
  sv_cheats: { get: () => +cheats.enabled, set: v => { cheats.enabled = num(v, 0) !== 0; if (!cheats.enabled) { cheats.god = cheats.noclip = false; } }, desc: 'Allow cheat commands (god, noclip, give, impulse 101)' },
  bot_quota: { get: () => settings.bots, set: v => settings.bots = clamp(Math.round(num(v, 5)), 0, 10), desc: 'Number of bots (applies next round)' },
  bot_difficulty: { get: () => ['easy', 'normal', 'hard'].indexOf(settings.diff), set: v => settings.diff = ['easy', 'normal', 'hard'][clamp(Math.round(num(v, 1)), 0, 2)], desc: '0 easy, 1 normal, 2 hard' },
  bot_stop: { get: () => +botStop, set: v => botStop = num(v, 0) !== 0, desc: '1 = bots stand still and hold fire' },
  mp_roundtime: { get: () => rules.roundtime, set: v => rules.roundtime = clamp(num(v, 1.92), 0.5, 15), desc: 'Round time in minutes' },
  mp_freezetime: { get: () => rules.freezetime, set: v => rules.freezetime = clamp(num(v, 3), 0, 30), desc: 'Freeze time in seconds' },
  mp_buytime: { get: () => rules.buytime, set: v => rules.buytime = clamp(num(v, 1.5), 0.1, 30), desc: 'Buy time in minutes' },
  mp_startmoney: { get: () => rules.startmoney, set: v => rules.startmoney = clamp(Math.round(num(v, 800)), 0, 16000), desc: 'Starting money' },
  cl_showfps: { get: () => +settings.showfps, set: v => settings.showfps = num(v, 0) !== 0 },
  cl_showpos: { get: () => +settings.showpos, set: v => settings.showpos = num(v, 0) !== 0 },
  cl_radio: { get: () => +settings.radio, set: v => settings.radio = num(v, 1) !== 0, desc: 'Radio voice announcements' },
  cl_crosshair_color: { get: () => settings.crosshairColor, set: v => { settings.crosshairColor = String(v); applyCrosshairColor(); }, desc: '"r g b", e.g. "50 250 50"' },
};
function applyCrosshairColor() {
  const [r, g, b] = settings.crosshairColor.split(/\s+/).map(n => clamp(parseInt(n) || 0, 0, 255));
  hud.cross.style.setProperty('--cc', `rgb(${r},${g},${b})`);
}
const needCheats = () => { if (!cheats.enabled) { conPrint('Can\'t use cheat command in multiplayer, unless the server has sv_cheats set to 1.', 'err'); return true; } return false; };
const COMMANDS = {
  help: () => { conPrint('Type a command or cvar name. Tab completes, ↑/↓ browse history.'); conPrint('Useful: cmdlist, cvarlist, buy <item>, bot_add, bot_kick, mp_restartgame 1, sv_cheats 1, noclip, god, impulse 101, give <weapon>, kill, clear'); },
  cmdlist: () => conPrint(Object.keys(COMMANDS).sort().join('  ')),
  cvarlist: () => { for (const k of Object.keys(CVARS).sort()) { const c = CVARS[k]; if (c.alias) continue; conPrint(`${k.padEnd(22)} = "${c.get()}"${c.desc ? '   ' + c.desc : ''}`); } },
  clear: () => { con.out.innerHTML = ''; },
  echo: a => conPrint(a.join(' ')),
  version: () => conPrint('STRAFE 1.6 build 2026 (browser), map de_dunes'),
  status: () => {
    conPrint(`map     : de_dunes   round: ${game.ct + game.t + 1}   CT ${game.ct} - ${game.t} T`);
    conPrint(`# ${settings.name}  kills ${player.kills}  deaths ${player.deaths}  $${player.money}  ${player.alive ? 'alive' : 'dead'}`);
    bots.filter(b => b.active).forEach(b => conPrint(`# BOT ${b.name}  kills ${b.kills}  deaths ${b.deaths}  ${b.alive ? 'alive (' + b.gun + ')' : 'dead'}`));
  },
  buy: a => { if (!a[0]) return conPrint('Usage: buy <item>   items: ' + [...BUY_MENU.flatMap(c => c.items || []), 'pammo', 'sammo'].join(' ')); buy(a[0].toLowerCase().replace('weapon_', '')); },
  buymenu: () => { closeConsole(); openBuyMenu(); },
  kill: () => { if (player.alive && game.phase === 'live') { const g = cheats.god; cheats.god = false; damagePlayer(999, null, false, 'world'); cheats.god = g; } },
  god: () => { if (needCheats()) return; cheats.god = !cheats.god; conPrint(`godmode ${cheats.god ? 'ON' : 'OFF'}`); },
  noclip: () => { if (needCheats()) return; cheats.noclip = !cheats.noclip; conPrint(`noclip ${cheats.noclip ? 'ON' : 'OFF'}`); },
  impulse: a => { if (a[0] !== '101') return; if (needCheats()) return; addMoney(16000); player.armor = 100; player.helmet = true; for (const id in player.ammo) player.ammo[id].res = WEAPONS[id].res; conPrint('Gave money, armor and ammo.'); },
  give: a => {
    if (needCheats()) return; const id = ALIASES[(a[0] || '').replace('weapon_', '')] || (a[0] || '').replace('weapon_', '');
    if (id === 'item_assaultsuit' || id === 'vesthelm') { player.armor = 100; player.helmet = true; return; }
    if (!giveWeapon(id)) conPrint(`Unknown weapon "${a[0]}". Try: ${Object.keys(WEAPONS).filter(k => k !== 'knife').join(' ')}`, 'err');
  },
  bot_add: () => {
    if (settings.bots >= 10) return conPrint('Max 10 bots.', 'err');
    const b = bots[settings.bots]; settings.bots++; saveSettings();
    if (game.phase === 'live') b.spawn(...pick(T_SPAWNS)); conPrint(`${b.name} joined the Terrorists.`);
  },
  bot_kick: a => {
    const name = (a[0] || '').toLowerCase();
    if (!name || name === 'all') { settings.bots = 0; bots.forEach(b => { b.active = b.alive = false; b.m.g.visible = false; }); conPrint('Kicked all bots.'); }
    else { const i = bots.findIndex(b => b.active && b.name.toLowerCase() === name); if (i < 0) return conPrint('No bot named ' + a[0], 'err'); const b = bots[i]; b.active = b.alive = false; b.m.g.visible = false; conPrint('Kicked ' + b.name); }
    saveSettings();
  },
  bot_kill: () => { bots.forEach(b => { if (b.alive && b.active) { b.alive = false; b.deathT = 0; b.deaths++; } }); },
  mp_restartgame: a => { const s = Math.max(0, num(a[0], 1)); game.restartAt = simTime + s; conPrint(`Game will restart in ${s} second${s === 1 ? '' : 's'}`); cprint(`Game will restart in ${s} SECOND${s === 1 ? '' : 'S'}`); },
  restart: () => COMMANDS.mp_restartgame(['1']),
  disconnect: () => { closeConsole(); document.exitPointerLock?.(); },
  quit: () => closeConsole(),
  exit: () => closeConsole(),
  toggleconsole: () => toggleConsole(),
};
function runCommand(line) {
  line = line.trim(); if (!line) return;
  conPrint('] ' + line, 'cmd');
  for (const part of line.split(';')) {
    const toks = part.trim().match(/"[^"]*"|\S+/g); if (!toks) continue;
    const [cmd, ...args] = toks.map(t => t.replace(/^"|"$/g, ''));
    const name = cmd.toLowerCase();
    if (COMMANDS[name]) { COMMANDS[name](args); continue; }
    let cv = CVARS[name]; if (cv?.alias) cv = CVARS[cv.alias];
    if (cv) {
      if (!args.length) conPrint(`"${name}" is "${cv.get()}"${cv.desc ? '  — ' + cv.desc : ''}`);
      else { cv.set(args.join(' ')); saveSettings(); applyFov(); syncOptions(); }
      continue;
    }
    conPrint(`Unknown command: ${cmd}`, 'err');
  }
}
const ALL_NAMES = () => [...Object.keys(COMMANDS), ...Object.keys(CVARS)].sort();
function updateSuggestions() {
  const v = con.input.value.trim().toLowerCase();
  const m = v && !v.includes(' ') ? ALL_NAMES().filter(n => n.startsWith(v)).slice(0, 12) : [];
  con.sel = -1;
  con.sug.innerHTML = m.map(n => `<div>${n}${CVARS[n] && !CVARS[n].alias ? ' <span style="opacity:.6">' + esc(CVARS[n].get()) + '</span>' : ''}</div>`).join('');
  con.sug.classList.toggle('hidden', !m.length);
  [...con.sug.children].forEach((d, i) => d.onclick = () => { con.input.value = m[i] + ' '; con.input.focus(); updateSuggestions(); });
  return m;
}
con.input.addEventListener('input', updateSuggestions);
con.input.addEventListener('keydown', e => {
  e.stopPropagation();
  if (isConsoleKey(e)) { e.preventDefault(); return closeConsole(); }
  if (e.key === 'Enter') { const v = con.input.value; if (v.trim()) { con.history.push(v); con.hi = con.history.length; } con.input.value = ''; updateSuggestions(); runCommand(v); }
  else if (e.key === 'Tab') {
    e.preventDefault(); const m = updateSuggestions(); if (!m.length) return;
    let pre = m[0]; for (const n of m) while (!n.startsWith(pre)) pre = pre.slice(0, -1);
    con.input.value = m.length === 1 ? m[0] + ' ' : pre; updateSuggestions();
  } else if (e.key === 'ArrowUp') { e.preventDefault(); if (con.history.length) { con.hi = Math.max(0, con.hi - 1); con.input.value = con.history[con.hi]; } }
  else if (e.key === 'ArrowDown') { e.preventDefault(); con.hi = Math.min(con.history.length, con.hi + 1); con.input.value = con.history[con.hi] || ''; }
  else if (e.key === 'Escape') { closeConsole(); }
});
$('conSubmit').onclick = () => { runCommand(con.input.value); con.input.value = ''; con.input.focus(); };
function openConsole() {
  if (document.pointerLockElement) document.exitPointerLock();
  con.el.classList.remove('hidden'); setTimeout(() => con.input.focus(), 0);
}
function closeConsole() { con.el.classList.add('hidden'); con.input.blur(); con.sug.classList.add('hidden'); }
function toggleConsole() { if (con.el.classList.contains('hidden')) openConsole(); else closeConsole(); }
conPrint('STRAFE 1.6 console. Type "help" for a list of useful commands.', 'dim');

/* ============================================================
   INPUT
   ============================================================ */
const isConsoleKey = e => e.code === 'Backquote' || e.key === '`' || e.key === '~' || e.key === '§' || e.key === '½';
const uiBlocksInput = () => false;
addEventListener('keydown', e => {
  if (isConsoleKey(e)) { e.preventDefault(); toggleConsole(); return; }
  if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') return;
  if (!running) return;
  if (bm.open) {
    const n = e.code.startsWith('Digit') ? +e.code.slice(5) : e.code.startsWith('Numpad') ? +e.code.slice(6) : NaN;
    if (!Number.isNaN(n)) { bmKey(n); e.preventDefault(); return; }
    if (e.code === 'KeyB' || e.code === 'Escape') { closeBuyMenu(); return; }
  }
  if (e.code === 'Space' && !keys.Space) player.jumpAt = simTime;
  keys[e.code] = true;
  if (!bm.open) {
    if (e.code === 'Digit1') switchWeapon(player.primary);
    if (e.code === 'Digit2') switchWeapon(player.secondary);
    if (e.code === 'Digit3') switchWeapon('knife');
    if (e.code === 'KeyB') openBuyMenu();
  }
  if (e.code === 'KeyQ') switchWeapon(player.lastWeapon === 'knife' || player.ammo[player.lastWeapon] ? player.lastWeapon : 'knife');
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Tab') { hud.score.classList.remove('hidden'); renderScoreboard(); }
  if (['Space', 'Tab', 'ControlLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') hud.score.classList.add('hidden'); });
addEventListener('wheel', e => { if (running) { player.jumpAt = simTime; e.preventDefault(); } }, { passive: false });
addEventListener('mousedown', e => {
  if (!running) return;
  if (e.button === 0) { mouseL = true; triggerUp = true; }
  if (e.button === 2) { mouseR = true; if (curW().scope && player.alive) toggleZoom(); }
});
addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
let swayX = 0, swayY = 0;
function zoomFov() { const w = curW(); return player.zoom && w.scope ? w.scope[player.zoom - 1] : settings.fov; }
addEventListener('mousemove', e => {
  if (!running || !player.alive || bm.open) return;
  const zr = player.zoom ? zoomFov() / settings.fov * 1.2 : 1;
  const k = settings.sens * zr * 0.022 * Math.PI / 180;
  player.yaw -= e.movementX * k; player.pitch -= e.movementY * k;
  player.pitch = clamp(player.pitch, -1.55, 1.55);
  swayX += e.movementX * 0.00006 * settings.sens; swayY += e.movementY * 0.00006 * settings.sens;
});
function applyFov() { camera.fov = vfov(zoomFov()); camera.updateProjectionMatrix(); }

/* ============================================================
   MENUS / POINTER LOCK
   ============================================================ */
const mainmenu = $('mainmenu'), hudEl = $('hud');
const optEls = {};
function bindSetting(id, key, fmt = v => v, parse = parseFloat, onChange) {
  const el = $(id), out = $(id + 'Out'); optEls[id] = { el, out, key, fmt };
  if (el.type === 'checkbox') { el.onchange = () => { settings[key] = el.checked; saveSettings(); }; return; }
  el.oninput = () => { settings[key] = parse(el.value); if (out) out.textContent = fmt(settings[key]); saveSettings(); onChange?.(); };
}
function syncOptions() {
  for (const id in optEls) { const { el, out, key, fmt } = optEls[id]; if (el.type === 'checkbox') el.checked = settings[key]; else { el.value = settings[key]; if (out) out.textContent = fmt(settings[key]); } }
}
bindSetting('optName', 'name', v => v, v => v.slice(0, 24) || 'Player');
bindSetting('sens', 'sens', v => (+v).toFixed(1));
bindSetting('fov', 'fov', v => v + '°', parseFloat, applyFov);
bindSetting('aa', 'airAccel');
bindSetting('bots', 'bots', v => v, v => parseInt(v));
bindSetting('vol', 'volume', v => Math.round(v * 100) + '%', parseFloat, () => { if (master) master.gain.value = settings.volume; });
bindSetting('diff', 'diff', v => v, v => v);
bindSetting('autobhop', 'autoBhop');
bindSetting('radio', 'radio');
syncOptions(); applyCrosshairColor();

document.querySelectorAll('[data-close]').forEach(el => el.onclick = () => { $(el.dataset.close).classList.add('hidden'); if (el.dataset.close === 'console') closeConsole(); });
let pendingNew = false;
function lockPointer() {
  initAudio();
  const r = canvas.requestPointerLock?.({ unadjustedMovement: true });
  if (r && r.catch) r.catch(() => canvas.requestPointerLock()?.catch?.(() => {}));
}
$('mmNew').onclick = () => { pendingNew = true; lockPointer(); };
$('mmResume').onclick = () => lockPointer();
$('mmOptions').onclick = () => { syncOptions(); $('options').classList.remove('hidden'); };
$('mmControls').onclick = () => $('controls').classList.remove('hidden');
$('mmConsole').onclick = () => openConsole();
canvas.addEventListener('click', () => { if (started && !running && mainmenu.classList.contains('hidden')) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  running = locked;
  mainmenu.classList.toggle('hidden', locked);
  hudEl.classList.toggle('hidden', !locked && !started);
  if (locked) {
    for (const id of ['options', 'controls']) $(id).classList.add('hidden');
    closeConsole();
    if (!started || pendingNew) { started = true; pendingNew = false; newGame(); }
    $('mmResume').classList.remove('hidden');
  } else {
    for (const k in keys) keys[k] = false; mouseL = mouseR = false; closeBuyMenu(); hud.score.classList.add('hidden');
    $('mmStats').textContent = started ? `CT ${game.ct} – ${game.t} T  ·  Kills ${player.kills}  ·  Deaths ${player.deaths}  ·  $${player.money}` : '';
  }
});

/* ============================================================
   MAIN LOOP
   ============================================================ */
let vmKick = 0, vmFlashT = 0, muzzleT = 0, vmKnifeSwing = 0, bobT = 0, acc = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, fpsVal = 0;

function update(dt) {
  const p = player;
  // arrow keys turn like +left/+right/+lookup/+lookdown (cl_yawspeed 210, cl_pitchspeed 225)
  if (p.alive && !bm.open) {
    const zr = p.zoom ? zoomFov() / settings.fov : 1;
    p.yaw += ((keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0)) * THREE.MathUtils.degToRad(210) * dt * zr;
    p.pitch = clamp(p.pitch + ((keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0)) * THREE.MathUtils.degToRad(225) * dt * zr, -1.55, 1.55);
  }
  if (p.alive) {
    p.drawT = Math.max(0, p.drawT - dt);
    const w = curW();
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) { const am = p.ammo[p.weapon]; const take = Math.min(w.mag - am.mag, am.res); am.mag += take; am.res -= take; p.reloading = 0; p.shots = 0; }
    }
    if (p.rezoomAt > 0 && simTime >= p.rezoomAt) { p.zoom = p.rezoomLevel; p.rezoomAt = -1; }
    if (!bm.open) {
      if (mouseL && simTime >= p.nextFire && (w.auto || w.melee || triggerUp)) { fire(false); triggerUp = false; }
      else if (mouseR && w.melee && simTime >= p.nextFire) fire(true);
    }
    if (!mouseL) { triggerUp = true; if (simTime > p.nextFire + 0.05) p.shots = Math.max(0, p.shots - dt * 25); }
    const rec = Math.min(1, dt * (mouseL && w.auto ? 3 : 9));
    p.punch -= p.punch * rec; p.punchYaw -= p.punchYaw * rec;
    if (!w.melee && p.ammo[p.weapon] && p.ammo[p.weapon].mag === 0 && p.ammo[p.weapon].res > 0 && p.reloading <= 0 && simTime > p.nextFire) startReload();
  }
  if (bm.open && !canBuy(true)) closeBuyMenu();
  for (const b of bots) if (b.active) b.update(dt);
  updateRound(dt);
  updateEffects(dt);
  p.eyeOff += ((p.duck ? EYE_DUCK : EYE_STAND) - p.eyeOff) * Math.min(1, dt * 14);
  if (!p.alive) p.deathT += dt;
  dmgFlash = Math.max(0, dmgFlash - dt * 1.8); hud.dmg.style.opacity = dmgFlash;
  muzzleT -= dt; if (muzzleT <= 0) muzzleLight.intensity = 0;
  hud.buyicon.classList.toggle('hidden', !canBuy(true));
  updateHUD(); updateCrosshair(dt); drawRadar(); applyFov();
  if (!hud.score.classList.contains('hidden')) renderScoreboard();
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fpsVal = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  const lines = [];
  if (settings.showfps) lines.push(`${fpsVal} fps`);
  if (settings.showpos) lines.push(`pos: ${p.pos.x.toFixed(0)} ${p.pos.z.toFixed(0)} ${p.pos.y.toFixed(0)}\nang: ${THREE.MathUtils.radToDeg(p.pitch).toFixed(1)} ${THREE.MathUtils.radToDeg(p.yaw).toFixed(1)}\nvel: ${hspeed().toFixed(1)}`);
  hud.fps.textContent = lines.join('\n');
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
  const vm = getVM(p.weapon), base = vm.base, w = curW();
  const sp = p.onGround ? hspeed() : 0;
  bobT += dt * (sp > 20 ? 10 : 0);
  const bob = Math.min(1, sp / 250) * 0.008;
  swayX *= Math.pow(0.0005, dt); swayY *= Math.pow(0.0005, dt);
  vmKick *= Math.pow(0.0001, dt); vmKnifeSwing = Math.max(0, vmKnifeSwing - dt * 3);
  const draw = p.drawT > 0 ? p.drawT / 0.45 : 0;
  const rl = p.reloading > 0 && w.reload ? Math.sin(Math.min(1, (w.reload - p.reloading) / w.reload) * Math.PI) : 0;
  vm.g.position.set(base[0] + Math.cos(bobT * 0.5) * bob - clamp(swayX, -0.04, 0.04), base[1] + Math.abs(Math.sin(bobT * 0.5)) * bob - draw * 0.25 - rl * 0.12 + clamp(swayY, -0.04, 0.04) + (p.onGround ? 0 : 0.01), base[2] + vmKick);
  vm.g.rotation.set(vmKick * 1.5 - rl * 0.7 + draw * 0.6, vmKnifeSwing * 0.9, vmKnifeSwing * -0.6 + rl * 0.3);
  vmFlashT -= dt; vm.flash.visible = vmFlashT > 0; if (vm.flash.visible) vm.flash.rotation.z = rand() * 6;

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  if (p.alive && !(p.zoom && w.sniper)) renderer.render(vmScene, vmCam);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) {
    acc += dt;
    while (acc >= TICK) { physicsTick(TICK); acc -= TICK; }
    update(dt);
  } else if (!started) {
    const t = now / 1000 * 0.05;
    camera.fov = vfov(settings.fov); camera.updateProjectionMatrix();
    camera.position.set(MW * CELL / 2 + Math.cos(t) * 1700, 1500, MH * CELL / 2 + Math.sin(t) * 1700);
    camera.lookAt(MW * CELL / 2, 0, MH * CELL / 2);
    renderer.clear(); renderer.render(scene, camera); return;
  }
  render(running ? dt : 0);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = vmCam.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
});

// debug hook for testing
window.__game = { player, bots, game, keys, newGame, startRound, physicsTick, update, settings, buy, runCommand, openBuyMenu, bmKey, bm, toggleZoom, fire, findPath, set running(v) { running = v; }, get running() { return running; }, set started(v) { started = v; } };

requestAnimationFrame(frame);
