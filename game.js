// STRAFE 1.6 — a tiny GoldSrc-style shooter in the browser.
// Units are "Hammer units" like the original engine: player is 32x72, runs 250 u/s.
import * as THREE from 'three';

/* ============================================================
   SETTINGS + TUNABLE PHYSICS (most are console cvars)
   ============================================================ */
const XH_DEFAULT = { style: 0, size: 5, gap: 1, thick: 2, outline: 1, outlineThick: 1, dot: 0, t: 0, circle: 0, r: 50, g: 250, b: 50, a: 255 };
const DEFAULTS = { name: 'Player', sens: 2.0, fov: 90, airAccel: 10, teamSize: 5, volume: 0.5, diff: 'normal', autoBhop: true, radio: true, showfps: false, showpos: false, xh: XH_DEFAULT };
const settings = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem('strafe16b') || '{}'); } catch { return {}; } })());
settings.xh = Object.assign({}, XH_DEFAULT, settings.xh);
const saveSettings = () => { try { localStorage.setItem('strafe16b', JSON.stringify(settings)); } catch {} };

const phys = { gravity: 800, friction: 4, stopspeed: 75, accelerate: 5 };
const rules = { roundtime: 1.92, freezetime: 15, buytime: 20, startmoney: 800, c4timer: 40 };
const cheats = { enabled: false, god: false, noclip: false };

const TICK = 1 / 100;
const HW = 16, STAND_H = 72, DUCK_H = 36, EYE_STAND = 64, EYE_DUCK = 28, STEP = 18, EPS = 0.03;
const jumpV = () => Math.sqrt(2 * phys.gravity * 45);
const DEG = Math.PI / 180;

/* ============================================================
   RANDOM
   ============================================================ */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const srand = mulberry32(1337);
const rand = Math.random;
const pick = arr => arr[(rand() * arr.length) | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ============================================================
   MAP: de_dunes (single bombsite). Each cell is 128x128 units. North = top.
   #  wall        .  floor (0)     1  raised (64)    2  raised (128)
   t  tunnel (low roof)            d  doorway (wooden lintel)
   u  under a wooden bridge (floor 0, walkable bridge deck at 128)
   n s e w  stairs rising toward that direction
   c  crate   C  crate stack   o  barrel   (on floor 0)
   p  crate   q  crate stack   b  barrel   (on raised floor 64)
   ============================================================ */
const MW = 32, MH = 32, CELL = 128, WALL_TOP = 384, ROOF = 176, BRIDGE_Y = 128, FLOOR_BOTTOM = -128, STEPS = 8;
const grid = Array.from({ length: MH }, () => Array(MW).fill('#'));
const paint = (r0, c0, r1, c1, ch) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r][c] = ch; };
const put = (r, c, ch) => { grid[r][c] = ch; };
// CT spawn + CT route to the site
paint(2, 3, 6, 11, '.');
paint(3, 12, 5, 17, '.'); paint(3, 18, 5, 18, 'e');
// Bombsite A (raised)
paint(2, 19, 9, 29, '1');
// mid + mid doors
paint(6, 14, 24, 17, '.'); put(8, 14, '#'); put(8, 17, '#'); put(8, 15, 'd'); put(8, 16, 'd');
// short / catwalk from mid up to the site
paint(12, 18, 13, 18, 'e'); paint(12, 19, 13, 21, '1'); paint(10, 20, 11, 21, '1');
// upper mid: T ramp -> west platform -> wooden bridge over mid -> east platform -> short
paint(24, 10, 24, 13, '.'); paint(23, 11, 23, 12, 'n'); paint(22, 11, 22, 12, '1'); paint(21, 11, 21, 12, 'n');
paint(16, 11, 20, 12, '2'); paint(16, 13, 17, 17, 'u'); paint(16, 18, 17, 20, '2');
paint(15, 19, 15, 20, 's'); paint(14, 19, 14, 20, '1');
// long A
paint(10, 26, 10, 29, 'n'); paint(11, 26, 22, 29, '.');
paint(20, 19, 21, 25, '.'); put(20, 23, 'd'); put(21, 23, 'd');
paint(22, 19, 24, 20, '.');
// T spawn
paint(25, 3, 29, 24, '.');
// west tunnels (flank into CT spawn) + lower tunnel to mid
paint(7, 3, 9, 5, '.'); paint(10, 3, 24, 5, 't'); paint(13, 6, 14, 13, 't');
// props
put(2, 3, 'C'); put(6, 10, 'o'); put(2, 11, 'c');
put(4, 22, 'p'); put(4, 23, 'p'); put(3, 23, 'q'); put(7, 27, 'p'); put(8, 27, 'b'); put(2, 29, 'q'); put(7, 20, 'b'); put(5, 28, 'p');
put(11, 17, 'c'); put(22, 14, 'o'); put(10, 14, 'c');
put(14, 29, 'c'); put(15, 29, 'C'); put(19, 26, 'o'); put(12, 26, 'o');
put(18, 3, 'o'); put(26, 8, 'c'); put(27, 8, 'C'); put(27, 15, 'c'); put(26, 21, 'o'); put(28, 19, 'c'); put(29, 3, 'C');
const MAP = grid.map(r => r.join(''));

const CT_SPAWNS = [[3, 5], [4, 7], [5, 9], [3, 9], [5, 5], [4, 4], [6, 7]];
const T_SPAWNS = [[26, 11], [27, 12], [26, 14], [28, 13], [27, 17], [26, 18], [28, 16], [27, 10], [28, 21]];
const BUYZONE = { CT: [1, 2, 7, 12], T: [24, 3, 29, 24] }; // r0,c0,r1,c1
const SITE = [3, 20, 8, 28];
const inRect = (r, c, R) => r >= R[0] && r <= R[2] && c >= R[1] && c <= R[3];
const LANES = { long: [[16, 27], [11, 27]], short: [[18, 15], [12, 20]], mid: [[14, 15], [7, 15], [4, 14]], tunnels: [[17, 4], [8, 4], [4, 13]] };
const SITE_SPOTS = [[5, 24], [6, 21], [3, 26], [7, 25], [6, 27], [3, 21]];
const CT_HOLDS = [[6, 23], [3, 25], [9, 21], [11, 27], [9, 16], [4, 16], [7, 4], [8, 25]];

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
scene.background = new THREE.Color(0x8fb4da);
scene.fog = new THREE.Fog(0xe6d2a6, 2600, 9000);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 2, 20000);
camera.rotation.order = 'YXZ';
function vfov(h) { return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(h) / 2) * 0.75)); }
camera.fov = vfov(settings.fov); camera.updateProjectionMatrix();

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x9c7a4c, 1.25));
const sun = new THREE.DirectionalLight(0xffe2b0, 2.5);
sun.position.set(MW * CELL / 2 - 1400, 2600, MH * CELL / 2 + 900);
sun.target.position.set(MW * CELL / 2, 0, MH * CELL / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera; sc.left = -2800; sc.right = 2800; sc.top = 2800; sc.bottom = -2800; sc.near = 100; sc.far = 7500;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 1.5;
scene.add(sun, sun.target);
const muzzleLight = new THREE.PointLight(0xffc070, 0, 700, 0);
scene.add(muzzleLight);

/* ============================================================
   PROCEDURAL TEXTURES
   ============================================================ */
function canvasTex(size, draw, h = size) {
  const c = document.createElement('canvas'); c.width = size; c.height = h;
  draw(c.getContext('2d'), size, h);
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
function blocks(g, s, rows, base, lightness) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  const rh = s / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -50 : 0;
    while (x < s) {
      const w = 70 + srand() * 60;
      g.fillStyle = `hsl(${36 + srand() * 6},${36 + srand() * 10}%,${lightness + srand() * 12}%)`;
      g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      if (x + w > s) g.fillRect(x + 2 - s, r * rh + 2, w - 4, rh - 4);
      x += w;
    }
  }
}
const TEX = {
  sand: canvasTex(256, (g, s) => {
    g.fillStyle = '#cfae78'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 18; i++) { g.globalAlpha = 0.08; g.fillStyle = srand() < .5 ? '#b08a55' : '#e2c592'; g.beginPath(); g.arc(srand() * s, srand() * s, 20 + srand() * 50, 0, 7); g.fill(); }
    speckle(g, s, 3500, ['#b8925c', '#e0c38e', '#a88250', '#d9bb86'], 2.2, 0.7);
  }),
  wall: canvasTex(256, (g, s) => {
    blocks(g, s, 4, '#a88a5c', 70);
    speckle(g, s, 2500, ['#8f7148', '#e9d2a6', '#b39465'], 2, 0.5);
    g.globalAlpha = 0.15; g.fillStyle = '#6d5534'; for (let i = 0; i < 40; i++) g.fillRect(srand() * s, srand() * s, 1, 6 + srand() * 14); g.globalAlpha = 1;
  }),
  plaster: canvasTex(256, (g, s) => {
    g.fillStyle = '#d9c39a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 30; i++) { g.globalAlpha = 0.07; g.fillStyle = srand() < .5 ? '#a98d62' : '#f1e1bf'; g.beginPath(); g.arc(srand() * s, srand() * s, 10 + srand() * 60, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = 'rgba(110,85,50,.35)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { g.beginPath(); let x = srand() * s, y = srand() * s; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (srand() - .5) * 30; y += srand() * 18; g.lineTo(x, y); } g.stroke(); }
    // exposed bricks where plaster fell off
    for (let i = 0; i < 3; i++) { const x = srand() * 200, y = srand() * 200; g.fillStyle = '#b48d5c'; g.fillRect(x, y, 50, 30); g.strokeStyle = '#8a6a40'; g.strokeRect(x, y, 25, 15); g.strokeRect(x + 25, y + 15, 25, 15); }
    speckle(g, s, 2000, ['#bfa57a', '#f3e6c8', '#a88a5e'], 1.8, 0.45);
  }),
  trim: canvasTex(128, (g, s) => { blocks(g, s, 2, '#8a6c44', 55); speckle(g, s, 800, ['#6b5233', '#c9ab7c'], 2, 0.5); }),
  tile: canvasTex(256, (g, s) => {
    g.fillStyle = '#9d8259'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = `hsl(${35 + srand() * 6},${32 + srand() * 8}%,${62 + srand() * 8}%)`; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122); }
    speckle(g, s, 2500, ['#8a6e48', '#e2cba0', '#b49870'], 2, 0.6);
  }),
  ceil: canvasTex(128, (g, s) => {
    g.fillStyle = '#7d6745'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#5e4c32'; for (let i = 0; i < 4; i++) g.fillRect(0, i * 32, s, 3);
    speckle(g, s, 900, ['#5a472d', '#9c845e'], 2, 0.6);
  }),
  wood: canvasTex(128, (g, s) => {
    g.fillStyle = '#6e4a26'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(28,${40 + srand() * 10}%,${22 + srand() * 10}%)`; g.fillRect(0, i * 16 + 1, s, 14); }
    g.strokeStyle = 'rgba(30,18,8,.4)'; for (let i = 0; i < 30; i++) { const y = srand() * s; g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + (srand() - .5) * 4); g.stroke(); }
    g.fillStyle = '#2a1a0c'; for (let i = 0; i < 8; i++) { g.fillRect(8, i * 16 + 6, 3, 3); g.fillRect(s - 11, i * 16 + 6, 3, 3); }
  }),
  crate: canvasTex(128, (g, s) => {
    g.fillStyle = '#9b6a35'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#7a5027'; g.lineWidth = 2;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, i * s / 6); g.lineTo(s, i * s / 6); g.stroke(); }
    g.strokeStyle = '#5d3b1a'; g.lineWidth = 14; g.strokeRect(7, 7, s - 14, s - 14);
    g.lineWidth = 12; g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.stroke();
    speckle(g, s, 600, ['#6e4620', '#b07c45'], 2, 0.5);
  }),
  barrel: canvasTex(128, (g, s) => {
    const gr = g.createLinearGradient(0, 0, s, 0); gr.addColorStop(0, '#3d4a2e'); gr.addColorStop(0.5, '#62744a'); gr.addColorStop(1, '#3d4a2e');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.fillStyle = '#2c3522'; g.fillRect(0, 18, s, 6); g.fillRect(0, s - 24, s, 6);
    speckle(g, s, 500, ['#8a5a2a', '#2a2a1a'], 3, 0.5);
  }),
  win: canvasTex(64, (g, s) => {
    g.fillStyle = '#5b3d20'; g.fillRect(0, 0, s, s); g.fillStyle = '#1c140c'; g.fillRect(6, 6, s - 12, s - 12);
    g.fillStyle = '#4a3018'; g.fillRect(s / 2 - 2, 6, 4, s - 12); for (let i = 1; i < 4; i++) g.fillRect(6, 6 + i * (s - 12) / 4, s - 12, 2);
  }),
};

/* ============================================================
   WORLD GEOMETRY + COLLISION BOXES
   ============================================================ */
const cellInfo = [];
const DIRS = { n: [-1, 0], s: [1, 0], e: [0, 1], w: [0, -1] };
function baseHeight(ch) {
  if (ch === '#' || ch === undefined) return null;
  if ('1pqb'.includes(ch)) return 64;
  if (ch === '2') return 128;
  if (DIRS[ch]) return null;
  return 0;
}
for (let r = 0; r < MH; r++) {
  cellInfo[r] = [];
  for (let c = 0; c < MW; c++) {
    const ch = MAP[r][c];
    const info = { ch, h: baseHeight(ch), walk: !'#cCopqb'.includes(ch), stair: null };
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
  const f = dc === 1 ? fx : dc === -1 ? 1 - fx : dr === 1 ? fz : 1 - fz;
  const i = Math.min(STEPS - 1, Math.floor(f * STEPS));
  return base + (i + 1) * (top - base) / STEPS;
}

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
  box(mn, mx, local = false, bottom = false) {
    const [x0, y0, z0] = mn, [x1, y1, z1] = mx, size = [x1 - x0, y1 - y0, z1 - z0];
    this.face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 1, 0, 0, 2, 1, local, mn, size);
    this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0, 2, 1, local, mn, size);
    this.face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 0, 1, 0, 0, 2, local, mn, size);
    if (bottom) this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0, -1, 0, 0, 2, local, mn, size);
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
const builders = { sand: new GeoBuilder(256), wall: new GeoBuilder(128), plaster: new GeoBuilder(192), trim: new GeoBuilder(64), tile: new GeoBuilder(128), ceil: new GeoBuilder(128), wood: new GeoBuilder(64), crate: new GeoBuilder(1), barrel: new GeoBuilder(1), win: new GeoBuilder(1) };
const boxes = [];
function solid(mat, mn, mx, local = false, bottom = false) { builders[mat].box(mn, mx, local, bottom); boxes.push(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]); }
function decor(mat, mn, mx, local = false, bottom = false) { builders[mat].box(mn, mx, local, bottom); }
const isWall = (r, c) => (MAP[r]?.[c] ?? '#') === '#';
const wallMat = (r, c) => ((Math.floor(r / 3) * 7 + Math.floor(c / 4) * 3) % 5 < 2 ? 'plaster' : 'wall');

for (let r = 0; r < MH; r++) for (let c = 0; c < MW; c++) {
  const info = cellInfo[r][c], ch = info.ch;
  const x0 = c * CELL, z0 = r * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  if (ch === '#') {
    solid(wallMat(r, c), [x0, FLOOR_BOTTOM, z0], [x1, WALL_TOP, z1]);
    // cornice + windows on faces that look onto open cells
    for (const [dr, dc] of Object.values(DIRS)) {
      if (isWall(r + dr, c + dc)) continue;
      const o = 7;
      if (dc === 1) decor('trim', [x1 - 2, WALL_TOP - 14, z0], [x1 + o, WALL_TOP + 4, z1]);
      if (dc === -1) decor('trim', [x0 - o, WALL_TOP - 14, z0], [x0 + 2, WALL_TOP + 4, z1]);
      if (dr === 1) decor('trim', [x0, WALL_TOP - 14, z1 - 2], [x1, WALL_TOP + 4, z1 + o]);
      if (dr === -1) decor('trim', [x0, WALL_TOP - 14, z0 - o], [x1, WALL_TOP + 4, z0 + 2]);
      if (srand() < 0.14) {
        const y0 = 210 + srand() * 40, y1 = y0 + 64, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (dc === 1) decor('win', [x1, y0, mz - 24], [x1 + 2, y1, mz + 24], true);
        if (dc === -1) decor('win', [x0 - 2, y0, mz - 24], [x0, y1, mz + 24], true);
        if (dr === 1) decor('win', [mx - 24, y0, z1], [mx + 24, y1, z1 + 2], true);
        if (dr === -1) decor('win', [mx - 24, y0, z0 - 2], [mx + 24, y1, z0], true);
      }
    }
    continue;
  }
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
  if (ch === 't') solid('ceil', [x0, ROOF, z0], [x1, WALL_TOP, z1], false, true);
  if (ch === 'd') { solid('ceil', [x0, ROOF, z0], [x1, WALL_TOP, z1]); solid('wood', [x0 - 1, ROOF - 16, z0 - 1], [x1 + 1, ROOF, z1 + 1], false, true); }
  if (ch === 'u') {
    solid('wood', [x0, BRIDGE_Y - 14, z0], [x1, BRIDGE_Y, z1], false, true);
    // railings along the bridge edges that are open (north/south)
    if (!isWall(r - 1, c) && MAP[r - 1][c] !== 'u') decor('wood', [x0, BRIDGE_Y, z0], [x1, BRIDGE_Y + 36, z0 + 4]), boxes.push(x0, BRIDGE_Y, z0, x1, BRIDGE_Y + 36, z0 + 4);
    if (!isWall(r + 1, c) && MAP[r + 1][c] !== 'u') decor('wood', [x0, BRIDGE_Y, z1 - 4], [x1, BRIDGE_Y + 36, z1]), boxes.push(x0, BRIDGE_Y, z1 - 4, x1, BRIDGE_Y + 36, z1);
  }
  if (ch === 'c' || ch === 'p') solid('crate', [x0 + 16, h, z0 + 16], [x1 - 16, h + 64, z1 - 16], true);
  if (ch === 'C' || ch === 'q') { solid('crate', [x0 + 16, h, z0 + 16], [x1 - 16, h + 64, z1 - 16], true); solid('crate', [x0 + 28, h + 64, z0 + 24], [x1 - 28, h + 128, z1 - 32], true); }
  if (ch === 'o' || ch === 'b') {
    for (const [ox, oz] of [[-22, -20], [22, -18], [-4, 22]]) {
      const cx = (x0 + x1) / 2 + ox, cz = (z0 + z1) / 2 + oz;
      solid('barrel', [cx - 18, h, cz - 18], [cx + 18, h + 52, cz + 18], true);
    }
  }
}
const MATS = {};
for (const k in builders) {
  if (!builders[k].p.length) continue;
  MATS[k] = new THREE.MeshLambertMaterial({ map: TEX[k] });
  scene.add(builders[k].mesh(MATS[k]));
}
const BOXES = new Float32Array(boxes);
const NBOX = BOXES.length / 6;

// distant dunes on a big cylinder (cheap "skybox")
{
  const t = canvasTex(2048, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#4f86c4'); gr.addColorStop(0.62, '#a8c8e6'); gr.addColorStop(0.8, '#ecdcb8'); gr.addColorStop(1, '#e4cc9c');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const ridge = (y, amp, col, seed) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / w * Math.PI * 2 * 3 + seed) * amp + Math.sin(x / w * Math.PI * 2 * 7 + seed * 2) * amp * 0.4); g.lineTo(w, h); g.fill(); };
    ridge(h * 0.74, 18, '#d8bc86', 1); ridge(h * 0.79, 14, '#caa66e', 3); ridge(h * 0.85, 10, '#bd9862', 5);
    g.globalAlpha = 0.5; g.fillStyle = '#fff'; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(srand() * w, h * (0.1 + srand() * 0.3), 80 + srand() * 140, 14 + srand() * 10, 0, 0, 7); g.fill(); }
  }, 512);
  t.wrapT = THREE.ClampToEdgeWrapping;
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(11000, 11000, 9000, 48, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.position.set(MW * CELL / 2, 2400, MH * CELL / 2); sky.renderOrder = -1;
  scene.add(sky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshBasicMaterial({ color: 0xd2b480, fog: false }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(MW * CELL / 2, -140, MH * CELL / 2); scene.add(ground);
}

// spatial hash
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
// ray vs world using a grid walk over the spatial hash
const rayStamp = new Uint32Array(NBOX); let rayId = 1;
function rayWorld(ox, oy, oz, dx, dy, dz, maxT) {
  rayId++;
  let best = maxT, bax = -1;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  const test = o => {
    let t0 = -Infinity, t1 = Infinity, ax = -1, a, b;
    a = (BOXES[o] - ox) * ix; b = (BOXES[o + 3] - ox) * ix; if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; ax = 0; } if (b < t1) t1 = b; if (t0 > t1) return;
    a = (BOXES[o + 1] - oy) * iy; b = (BOXES[o + 4] - oy) * iy; if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; ax = 1; } if (b < t1) t1 = b; if (t0 > t1) return;
    a = (BOXES[o + 2] - oz) * iz; b = (BOXES[o + 5] - oz) * iz; if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; ax = 2; } if (b < t1) t1 = b; if (t0 > t1) return;
    if (t0 >= 0 && t0 < best) { best = t0; bax = ax; }
  };
  // 2D DDA over cells
  let c = Math.floor(ox / CELL), r = Math.floor(oz / CELL);
  const stepC = dx > 0 ? 1 : -1, stepR = dz > 0 ? 1 : -1;
  let tMaxC = Math.abs(dx) < 1e-12 ? Infinity : ((dx > 0 ? (c + 1) * CELL : c * CELL) - ox) / dx;
  let tMaxR = Math.abs(dz) < 1e-12 ? Infinity : ((dz > 0 ? (r + 1) * CELL : r * CELL) - oz) / dz;
  const tDC = Math.abs(dx) < 1e-12 ? Infinity : CELL / Math.abs(dx), tDR = Math.abs(dz) < 1e-12 ? Infinity : CELL / Math.abs(dz);
  let tCell = 0;
  for (let guard = 0; guard < 200; guard++) {
    if (r >= 0 && r < MH && c >= 0 && c < MW) for (const i of hash[r * MW + c]) { if (rayStamp[i] === rayId) continue; rayStamp[i] = rayId; test(i * 6); }
    else if (tCell > 0) break;
    if (best <= tCell || tCell > maxT) break;
    if (tMaxC < tMaxR) { tCell = tMaxC; tMaxC += tDC; c += stepC; } else { tCell = tMaxR; tMaxR += tDR; r += stepR; }
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

// bombsite markings
function decal(text, x, y, z, size, rotY = 0, wall = false, color = 'rgba(170,30,20,0.85)') {
  const t = canvasTex(256, (g, s) => { g.clearRect(0, 0, s, s); g.fillStyle = color; g.font = 'bold 200px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, s / 2, s / 2 + 10); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  if (!wall) m.rotation.x = -Math.PI / 2; m.rotation.z = wall ? 0 : Math.PI; if (wall) m.rotation.y = rotY;
  m.position.set(x, y, z); m.receiveShadow = true; scene.add(m);
}
decal('A', 25 * CELL, 64.6, 5.5 * CELL, 220);
decal('A', 30 * CELL - 0.5, 230, 6 * CELL, 200, -Math.PI / 2, true);
decal('A', 27.5 * CELL, 180, 11 * CELL - 0.5 + 128 * 0, 160, Math.PI, true); // above long ramp on site wall is open; harmless if hidden
// plant zone outline
{
  const [r0, c0, r1, c1] = SITE;
  const pts = [[c0, r0], [c1 + 1, r0], [c1 + 1, r1 + 1], [c0, r1 + 1], [c0, r0]].map(([c, r]) => new THREE.Vector3(c * CELL, 65, r * CELL));
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xaa2a1a, transparent: true, opacity: 0.55 }));
  scene.add(l);
}

/* ============================================================
   NAVIGATION (grid BFS for bots; bridge deck is players-only)
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
  if (!nav[start] || !nav[goal]) return [];
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
  beep(vol = 0.25) { sTone({ vol, f0: 2350, f1: 2350, decay: 0.09, type: 'square' }); },
  plant() { for (let i = 0; i < 7; i++) sTone({ vol: 0.12, f0: 900 + i * 120, f1: 900 + i * 120, decay: 0.06, type: 'square', delay: i * 0.4 }); },
  explode() { sNoise({ vol: 1.4, freq: 900, decay: 2.5 }); sNoise({ vol: 0.8, freq: 3000, decay: 0.8 }); sTone({ vol: 1.2, f0: 70, f1: 20, decay: 1.8 }); },
  defuse() { sTone({ vol: 0.2, f0: 500, f1: 500, decay: 0.05, type: 'square' }); },
};

/* ============================================================
   EFFECTS: decals, puffs, tracers
   ============================================================ */
const holeGeo = new THREE.CircleGeometry(2.6, 8);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x241a10, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
const holes = []; let holeI = 0;
for (let i = 0; i < 200; i++) { const m = new THREE.Mesh(holeGeo, holeMat); m.visible = false; scene.add(m); holes.push(m); }
function addHole(p, n) {
  const m = holes[holeI++ % holes.length]; m.visible = true;
  m.position.set(p.x + n.x * 0.2, p.y + n.y * 0.2, p.z + n.z * 0.2);
  m.lookAt(p.x + n.x * 10, p.y + n.y * 10, p.z + n.z * 10);
}
const puffTex = canvasTex(64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
const puffs = [];
for (let i = 0; i < 60; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false })); s.visible = false; scene.add(s); puffs.push({ s, t: 0, life: 0, size: 0, vy: 0 }); }
let puffI = 0;
function addPuff(p, color, size = 14, life = 0.35, vy = 20) {
  const P = puffs[puffI++ % puffs.length]; P.s.visible = true; P.s.position.copy(p); P.s.material.color.set(color);
  P.t = 0; P.life = life; P.size = size; P.vy = vy;
}
const tracers = [];
for (let i = 0; i < 40; i++) {
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
   WEAPON SOUNDS + RADIO
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
   SPRAY PATTERNS (degrees, x = right, y = up). Bullets follow the
   pattern; the view only kicks half as far, like CS:GO.
   ============================================================ */
const PAT = {
  ak: [[0, 0], [0.02, 0.38], [-0.05, 0.95], [0.05, 1.7], [0.12, 2.55], [-0.05, 3.35], [-0.2, 4.05], [-0.1, 4.6], [0.25, 5.0], [0.55, 5.3],
    [0.2, 5.5], [-0.45, 5.55], [-1.2, 5.6], [-1.85, 5.75], [-2.3, 5.9], [-2.15, 6.0], [-1.5, 5.95], [-0.7, 6.0], [0.2, 6.1], [1.1, 6.2],
    [1.8, 6.15], [2.4, 6.1], [2.55, 6.25], [2.2, 6.4], [1.6, 6.45], [0.9, 6.4], [0.4, 6.5], [0.7, 6.6], [1.3, 6.65], [1.9, 6.6]],
  m4: [[0, 0], [0, 0.3], [0.05, 0.8], [0, 1.4], [-0.05, 2.0], [0.05, 2.6], [0.15, 3.1], [0.1, 3.5], [-0.05, 3.8], [0.1, 4.0],
    [0.4, 4.15], [0.8, 4.25], [1.2, 4.3], [1.45, 4.4], [1.4, 4.5], [1.0, 4.55], [0.4, 4.6], [-0.3, 4.65], [-0.9, 4.7], [-1.3, 4.75],
    [-1.4, 4.85], [-1.1, 4.9], [-0.6, 4.95], [-0.2, 5.0], [0.3, 5.05], [0.7, 5.1], [0.9, 5.1], [0.7, 5.15], [0.3, 5.2], [0, 5.2]],
  smg: [[0, 0], [0, 0.25], [0.05, 0.6], [-0.05, 1.0], [0.1, 1.4], [0.2, 1.8], [0.1, 2.1], [-0.15, 2.4], [-0.4, 2.6], [-0.6, 2.75],
    [-0.5, 2.9], [-0.2, 3.0], [0.2, 3.1], [0.55, 3.15], [0.7, 3.2], [0.5, 3.3], [0.1, 3.35], [-0.3, 3.4], [-0.55, 3.45], [-0.4, 3.5]],
};
function patOffset(w, n) {
  if (w.pat) {
    const a = PAT[w.pat], s = w.patScale || 1;
    if (n < a.length) return [a[n][0] * s, a[n][1] * s];
    const L = a[a.length - 1], k = n - a.length;
    return [(L[0] + Math.sin(k * 1.3) * 1.2) * s, (L[1] + k * 0.03) * s];
  }
  // semi-autos: mostly vertical with a fixed little wobble
  const y = Math.min(n, 6) * w.recoil * 0.55, x = n ? Math.sin(n * 2.3) * w.recoil * 0.25 : 0;
  return [x, y];
}
function patAt(w, f) {
  const i = Math.floor(f), t = f - i, a = patOffset(w, i), b = patOffset(w, i + 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/* ============================================================
   WEAPONS (CS 1.6 names, prices and rough stats)
   ============================================================ */
const WEAPONS = {
  knife: { name: 'Knife', slot: 3, melee: true, dmg: 40, stab: 65, rate: 0.42, speed: 250, model: { type: 'knife' } },
  c4: { name: 'C4', slot: 5, c4: true, rate: 0.5, speed: 250, model: { type: 'c4' } },
  glock: { name: 'Glock-18', cat: 'pistol', slot: 2, price: 400, dmg: 25, rate: 0.15, mag: 20, res: 120, reload: 2.2, spread: 0.007, move: 0.035, air: 0.15, recoil: 1.0, speed: 250, falloff: 0.75, ammoCost: 20, snd: 'pistol', model: { type: 'pistol', c: 'b', len: 0.19 } },
  usp: { name: 'USP', cat: 'pistol', slot: 2, price: 500, dmg: 34, rate: 0.15, mag: 12, res: 100, reload: 2.7, spread: 0.006, move: 0.035, air: 0.15, recoil: 1.3, speed: 250, falloff: 0.79, ammoCost: 25, snd: 'pistol', model: { type: 'pistol', c: 'b', len: 0.21 } },
  p228: { name: 'P228', cat: 'pistol', slot: 2, price: 600, dmg: 32, rate: 0.15, mag: 13, res: 52, reload: 2.7, spread: 0.006, move: 0.035, air: 0.15, recoil: 1.3, speed: 250, falloff: 0.8, ammoCost: 50, snd: 'pistol', model: { type: 'pistol', c: 'm', len: 0.19 } },
  deagle: { name: 'Desert Eagle', cat: 'pistol', slot: 2, price: 650, dmg: 54, rate: 0.225, mag: 7, res: 35, reload: 2.2, spread: 0.005, move: 0.045, air: 0.18, recoil: 2.6, speed: 250, falloff: 0.81, ammoCost: 40, snd: 'deagle', model: { type: 'pistol', c: 's', g: 'b', len: 0.25 } },
  fiveseven: { name: 'Five-SeveN', team: 'CT', cat: 'pistol', slot: 2, price: 750, dmg: 25, rate: 0.15, mag: 20, res: 100, reload: 2.7, spread: 0.006, move: 0.035, air: 0.15, recoil: 1.0, speed: 250, falloff: 0.885, ammoCost: 50, snd: 'pistol', model: { type: 'pistol', c: 'g', g: 'b', len: 0.21 } },
  m3: { name: 'M3', cat: 'shotgun', slot: 1, price: 1700, dmg: 20, pellets: 9, rate: 0.88, mag: 8, res: 32, reload: 3.4, spread: 0.065, move: 0.01, air: 0.08, recoil: 5, speed: 230, falloff: 0.7, ammoCost: 65, snd: 'shotgun', model: { type: 'long', rl: 0.22, bl: 0.42, stock: 0.24, f: 'b', tube: true, pump: true } },
  xm1014: { name: 'XM1014', cat: 'shotgun', slot: 1, price: 3000, dmg: 20, pellets: 6, rate: 0.25, mag: 7, res: 32, reload: 3.4, spread: 0.07, move: 0.01, air: 0.08, recoil: 3.5, speed: 240, falloff: 0.7, ammoCost: 65, snd: 'shotgun', model: { type: 'long', rl: 0.26, bl: 0.38, stock: 0.22, f: 'b', tube: true } },
  mac10: { name: 'MAC-10', team: 'T', cat: 'smg', slot: 1, price: 1400, dmg: 29, auto: true, rate: 0.07, mag: 30, res: 100, reload: 3.15, spread: 0.009, move: 0.03, air: 0.12, pat: 'smg', patScale: 1.3, speed: 250, falloff: 0.82, ammoCost: 25, snd: 'smg', model: { type: 'long', rl: 0.18, bl: 0.06, mag: 'straight', f: 'b', fat: true } },
  tmp: { name: 'TMP', team: 'CT', cat: 'smg', slot: 1, price: 1250, dmg: 20, auto: true, rate: 0.07, mag: 30, res: 120, reload: 2.1, spread: 0.009, move: 0.03, air: 0.12, pat: 'smg', patScale: 1.0, speed: 250, falloff: 0.85, ammoCost: 20, snd: 'smg', model: { type: 'long', rl: 0.2, bl: 0.14, mag: 'straight', f: 'b', fgrip: true } },
  mp5: { name: 'MP5-Navy', cat: 'smg', slot: 1, price: 1500, dmg: 26, auto: true, rate: 0.075, mag: 30, res: 120, reload: 2.6, spread: 0.008, move: 0.03, air: 0.12, pat: 'smg', patScale: 0.9, speed: 250, falloff: 0.84, ammoCost: 20, snd: 'smg', model: { type: 'long', rl: 0.26, bl: 0.12, hg: 0.12, stock: 0.16, mag: 'curved', f: 'b' } },
  ump45: { name: 'UMP45', cat: 'smg', slot: 1, price: 1700, dmg: 30, auto: true, rate: 0.105, mag: 25, res: 100, reload: 3.5, spread: 0.008, move: 0.03, air: 0.12, pat: 'smg', patScale: 1.15, speed: 250, falloff: 0.82, ammoCost: 25, snd: 'smg', model: { type: 'long', rl: 0.3, bl: 0.1, hg: 0.12, stock: 0.18, mag: 'straight', f: 'b', rc: 'b' } },
  p90: { name: 'P90', cat: 'smg', slot: 1, price: 2350, dmg: 21, auto: true, rate: 0.066, mag: 50, res: 100, reload: 3.4, spread: 0.009, move: 0.03, air: 0.12, pat: 'smg', patScale: 0.85, speed: 245, falloff: 0.885, ammoCost: 50, snd: 'smg', model: { type: 'long', rl: 0.42, bl: 0.08, mag: 'top', bull: true, rc: 'b', f: 'b', fat: true } },
  galil: { name: 'Galil', team: 'T', cat: 'rifle', slot: 1, price: 2000, dmg: 30, auto: true, rate: 0.09, mag: 35, res: 90, reload: 2.45, spread: 0.0045, move: 0.05, air: 0.13, pat: 'ak', patScale: 0.8, speed: 240, falloff: 0.98, ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.3, bl: 0.28, hg: 0.15, stock: 0.22, mag: 'curved', f: 'b' } },
  famas: { name: 'FAMAS', team: 'CT', cat: 'rifle', slot: 1, price: 2250, dmg: 30, auto: true, rate: 0.09, mag: 25, res: 90, reload: 3.3, spread: 0.0045, move: 0.045, air: 0.13, pat: 'm4', patScale: 0.9, speed: 240, falloff: 0.96, ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.5, bl: 0.12, mag: 'straight', bull: true, handle: 0.3, rc: 'b', f: 'b' } },
  ak47: { name: 'AK-47', team: 'T', cat: 'rifle', slot: 1, price: 2500, dmg: 36, auto: true, rate: 0.1, mag: 30, res: 90, reload: 2.45, spread: 0.004, move: 0.05, air: 0.13, pat: 'ak', speed: 221, falloff: 0.98, ammoCost: 80, snd: 'rifle', model: { type: 'long', rl: 0.3, bl: 0.32, hg: 0.17, stock: 0.25, mag: 'curved', f: 'w' } },
  m4a1: { name: 'M4A1', team: 'CT', cat: 'rifle', slot: 1, price: 3100, dmg: 32, auto: true, rate: 0.09, mag: 30, res: 90, reload: 3.05, spread: 0.0035, move: 0.045, air: 0.13, pat: 'm4', speed: 230, falloff: 0.97, ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.28, bl: 0.3, hg: 0.17, stock: 0.22, mag: 'straight', handle: 0.14, rc: 'b', f: 'b' } },
  scout: { name: 'Scout', cat: 'rifle', slot: 1, price: 2750, dmg: 75, rate: 1.25, mag: 10, res: 90, reload: 2.0, sniper: true, spread: 0.035, scoped: 0.0012, move: 0.07, air: 0.02, recoil: 2.5, speed: 260, falloff: 0.98, scope: [40, 15], bolt: true, ammoCost: 80, snd: 'sniper', model: { type: 'long', rl: 0.24, bl: 0.4, stock: 0.26, mag: 'small', f: 'b', scope: true } },
  sg552: { name: 'SG 552', team: 'T', cat: 'rifle', slot: 1, price: 3500, dmg: 33, auto: true, rate: 0.09, mag: 30, res: 90, reload: 3.0, spread: 0.004, scoped: 0.003, move: 0.045, air: 0.13, pat: 'm4', patScale: 1.05, speed: 235, falloff: 0.955, scope: [55], ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.3, bl: 0.22, hg: 0.14, stock: 0.2, mag: 'straight', f: 'b', rc: 'b', smallScope: true } },
  aug: { name: 'AUG', team: 'CT', cat: 'rifle', slot: 1, price: 3500, dmg: 32, auto: true, rate: 0.09, mag: 30, res: 90, reload: 3.3, spread: 0.0038, scoped: 0.003, move: 0.045, air: 0.13, pat: 'm4', patScale: 0.9, speed: 240, falloff: 0.96, scope: [55], ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.48, bl: 0.18, mag: 'straight', bull: true, rc: 'o', f: 'o', smallScope: true } },
  sg550: { name: 'SG 550', team: 'CT', cat: 'rifle', slot: 1, price: 4200, dmg: 70, auto: true, rate: 0.25, mag: 30, res: 90, reload: 3.35, sniper: true, spread: 0.04, scoped: 0.003, move: 0.07, air: 0.15, recoil: 1.2, speed: 210, falloff: 0.98, scope: [40, 15], ammoCost: 60, snd: 'rifle', model: { type: 'long', rl: 0.3, bl: 0.38, hg: 0.14, stock: 0.26, mag: 'straight', f: 'g', rc: 'g', scope: true } },
  g3sg1: { name: 'G3SG1', team: 'T', cat: 'rifle', slot: 1, price: 5000, dmg: 80, auto: true, rate: 0.25, mag: 20, res: 90, reload: 4.6, sniper: true, spread: 0.04, scoped: 0.003, move: 0.07, air: 0.15, recoil: 1.4, speed: 210, falloff: 0.98, scope: [40, 15], ammoCost: 80, snd: 'rifle', model: { type: 'long', rl: 0.32, bl: 0.36, hg: 0.16, stock: 0.26, mag: 'straight', f: 'b', rc: 'm', scope: true } },
  awp: { name: 'AWP', cat: 'rifle', slot: 1, price: 4750, dmg: 115, rate: 1.45, mag: 10, res: 30, reload: 2.5, sniper: true, spread: 0.05, scoped: 0.0007, move: 0.09, air: 0.2, recoil: 3, speed: 210, scopeSpeed: 150, falloff: 0.99, scope: [40, 10], bolt: true, ammoCost: 125, snd: 'sniper', model: { type: 'long', rl: 0.3, bl: 0.46, stock: 0.28, mag: 'small', f: 'o', rc: 'o', scope: true } },
  m249: { name: 'M249', cat: 'mg', slot: 1, price: 5750, dmg: 32, auto: true, rate: 0.1, mag: 100, res: 200, reload: 4.7, spread: 0.006, move: 0.06, air: 0.15, pat: 'ak', patScale: 0.85, speed: 220, falloff: 0.97, ammoCost: 60, snd: 'heavy', model: { type: 'long', rl: 0.34, bl: 0.34, hg: 0.14, stock: 0.22, mag: 'box', f: 'b', fat: true } },
};
for (const id in WEAPONS) WEAPONS[id].id = id;
const BUY_MENU = [
  { name: 'Pistols', items: ['glock', 'usp', 'p228', 'deagle', 'fiveseven'] },
  { name: 'Shotguns', items: ['m3', 'xm1014'] },
  { name: 'SMGs', items: ['mac10', 'tmp', 'mp5', 'ump45', 'p90'] },
  { name: 'Rifles', items: ['galil', 'famas', 'ak47', 'm4a1', 'scout', 'sg552', 'aug', 'sg550', 'g3sg1', 'awp'] },
  { name: 'Machine Gun', items: ['m249'] },
  { name: 'Primary Ammo', action: 'pammo' },
  { name: 'Secondary Ammo', action: 'sammo' },
  { name: 'Equipment', items: ['vest', 'vesthelm', 'defuser'] },
];
const EQUIP = { vest: { name: 'Kevlar Vest', price: 650 }, vesthelm: { name: 'Kevlar Vest + Helmet', price: 1000 }, defuser: { name: 'Defuse Kit', price: 200, team: 'CT' } };
const ALIASES = { glock18: 'glock', mp5navy: 'mp5', kevlar: 'vest', assaultsuit: 'vesthelm', ak: 'ak47', m4: 'm4a1', krieg: 'sg552', bullpup: 'aug', d3au1: 'g3sg1', mac: 'mac10', defusekit: 'defuser', primammo: 'pammo', secammo: 'sammo', buyammo1: 'pammo', buyammo2: 'sammo', elites: 'glock' };
const teamItems = (cat, team) => cat.items.filter(id => { const t = (WEAPONS[id] || EQUIP[id]).team; return !t || t === team; });

/* ---------- gun model specs (shared by 3D viewmodel and buy-menu picture) ---------- */
const PAL = { m: 0x2b2b2b, b: 0x171717, s: 0xa0a0a0, w: 0x7a4a22, g: 0x4a4a4a, o: 0x4d5a36, t: 0x9a8a5a, r: 0x9a1a10 };
function gunParts(spec) {
  const P = [], add = (z, y, l, h, w, c, r = 0) => P.push({ z, y, l, h, w, c, r });
  if (spec.type === 'knife') {
    add(-0.14, 0, 0.22, 0.035, 0.008, 's'); add(0.02, -0.003, 0.11, 0.035, 0.03, 'm'); add(-0.035, 0, 0.012, 0.05, 0.05, 'm');
    return { parts: P, muzzle: [-0.25, 0] };
  }
  if (spec.type === 'c4') {
    add(-0.05, 0, 0.16, 0.06, 0.1, 't'); add(-0.08, 0.035, 0.07, 0.012, 0.06, 'g'); add(-0.01, 0.035, 0.03, 0.014, 0.03, 'r'); add(-0.05, -0.04, 0.17, 0.02, 0.08, 'b');
    return { parts: P, muzzle: [-0.15, 0] };
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
  const w = WEAPONS[id];
  if (!w) {
    const cx = cv.width / 2, cy = cv.height / 2; g.fillStyle = 'rgba(255,190,80,.85)';
    if (id === 'defuser') { g.fillRect(cx - 50, cy - 18, 100, 36); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(cx - 40, cy - 8, 30, 16); g.fillRect(cx + 5, cy - 4, 40, 8); return; }
    g.beginPath(); g.moveTo(cx, cy - 45); g.lineTo(cx + 40, cy - 30); g.lineTo(cx + 34, cy + 20); g.lineTo(cx, cy + 48); g.lineTo(cx - 34, cy + 20); g.lineTo(cx - 40, cy - 30); g.closePath(); g.fill();
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
const SLEEVES = { CT: 0x2c3346, T: 0x6b5a3c }, GLOVE = 0x1a1a1a;
const VM = {};
function getVM(id, team = player.team) {
  const key = id + '_' + team;
  if (VM[key]) return VM[key];
  const w = WEAPONS[id], g = new THREE.Group(), SLEEVE = SLEEVES[team];
  const { parts, muzzle, gripZ, bull } = gunParts(w.model);
  for (const p of parts) box(g, PAL[p.c], p.w, p.h, p.l, 0, p.y, p.z, p.r);
  const type = w.model.type;
  if (type === 'knife') { box(g, SLEEVE, 0.08, 0.08, 0.3, 0.04, -0.06, 0.2, 0.2); box(g, GLOVE, 0.07, 0.07, 0.08, 0, -0.01, 0.03); }
  else if (type === 'pistol' || type === 'c4') {
    box(g, SLEEVE, 0.07, 0.07, 0.2, 0.04, -0.15, 0.15, 0.45); box(g, GLOVE, 0.065, 0.075, 0.075, 0.012, -0.085, 0.04);
    box(g, SLEEVE, 0.07, 0.07, 0.2, -0.07, -0.16, 0.13, 0.45, -0.35); box(g, GLOVE, 0.06, 0.07, 0.07, -0.03, -0.095, 0.04);
  } else {
    box(g, SLEEVE, 0.08, 0.08, 0.32, 0.05, -0.13, gripZ + 0.17, 0.25); box(g, GLOVE, 0.07, 0.07, 0.08, 0.01, -0.075, gripZ + 0.02);
    const fz = bull ? -w.model.rl / 2 + 0.02 : -w.model.rl / 2 - 0.05;
    box(g, SLEEVE, 0.08, 0.08, 0.3, -0.12, -0.13, fz + 0.18, 0.2, -0.6); box(g, GLOVE, 0.07, 0.06, 0.08, -0.025, -0.05, fz);
  }
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.set(0, muzzle[1], muzzle[0]); flash.visible = false; g.add(flash);
  g.scale.setScalar(0.72); g.visible = false; vmScene.add(g);
  const base = type === 'pistol' ? [0.12, -0.11, -0.36] : type === 'knife' ? [0.15, -0.13, -0.28] : type === 'c4' ? [0.08, -0.16, -0.3] : [0.15, -0.155, -0.36 + (bull ? -0.04 : 0)];
  return (VM[key] = { g, flash, base });
}
function showVM(id) { for (const k in VM) VM[k].g.visible = false; if (id) getVM(id).g.visible = true; }

/* ============================================================
   CROSSHAIR (CS:GO-style cvars, drawn on a canvas)
   ============================================================ */
const XH_PRESETS = {
  'Classic dynamic': { style: 0, size: 5, gap: 1, thick: 2, outline: 1, outlineThick: 1, dot: 0, t: 0, circle: 0, r: 50, g: 250, b: 50, a: 255 },
  'Small static': { style: 1, size: 2.5, gap: -1, thick: 1, outline: 1, outlineThick: 1, dot: 0, t: 0, circle: 0, r: 0, g: 255, b: 255, a: 255 },
  'Dot': { style: 1, size: 0, gap: 0, thick: 3, outline: 1, outlineThick: 1, dot: 1, t: 0, circle: 0, r: 255, g: 255, b: 0, a: 255 },
  'Cross + dot': { style: 1, size: 4, gap: 0, thick: 1.5, outline: 1, outlineThick: 1, dot: 1, t: 0, circle: 0, r: 255, g: 255, b: 255, a: 255 },
  'T-shape': { style: 1, size: 4, gap: 1, thick: 2, outline: 1, outlineThick: 1, dot: 0, t: 1, circle: 0, r: 255, g: 60, b: 255, a: 255 },
  'Circle': { style: 0, size: 3, gap: 4, thick: 1.5, outline: 0, outlineThick: 1, dot: 1, t: 0, circle: 1, r: 50, g: 250, b: 50, a: 220 },
};
function drawCrosshair(cv, xh, extraGap) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
  g.clearRect(0, 0, W, H);
  const len = xh.size * 2, gap = Math.max(0, xh.gap + 4 + extraGap), th = Math.max(0.5, xh.thick), o = xh.outline ? xh.outlineThick : 0;
  const col = `rgba(${xh.r},${xh.g},${xh.b},${xh.a / 255})`;
  const rects = [];
  if (len > 0) {
    rects.push([cx + gap, cy - th / 2, len, th], [cx - gap - len, cy - th / 2, len, th], [cx - th / 2, cy + gap, th, len]);
    if (!xh.t) rects.push([cx - th / 2, cy - gap - len, th, len]);
  }
  if (xh.dot) rects.push([cx - th / 2, cy - th / 2, th, th]);
  const snap = r => r.map(v => Math.round(v));
  if (o) { g.fillStyle = `rgba(0,0,0,${xh.a / 255})`; for (const r of rects) { const [x, y, w, h] = snap(r); g.fillRect(x - o, y - o, w + 2 * o, h + 2 * o); } }
  g.fillStyle = col; for (const r of rects) { const [x, y, w, h] = snap(r); g.fillRect(x, y, w, h); }
  if (xh.circle) {
    const rad = gap + len / 2;
    if (o) { g.strokeStyle = `rgba(0,0,0,${xh.a / 255})`; g.lineWidth = th + 2 * o; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.stroke(); }
    g.strokeStyle = col; g.lineWidth = th; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.stroke();
  }
}

/* ============================================================
   PLAYER
   ============================================================ */
const player = {
  isPlayer: true, team: 'CT', get name() { return settings.name; },
  pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: Math.PI, pitch: 0, onGround: false, duck: false, eyeOff: EYE_STAND, hp: 100, armor: 0, helmet: false, kit: false, alive: false,
  money: 800, primary: null, secondary: 'usp', weapon: 'usp', lastWeapon: 'knife', ammo: {},
  jumpAt: -1, nextFire: 0, reloading: 0, drawT: 0, shots: 0, punch: 0, punchYaw: 0, zoom: 0, rezoomAt: -1, rezoomLevel: 0,
  stepT: 0, deathT: 0, kills: 0, deaths: 0, lossStreak: 0, plantT: 0, defuseT: 0, spec: -1, pendingTeam: null,
};
const keys = {};
let mouseL = false, mouseR = false, triggerUp = true, simTime = 0, running = false, started = false, shake = 0;

const hspeed = () => Math.hypot(player.vel.x, player.vel.z);
const curW = () => WEAPONS[player.weapon];
function moveSpeed() { const w = curW(); return player.zoom && w.scopeSpeed ? w.scopeSpeed : w.speed; }
const busy = () => player.plantT > 0 || player.defuseT > 0;

function physicsTick(dt) {
  const p = player, P = p.pos;
  simTime += dt;
  p.prev.copy(P);
  if (!p.alive) return;
  const frozen = game.freeze > 0 || busy();
  const fm = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), sm = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);

  if (cheats.noclip) {
    const d = viewDir(p.yaw, p.pitch), sp = (keys.ShiftLeft ? 1200 : 500) * dt;
    P.x += (d.x * fm + cy * sm) * sp; P.y += (d.y * fm + ((keys.Space ? 1 : 0) - (keys.ControlLeft ? 1 : 0))) * sp; P.z += (d.z * fm - sy * sm) * sp;
    p.vel.set(0, 0, 0); p.onGround = false; return;
  }

  // duck (ducking in the air pulls the legs up, like GoldSrc)
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

  let wx = -sy * fm + cy * sm, wz = -cy * fm - sy * sm;
  const wl = Math.hypot(wx, wz);
  let wishspeed = 0;
  if (wl > 0 && !frozen) {
    wx /= wl; wz /= wl;
    wishspeed = moveSpeed();
    if (p.duck && p.onGround) wishspeed *= 0.333; else if (keys.ShiftLeft || keys.ShiftRight) wishspeed *= 0.52;
  }

  // jump: friction is skipped on the tick you jump => bhop
  let jumped = false;
  const wantJump = !frozen && ((settings.autoBhop && keys.Space) || (simTime - p.jumpAt < 0.06));
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
    const cur = p.vel.x * wx + p.vel.z * wz, add = Math.min(wishspeed, 30) - cur;
    if (add > 0) { const as = Math.min(add, settings.airAccel * wishspeed * dt); p.vel.x += as * wx; p.vel.z += as * wz; }
    p.vel.y -= phys.gravity * dt * 0.5;
  }

  const wasGround = p.onGround, fallSpeed = -p.vel.y;
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
  if (p.vel.y <= 0) { g = probe(1); if (g === null && wasGround && !jumped) g = probe(STEP + 1); }
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
  const w = curW(); if (w.melee || w.c4) return 0;
  const p = player;
  let s = p.zoom && w.scoped ? w.scoped : w.spread;
  if (!p.onGround) s += w.air;
  else s += w.move * clamp((hspeed() - 60) / 190, 0, 1) * (w.sniper && p.zoom ? 1.5 : 1);
  if (p.duck && p.onGround) s *= 0.75;
  if (w.auto) s += Math.min(p.shots, 12) * 0.0012;
  return s;
}
function viewDir(yaw, pitch) { return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); }
function eyePos() { return new THREE.Vector3(player.pos.x, player.pos.y + player.eyeOff, player.pos.z); }

function traceShot(o, d, range, ignoreTeam) {
  const wh = rayWorld(o.x, o.y, o.z, d.x, d.y, d.z, range);
  let best = wh ? wh.t : range, bot = null, head = false;
  for (const b of bots) {
    if (!b.alive || !b.active || b.team === ignoreTeam) continue;
    const { x, z } = b.pos, y = b.pos.y - ((b.duck || b.busy) ? 18 : 0);
    const th = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, x - 8, y + 60, z - 8, x + 8, y + 76, z + 8);
    if (th < best) { best = th; bot = b; head = true; }
    const tb = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, x - 14, b.pos.y, z - 14, x + 14, y + 60, z + 14);
    if (tb < best) { best = tb; bot = b; head = false; }
  }
  return { t: best, bot, head, world: !bot && wh ? wh : null };
}

function fire(alt = false) {
  const p = player, w = curW();
  if (p.drawT > 0 || p.reloading > 0 || !p.alive || game.freeze > 0 || w.c4) return;
  const o = eyePos();
  if (w.melee) {
    const d = viewDir(p.yaw, p.pitch), h = traceShot(o, d, 64, p.team);
    p.nextFire = simTime + (alt ? 1.0 : w.rate);
    SFX.knife(); vmKick = alt ? 0.12 : 0.07; vmKnifeSwing = 1;
    if (h.bot) { damageBot(h.bot, alt ? w.stab : w.dmg, false, 'Knife', player); addPuff(o.clone().addScaledVector(d, h.t), 0xaa1010, 12); }
    else if (h.world) { SFX.ricochet(); addPuff(o.clone().addScaledVector(d, h.t), 0xc8b090, 8); }
    return;
  }
  const am = p.ammo[p.weapon];
  if (am.mag <= 0) { SFX.click(); p.nextFire = simTime + 0.25; if (am.res > 0) startReload(); return; }
  am.mag--;
  p.nextFire = simTime + w.rate;

  // spray pattern: bullet goes to view + pattern offset, then random inaccuracy on top
  const n = Math.floor(p.shots + 0.001);
  const [ox, oy] = patOffset(w, n);
  p.shots = n + 1;
  const sp = currentSpread();
  const yaw = p.yaw - ox * DEG, pitch = p.pitch + oy * DEG;
  const fwd = viewDir(yaw, pitch);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), up = new THREE.Vector3().crossVectors(right, fwd);
  const muzzleWorld = o.clone().addScaledVector(viewDir(p.yaw, p.pitch), 30).addScaledVector(new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)), 6).add(new THREE.Vector3(0, -6, 0));
  const hitBots = new Map(); let shotEnd = null;
  for (let i = 0; i < (w.pellets || 1); i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * sp;
    const d = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    const h = traceShot(o, d, 8192, p.team);
    const hit = o.clone().addScaledVector(d, h.t);
    if (h.bot) {
      const dmg = w.dmg * (h.head ? 4 : 1) * Math.pow(w.falloff, h.t / 500);
      const e = hitBots.get(h.bot) || { dmg: 0, head: false }; e.dmg += dmg; e.head ||= h.head; hitBots.set(h.bot, e);
      if (i < 3) addPuff(hit, 0x9a0c0c, h.head ? 22 : 14, 0.4, 5);
    } else if (h.world) {
      const nn = new THREE.Vector3(h.world.nx, h.world.ny, h.world.nz);
      addHole(hit, nn); if (i < 3) addPuff(hit.clone().addScaledVector(nn, 2), 0xd8c49a, 16, 0.5, 25);
    }
    if (i === 0) { if (rand() < 0.5) addTracer(muzzleWorld, hit); shotEnd = hit; }
  }
  for (const [b, e] of hitBots) damageBot(b, e.dmg, e.head, w.name, player);
  if (shotEnd && online()) {
    const fx = { a: [r1(muzzleWorld.x), r1(muzzleWorld.y), r1(muzzleWorld.z)], b: [r1(shotEnd.x), r1(shotEnd.y), r1(shotEnd.z)] };
    if (isHost()) netSend({ t: 'fx', f: ID_HOST, ...fx }); else netSend({ t: 'shot', ...fx }, net.hostId);
  }

  SFX.shot(w.snd);
  vmKick = w.auto ? 0.035 : 0.07; vmFlashT = 0.04;
  muzzleLight.position.copy(muzzleWorld); muzzleLight.intensity = 3; muzzleT = 0.04;
  if (w.bolt) { SFX.bolt(); if (p.zoom) { p.rezoomLevel = p.zoom; p.zoom = 0; p.rezoomAt = simTime + w.rate * 0.9; } }
  for (const b of bots) if (b.alive && b.active && b.team !== p.team && !b.target && b.pos.distanceTo(p.pos) < 2200) { b.alertT = 3; b.lastKnown = p.pos.clone(); b.hunt(p.pos); }
}
function toggleZoom() {
  const w = curW(); if (!w.scope || player.reloading > 0) return;
  player.zoom = (player.zoom + 1) % (w.scope.length + 1); player.rezoomAt = -1; SFX.zoom();
}
function startReload() {
  const p = player, w = curW(); if (w.melee || w.c4) return;
  const am = p.ammo[p.weapon]; if (p.reloading > 0 || am.mag >= w.mag || am.res <= 0) return;
  p.reloading = w.reload; p.zoom = 0; p.rezoomAt = -1; SFX.reload();
}
function switchWeapon(id) {
  const p = player; if (!id || id === p.weapon || !p.alive) return;
  if (id === 'c4' && bomb.carrier !== p) return;
  p.lastWeapon = p.weapon; p.weapon = id; p.reloading = 0; p.drawT = 0.45; p.shots = 0; p.zoom = 0; p.rezoomAt = -1;
  showVM(id); updateHUD(true);
}
function giveWeapon(id, select = true) {
  const w = WEAPONS[id]; if (!w || w.c4) return false;
  const p = player;
  if (w.slot === 1) { if (p.primary) delete p.ammo[p.primary]; p.primary = id; }
  else if (w.slot === 2) { if (p.secondary) delete p.ammo[p.secondary]; p.secondary = id; }
  if (!w.melee) p.ammo[id] = { mag: w.mag, res: w.slot === 2 && (id === 'usp' || id === 'glock') ? w.mag * 2 : w.res };
  if (select) { p.weapon = null; switchWeapon(id); }
  return true;
}

/* ============================================================
   BOTS (both teams)
   ============================================================ */
const BOT_NAMES = { T: ['Gravel', 'Mirage', 'Scorpion', 'Viper', 'Jackal', 'Cobra', 'Nomad', 'Sirocco', 'Rattler', 'Sandman'], CT: ['Hawk', 'Ranger', 'Frost', 'Bishop', 'Tango', 'Ghost', 'Wolf', 'Atlas', 'Sierra', 'Delta'] };
const DIFF = { easy: { acc: 0.6, react: 1.6, dmg: 0.8 }, normal: { acc: 1, react: 1, dmg: 1 }, hard: { acc: 1.35, react: 0.6, dmg: 1.15 } };
const BOT_GUNS = { T: ['ak47', 'ak47', 'ak47', 'ak47', 'galil', 'galil', 'awp', 'sg552', 'mac10', 'deagle'], CT: ['m4a1', 'm4a1', 'm4a1', 'm4a1', 'famas', 'famas', 'awp', 'aug', 'mp5', 'deagle'] };
let botStop = false;
function makeBotMesh(team) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const C = team === 'T' ? { cloth: 0x7a6644, pants: 0x4d4535, vest: 0x3a3628, head: 0x1d1d1d } : { cloth: 0x3c4658, pants: 0x2e3442, vest: 0x22262d, head: 0x2b302b };
  const leg = x => { const pv = new THREE.Group(); pv.position.set(x, 32, 0); const m = new THREE.Mesh(new THREE.BoxGeometry(10, 32, 11), L(C.pants)); m.position.y = -16; pv.add(m); g.add(pv); return pv; };
  const legL = leg(-6), legR = leg(6);
  const add = (geo, col, x, y, z, rx = 0, ry = 0) => { const m = new THREE.Mesh(geo, L(col)); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); g.add(m); return m; };
  add(new THREE.BoxGeometry(26, 30, 15), C.cloth, 0, 47, 0);
  add(new THREE.BoxGeometry(28, 18, 17), C.vest, 0, 50, 0);
  if (team === 'T') { add(new THREE.BoxGeometry(14, 15, 14), C.head, 0, 69, 0); add(new THREE.BoxGeometry(10, 4, 1), 0xb48a64, 0, 71, -7.2); }
  else { add(new THREE.BoxGeometry(14, 14, 14), 0xb48a64, 0, 68, 0); add(new THREE.BoxGeometry(17, 8, 17), C.head, 0, 76, 0); add(new THREE.BoxGeometry(12, 4, 2), 0x111111, 0, 70, -7.5); }
  add(new THREE.BoxGeometry(8, 8, 24), C.cloth, 11, 53, -9, 0.15);
  add(new THREE.BoxGeometry(8, 8, 22), C.cloth, -9, 52, -13, 0.1, -0.5);
  const gun = add(new THREE.BoxGeometry(4, 7, 36), 0x222222, 4, 55, -26);
  const pack = add(new THREE.BoxGeometry(16, 18, 8), 0x9a8a5a, 0, 50, 12); pack.visible = false;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; scene.add(g);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(26); flash.position.set(4, 56, -46); flash.visible = false; g.add(flash);
  return { g, legL, legR, flash, gun, pack };
}
const entEye = e => e.isPlayer ? eyePos() : e.eye();
const entChest = e => new THREE.Vector3(e.pos.x, e.pos.y + (e.isPlayer && e.duck ? 22 : 40), e.pos.z);
const entSpeed = e => e.isPlayer ? hspeed() : e.human ? (e.netSpeed || 0) : (e.moving ? 190 : 0);
function clearLine(a, b) {
  const d = b.clone().sub(a), len = d.length(); if (len < 1) return true; d.divideScalar(len);
  return !rayWorld(a.x, a.y, a.z, d.x, d.y, d.z, len);
}
const entities = () => [player, ...bots.filter(b => b.active)];
const teamAlive = team => entities().filter(e => e.team === team && e.alive).length;

class Bot {
  constructor(i) {
    this.idx = i; this.meshes = {}; this.pos = new THREE.Vector3(); this.active = false; this.alive = false;
    this.kills = 0; this.deaths = 0; this.team = 'T'; this.name = 'Bot';
  }
  get m() { return this.meshes[this.team] || (this.meshes[this.team] = makeBotMesh(this.team)); }
  spawn(team, name, r, c) {
    for (const k in this.meshes) this.meshes[k].g.visible = false;
    this.team = team; this.name = name;
    const p = cellCenter(r, c); p.x += (rand() - .5) * 40; p.z += (rand() - .5) * 40; p.y = floorHeight(p.x, p.z);
    Object.assign(this, { active: true, alive: true, hp: 100, yaw: team === 'CT' ? Math.PI : 0, path: [], goals: [], target: null, spotT: 0, seeT: rand() * 0.1, react: 0, fireCd: 0, burst: 0, walkT: 0, deathT: 0, alertT: 0, lastKnown: null, flashT: 0, idleT: rand() * 1.5, strafe: 0, moving: false, plantT: 0, defuseT: 0, holdT: 0 });
    this.gun = pick(BOT_GUNS[team]); this.kit = team === 'CT' && rand() < 0.5;
    const W = WEAPONS[this.gun]; this.m.gun.scale.z = W.slot === 2 ? 0.45 : W.sniper ? 1.4 : 1;
    this.pos.copy(p);
    const g = this.m.g; g.visible = true; g.rotation.set(0, this.yaw, 0); g.position.copy(p);
    this.planRoute();
  }
  planRoute() {
    if (this.team === 'T') {
      const lane = pick(['long', 'long', 'short', 'mid', 'tunnels']);
      this.goals = [...LANES[lane], pick(SITE_SPOTS)];
    } else {
      this.goals = [CT_HOLDS[this.idx % CT_HOLDS.length]];
    }
    this.path = [];
  }
  goTo([r, c]) { this.path = findPath(Math.floor(this.pos.z / CELL), Math.floor(this.pos.x / CELL), r, c); }
  goToPos(v) { this.goTo([Math.floor(v.z / CELL), Math.floor(v.x / CELL)]); this.path.push(v.clone()); }
  hunt(v) { this.goals = []; this.goTo([Math.floor(v.z / CELL), Math.floor(v.x / CELL)]); }
  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 68, this.pos.z); }
  faces(e, deg) {
    const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
    return (-Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz) / l > Math.cos(deg * DEG);
  }
  scan() {
    let best = null, bestD = Infinity;
    const e0 = this.eye();
    for (const e of entities()) {
      if (e.team === this.team || !e.alive) continue;
      const d = e0.distanceTo(e.pos); if (d > 4000 || d > bestD) continue;
      if (!(e === this.target || this.alertT > 0 || this.faces(e, 80))) continue;
      if (!clearLine(e0, entEye(e)) && !clearLine(e0, entChest(e))) continue;
      best = e; bestD = d;
    }
    if (botStop) best = null;
    if (best && best !== this.target) this.react = (0.35 + rand() * 0.4) * DIFF[settings.diff].react;
    this.target = best;
    if (best) { this.lastKnown = best.pos.clone(); if (!best.isPlayer && this.team === player.team) best.spotT = 1; }
    // spotted by the human player (for the radar)
    if (this.team !== player.team && player.alive && clearLine(eyePos(), this.eye())) {
      const f = viewDir(player.yaw, 0), dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
      if ((f.x * dx + f.z * dz) / Math.hypot(dx, dz) > 0.5) this.spotT = 1;
    }
  }
  // network-driven body (remote players on the host, everything on a client)
  puppet(dt) {
    const g = this.m.g;
    this.m.pack.visible = bomb.carrier === this;
    this.flashT -= dt; this.m.flash.visible = this.flashT > 0; this.spotT -= dt;
    if (this.waiting) { g.visible = false; return; }
    g.visible = true;
    if (this.netPos) {
      if (this.pos.distanceToSquared(this.netPos) > 300 * 300) this.pos.copy(this.netPos); else this.pos.lerp(this.netPos, Math.min(1, dt * 12));
      let d = (this.netYaw ?? this.yaw) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 15);
    }
    if (!this.alive) {
      this.deathT += dt; g.rotation.x = -Math.min(1, this.deathT * 3.5) * Math.PI / 2;
      g.position.copy(this.pos); g.position.y += 6 * Math.min(1, this.deathT * 3.5); return;
    }
    g.rotation.x = 0;
    this.seeT = (this.seeT || 0) - dt;
    if (this.seeT <= 0) {
      this.seeT = 0.15;
      if (this.team !== player.team && player.alive && clearLine(eyePos(), this.eye())) {
        const f = viewDir(player.yaw, 0), dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
        if ((f.x * dx + f.z * dz) / (Math.hypot(dx, dz) || 1) > 0.5) this.spotT = 1;
      }
    }
    if (this.moving) this.walkT += dt * 9;
    const sw = this.moving ? Math.sin(this.walkT) * 0.6 : 0;
    this.m.legL.rotation.x = sw; this.m.legR.rotation.x = -sw;
    g.position.copy(this.pos); g.position.y -= (this.duck || this.busy) ? 18 : 0; g.rotation.y = this.yaw;
  }
  update(dt) {
    if (this.human || isClient()) return this.puppet(dt);
    const g = this.m.g;
    this.m.pack.visible = bomb.carrier === this;
    if (!this.alive) {
      this.deathT += dt; g.rotation.x = -Math.min(1, this.deathT * 3.5) * Math.PI / 2;
      g.position.y = this.pos.y + 6 * Math.min(1, this.deathT * 3.5); return;
    }
    this.alertT -= dt; this.seeT -= dt; this.flashT -= dt; this.spotT -= dt;
    this.m.flash.visible = this.flashT > 0;
    if (this.seeT <= 0) { this.seeT = 0.12; this.scan(); }
    this.moving = false;
    if (game.freeze > 0) return this.pose(dt);
    if (this.target && this.target.alive) {
      this.plantT = 0; this.defuseT = 0;
      const pe = entEye(this.target);
      this.turnTo(Math.atan2(-(pe.x - this.pos.x), -(pe.z - this.pos.z)), 14, dt);
      this.react -= dt;
      if (this.react <= 0) {
        this.fireCd -= dt;
        if (this.fireCd <= 0) {
          this.shoot(this.target); this.burst++;
          const W = WEAPONS[this.gun];
          this.fireCd = W.auto ? (this.burst % (3 + ((rand() * 3) | 0)) === 0 ? 0.45 + rand() * 0.4 : W.rate * 1.2) : W.rate + 0.15 + rand() * 0.35;
        }
      }
      this.strafe -= dt;
      if (this.strafe < -0.6) this.strafe = 0.5 + rand() * 0.6;
      if (this.strafe > 0 && !WEAPONS[this.gun].sniper) {
        const sdir = Math.sin(simTime * 2 + this.idx) > 0 ? 1 : -1;
        const nx = this.pos.x + Math.cos(this.yaw) * sdir * 90 * dt, nz = this.pos.z - Math.sin(this.yaw) * sdir * 90 * dt;
        const ci = cellAt(nx, nz); if (ci && ci.walk && Math.abs(floorHeight(nx, nz) - this.pos.y) < 20) { this.pos.x = nx; this.pos.z = nz; this.moving = true; }
      }
      return this.pose(dt);
    }
    this.target = null;
    if (botStop) return this.pose(dt);
    if (this.objective(dt)) return this.pose(dt);
    if (this.path.length) {
      const wp = this.path[0];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, dist = Math.hypot(dx, dz);
      const step = 190 * dt;
      if (dist <= step) { this.pos.x = wp.x; this.pos.z = wp.z; this.path.shift(); }
      else { this.pos.x += dx / dist * step; this.pos.z += dz / dist * step; }
      this.turnTo(Math.atan2(-dx, -dz), 7, dt);
      this.moving = true;
    } else if (this.goals.length) {
      this.goTo(this.goals.shift());
    } else {
      // holding a position: look around, sometimes go check a noise
      this.idleT -= dt;
      if (this.idleT <= 0) {
        this.idleT = 1.5 + rand() * 3;
        if (this.lastKnown && rand() < 0.6) { this.hunt(this.lastKnown); this.lastKnown = null; }
        else this.yaw += (rand() - 0.5) * 2;
      }
    }
    this.pose(dt);
  }
  // bomb objectives; returns true while the bot is busy planting/defusing
  objective(dt) {
    const r = Math.floor(this.pos.z / CELL), c = Math.floor(this.pos.x / CELL);
    if (this.team === 'T') {
      if (bomb.carrier === this) {
        if (inRect(r, c, SITE) && !this.path.length) {
          this.plantT += dt;
          if (this.plantT >= 3.2) plantBomb(this);
          return true;
        }
        if (!this.path.length && !this.goals.length) this.goals = [pick(SITE_SPOTS)];
      } else if (bomb.state === 'dropped' && bomb.fetcher === this) {
        if (this.pos.distanceTo(bomb.pos) < 48) pickupBomb(this);
        else if (!this.path.length) this.goToPos(bomb.pos);
      } else if (bomb.state === 'planted' && !this.guarding) {
        this.guarding = true; this.goals = []; this.goTo(pick(SITE_SPOTS));
      }
    } else if (bomb.state === 'planted') {
      const d = Math.hypot(this.pos.x - bomb.pos.x, this.pos.z - bomb.pos.z);
      if (d < 40) {
        if (!bomb.defuser || bomb.defuser === this) {
          bomb.defuser = this; this.defuseT += dt;
          if (this.defuseT >= (this.kit ? 5 : 10)) defuseBomb(this);
          return true;
        }
      } else if (!this.path.length || this.headingTo !== 'bomb') { this.headingTo = 'bomb'; this.goals = []; this.goToPos(bomb.pos); }
    }
    return false;
  }
  pose(dt) {
    this.pos.y = floorHeight(this.pos.x, this.pos.z);
    if (this.moving) this.walkT += dt * 9;
    const sw = this.moving ? Math.sin(this.walkT) * 0.6 : 0;
    this.m.legL.rotation.x = sw; this.m.legR.rotation.x = -sw;
    const g = this.m.g;
    g.position.copy(this.pos); g.rotation.y = this.yaw;
    g.position.y -= (this.plantT > 0 || this.defuseT > 0) ? 18 : 0;
  }
  turnTo(target, rate, dt) {
    let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += clamp(d, -rate * dt, rate * dt);
  }
  shoot(t) {
    const D = DIFF[settings.diff], W = WEAPONS[this.gun];
    const e = this.eye(); e.y -= 12;
    const dist = e.distanceTo(t.pos);
    SFX.enemy(e.distanceTo(eyePos()));
    this.flashT = 0.05;
    let chance = 0.42 * D.acc - dist / 6000 - entSpeed(t) / 1100 - (t.isPlayer && !t.onGround ? 0.12 : 0) - (t.isPlayer && t.duck ? 0.04 : 0);
    if (this.burst % 5 === 0) chance += 0.1;
    if (W.sniper) chance += 0.1;
    if (!t.isPlayer) chance *= 0.85; // bot vs bot fights last a bit longer
    chance = clamp(chance, 0.04, 0.75);
    const target = entChest(t);
    if (rand() < chance) {
      const hs = rand() < 0.05 * D.acc;
      let dmg = W.dmg * (0.65 + rand() * 0.25) * D.dmg;
      if (hs) dmg *= 4;
      if (t.isPlayer) damagePlayer(dmg, this, hs, W.name); else damageBot(t, dmg, hs, W.name, this);
      addTracer(e, target); botFx(this, e, target);
    } else {
      const miss = target.clone().add(new THREE.Vector3((rand() - .5) * 90, (rand() - .3) * 70, (rand() - .5) * 90));
      const d = miss.clone().sub(e).normalize();
      const h = rayWorld(e.x, e.y, e.z, d.x, d.y, d.z, 8000);
      if (h) {
        const p = e.clone().addScaledVector(d, h.t); addTracer(e, p); botFx(this, e, p);
        const n = new THREE.Vector3(h.nx, h.ny, h.nz); addHole(p, n); addPuff(p.clone().addScaledVector(n, 2), 0xd8c49a, 14, 0.45, 25);
        if (p.distanceTo(eyePos()) < 120) SFX.ricochet();
      } else { addTracer(e, miss); botFx(this, e, miss); }
    }
  }
}
function botFx(b, a, c) { if (isHost()) netSend({ t: 'fx', f: b.idx, a: [r1(a.x), r1(a.y), r1(a.z)], b: [r1(c.x), r1(c.y), r1(c.z)] }); }
const bots = Array.from({ length: 21 }, (_, i) => new Bot(i));

/* ============================================================
   BOMB
   ============================================================ */
const bomb = { state: 'none', carrier: null, pos: new THREE.Vector3(), timer: 0, beepT: 0, fetcher: null, defuser: null, planter: null };
const bombMesh = new THREE.Group();
{
  const b = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 12), L(0x9a8a5a)); b.position.y = 4; bombMesh.add(b);
  const k = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 6), L(0x444444)); k.position.set(-3, 9, 0); bombMesh.add(k);
  bombMesh.led = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff2020, map: puffTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  bombMesh.led.scale.setScalar(10); bombMesh.led.position.set(5, 10, 0); bombMesh.add(bombMesh.led);
  bombMesh.visible = false; scene.add(bombMesh);
}
const explosion = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
explosion.visible = false; scene.add(explosion); let explodeT = 0;

function dropBomb(from) {
  if (bomb.carrier !== from) return;
  if (isClient()) { if (from === player) netSend({ t: 'drop' }, net.hostId); return; }
  bomb.carrier = null; bomb.state = 'dropped';
  bomb.pos.set(from.pos.x, floorHeight(from.pos.x, from.pos.z), from.pos.z);
  if (from.isPlayer) { const f = viewDir(player.yaw, 0); const nx = bomb.pos.x + f.x * 60, nz = bomb.pos.z + f.z * 60; if (cellAt(nx, nz)?.walk) bomb.pos.set(nx, floorHeight(nx, nz), nz); if (player.weapon === 'c4') switchWeapon(player.primary || player.secondary || 'knife'); }
  bombMesh.position.copy(bomb.pos); bombMesh.visible = true;
  // nearest living T bot goes to fetch it
  const ts = bots.filter(b => b.active && b.alive && b.team === 'T');
  ts.sort((a, b) => a.pos.distanceTo(bomb.pos) - b.pos.distanceTo(bomb.pos));
  bomb.fetcher = player.team === 'T' && player.alive ? (ts[0] && ts[0].pos.distanceTo(bomb.pos) < player.pos.distanceTo(bomb.pos) * 0.6 ? ts[0] : null) : ts[0] || null;
  if (bomb.fetcher) bomb.fetcher.path = [];
  if (player.team === 'T') teamMsg('The bomb has been dropped!');
}
function pickupBomb(e) {
  if (bomb.state !== 'dropped') return;
  bomb.state = 'carried'; bomb.carrier = e; bomb.fetcher = null; bombMesh.visible = false;
  if (e.isPlayer) { cprint('You picked up the bomb!'); updateHUD(true); }
  else { e.goals = [pick(SITE_SPOTS)]; e.path = []; }
}
function plantBomb(e) {
  if (isClient()) { if (e === player) { netSend({ t: 'plant', x: e.pos.x, y: floorHeight(e.pos.x, e.pos.z), z: e.pos.z }, net.hostId); player.plantT = 0; } return; }
  if (isHost()) netSend({ t: 'bomb', k: 'planted' });
  bomb.state = 'planted'; bomb.carrier = null; bomb.planter = e; bomb.timer = rules.c4timer; bomb.beepT = 0; bomb.defuser = null;
  bomb.pos.set(e.pos.x, floorHeight(e.pos.x, e.pos.z), e.pos.z);
  bombMesh.position.copy(bomb.pos); bombMesh.visible = true;
  e.plantT = 0;
  if (e.isPlayer) { player.plantT = 0; addMoney(300); switchWeapon(player.primary || player.secondary || 'knife'); }
  showCenter('The bomb has been planted!', ''); setTimeout(() => game.phase === 'live' && showCenter('', ''), 2500);
  radio('Bomb has been planted.'); SFX.plant();
  for (const b of bots) if (b.active && b.alive) { b.path = []; b.goals = []; b.guarding = false; b.headingTo = null; }
  killFeedMsg(`${e.name} planted the bomb`);
}
function defuseBomb(e) {
  if (isClient()) { if (e === player) { netSend({ t: 'defuse' }, net.hostId); player.defuseT = 0; } return; }
  bomb.state = 'defused'; bomb.defuser = null; e.defuseT = 0;
  if (e.isPlayer) { player.defuseT = 0; addMoney(300); }
  killFeedMsg(`${e.name} defused the bomb`);
  endRound('CT', 'defuse');
}
function updateBomb(dt) {
  if (isClient()) return clientBombFx(dt);
  if (explodeT > 0) {
    explodeT -= dt; const k = 1 - explodeT / 1.6;
    explosion.scale.setScalar(200 + k * 2600); explosion.material.opacity = Math.max(0, 1 - k * 1.1);
    if (explodeT <= 0) explosion.visible = false;
  }
  if (bomb.state !== 'planted') {
    if (bomb.state === 'dropped' && player.alive && player.team === 'T' && player.pos.distanceTo(bomb.pos) < 56) pickupBomb(player);
    for (const h of bots) if (bomb.state === 'dropped' && h.human && h.alive && h.team === 'T' && h.pos.distanceTo(bomb.pos) < 56) pickupBomb(h);
    if (bomb.state === 'dropped' && (!bomb.fetcher || !bomb.fetcher.alive)) {
      const ts = bots.filter(b => b.active && b.alive && b.team === 'T').sort((a, b) => a.pos.distanceTo(bomb.pos) - b.pos.distanceTo(bomb.pos));
      bomb.fetcher = player.team === 'T' && player.alive ? null : ts[0] || null;
    }
    return;
  }
  if (bomb.defuser && (!bomb.defuser.alive || (bomb.defuser.defuseT <= 0))) bomb.defuser = null;
  bomb.timer -= dt; bomb.beepT -= dt;
  const k = clamp(bomb.timer / rules.c4timer, 0, 1);
  bombMesh.led.visible = bomb.beepT > (0.08 + k * 0.9) - 0.08;
  if (bomb.beepT <= 0) {
    bomb.beepT = 0.08 + k * 0.9;
    const d = bomb.pos.distanceTo(player.alive ? player.pos : camera.position);
    SFX.beep(0.35 / (1 + d / 900));
  }
  if (bomb.timer <= 0) {
    bomb.state = 'exploded'; bombMesh.visible = false;
    if (isHost()) netSend({ t: 'bomb', k: 'boom', x: r1(bomb.pos.x), y: r1(bomb.pos.y), z: r1(bomb.pos.z) });
    explosion.position.copy(bomb.pos).add(new THREE.Vector3(0, 60, 0)); explosion.visible = true; explodeT = 1.6;
    SFX.explode(); shake = 1.2;
    for (const e of entities()) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(bomb.pos), dmg = d < 500 ? 500 : Math.max(0, 500 * (1 - (d - 500) / 1250));
      if (dmg <= 0) continue;
      if (e.isPlayer) { const g = cheats.god; damagePlayer(dmg, null, false, 'C4'); cheats.god = g; } else damageBot(e, dmg, false, 'C4', null);
    }
    endRound('T', 'bomb');
  }
}

function clientBombFx(dt) {
  if (explodeT > 0) {
    explodeT -= dt; const k = 1 - explodeT / 1.6;
    explosion.scale.setScalar(200 + k * 2600); explosion.material.opacity = Math.max(0, 1 - k * 1.1);
    if (explodeT <= 0) explosion.visible = false;
  }
  if (bomb.state !== 'planted') return;
  bomb.timer -= dt; bomb.beepT -= dt;
  const k = clamp(bomb.timer / rules.c4timer, 0, 1);
  bombMesh.led.visible = bomb.beepT > (0.08 + k * 0.9) - 0.08;
  if (bomb.beepT <= 0) { bomb.beepT = 0.08 + k * 0.9; SFX.beep(0.35 / (1 + bomb.pos.distanceTo(player.alive ? player.pos : camera.position) / 900)); }
}

/* ============================================================
   DAMAGE + MONEY + KILL FEED
   ============================================================ */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tcls = t => t === 'CT' ? 'ct' : 'tt';
function addMoney(n) {
  const p = player, before = p.money;
  p.money = clamp(Math.round(p.money + n), 0, 16000);
  const d = p.money - before;
  if (d) {
    hud.mDelta.textContent = (d > 0 ? '+' : '−') + Math.abs(d);
    hud.mDelta.className = 'show ' + (d > 0 ? 'plus' : 'minus');
    clearTimeout(addMoney.t); addMoney.t = setTimeout(() => hud.mDelta.className = '', 1600);
  }
  updateHUD(true);
}
function killFeed(att, vic, weapon, hs) {
  if (!vic) return;
  if (WEAPONS[weapon]) weapon = WEAPONS[weapon].name;
  if (isHost()) netSend({ t: 'kill', a: netIdOf(att), v: netIdOf(vic), w: weapon, hs: !!hs });
  const d = document.createElement('div'); if (att === player || vic === player) d.className = 'me';
  const a = att && att !== vic ? `<span class="${tcls(att.team)}">${esc(att.name)}</span>` : '';
  d.innerHTML = `${a}<span class="w">${esc(weapon)}</span>${hs ? '<span class="hs">⌖</span>' : ''}<span class="${tcls(vic.team)}" style="margin-left:6px">${esc(vic.name)}</span>`;
  hud.feed.appendChild(d); setTimeout(() => d.remove(), 6000);
  while (hud.feed.children.length > 6) hud.feed.firstChild.remove();
  conPrint(`${att && att !== vic ? att.name + ' killed ' + vic.name : vic.name + ' died'} with ${weapon}${hs ? ' (headshot)' : ''}`, 'dim');
}
function killFeedMsg(text) { if (isHost()) netSend({ t: 'msg', s: text }); const d = document.createElement('div'); d.innerHTML = `<span class="w">${esc(text)}</span>`; hud.feed.appendChild(d); setTimeout(() => d.remove(), 5000); conPrint(text, 'dim'); }
function teamMsg(text) { cprint(text); }
function damageBot(b, dmg, head, weapon, attacker) {
  if (!b.alive) return;
  if (isClient()) {
    if (attacker === player) { netSend({ t: 'hit', id: b.idx, dmg: +dmg.toFixed(1), hs: !!head, w: weapon }, net.hostId); if (head) SFX.headshot(); else SFX.hit(); b.spotT = 1; }
    return;
  }
  if (b.human) {
    if (isHost()) netTo(b, { t: 'dmg', d: +dmg.toFixed(1), hs: !!head, f: netIdOf(attacker), w: weapon });
    if (attacker === player) { if (head) SFX.headshot(); else SFX.hit(); b.spotT = 1; }
    return;
  }
  b.hp -= dmg; b.alertT = 3;
  if (attacker) { b.lastKnown = attacker.pos.clone(); if (!b.target) b.turnTo(Math.atan2(-(attacker.pos.x - b.pos.x), -(attacker.pos.z - b.pos.z)), 100, 1); }
  if (attacker === player) { if (head) SFX.headshot(); else SFX.hit(); b.spotT = 1; }
  if (b.hp <= 0) {
    b.alive = false; b.deathT = 0; b.m.flash.visible = false; b.deaths++; b.plantT = 0; b.defuseT = 0;
    if (bomb.carrier === b) dropBomb(b);
    if (attacker && attacker !== b) { attacker.kills++; if (attacker === player) addMoney(300); else if (attacker.human) netTo(attacker, { t: 'money', n: 300 }); }
    killFeed(attacker, b, weapon, head);
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
  p.punch += 1.5 * DEG;
  if (p.hp <= 0) killPlayer(from, hs, weapon);
  updateHUD(true);
}
function killPlayer(from, hs, weapon, quiet) {
  const p = player; if (!p.alive) return;
  p.alive = false; p.hp = 0; p.deathT = 0; p.zoom = 0; p.plantT = 0; p.defuseT = 0; p.spec = -1;
  if (isClient()) { showVM(null); if (!quiet) { p.deaths++; netSend({ t: 'died', by: netIdOf(from), hs: !!hs, w: weapon }, net.hostId); } updateHUD(true); return; }
  if (!quiet) p.deaths++;
  if (bomb.carrier === p) dropBomb(p);
  showVM(null);
  if (from) { from.kills++; if (from.human) netTo(from, { t: 'money', n: 300 }); }
  if (!quiet) killFeed(from, p, weapon, hs);
}

/* ============================================================
   ROUNDS
   ============================================================ */
const game = { ct: 0, t: 0, phase: 'live', time: 115, freeze: 0, endT: 0, roundStart: 0, restartAt: -1, wasPlanted: false };
function defaultLoadout() {
  const p = player;
  p.primary = null; p.secondary = null; p.ammo = {}; p.armor = 0; p.helmet = false; p.kit = false;
  giveWeapon(p.team === 'CT' ? 'usp' : 'glock', false); p.weapon = p.secondary;
}
function startRound() {
  const p = player;
  if (p.pendingTeam) { p.team = p.pendingTeam; p.pendingTeam = null; p.alive = false; for (const k in VM) VM[k].g.visible = false; }
  if (!p.alive || !p.secondary) defaultLoadout();
  const [r, c] = pick(p.team === 'CT' ? CT_SPAWNS : T_SPAWNS); const s = cellCenter(r, c);
  p.pos.set(s.x + (rand() - .5) * 30, cellInfo[r][c].h + EPS, s.z + (rand() - .5) * 30); p.prev.copy(p.pos);
  p.vel.set(0, 0, 0); p.yaw = p.team === 'CT' ? Math.PI : 0; p.pitch = 0; p.hp = 100; p.alive = true; p.duck = false; p.eyeOff = EYE_STAND; p.onGround = false;
  p.punch = p.punchYaw = 0; p.reloading = 0; p.shots = 0; p.drawT = 0.3; p.zoom = 0; p.rezoomAt = -1; p.plantT = 0; p.defuseT = 0;
  if (!WEAPONS[p.weapon] || p.weapon === 'c4' || (p.weapon !== 'knife' && !p.ammo[p.weapon])) p.weapon = p.primary || p.secondary;
  showVM(p.weapon);
  // teams: N per side; humans (you + remote players) take slots, bots fill the rest
  const N = settings.teamSize, hs = humans();
  for (const h of hs) if (h.pendingTeam) { h.team = h.pendingTeam; h.pendingTeam = null; }
  const humanCount = team => hs.filter(h => h.team === team).length + (p.team === team ? 1 : 0);
  const need = { CT: Math.max(0, N - humanCount('CT')), T: Math.max(0, N - humanCount('T')) };
  const spawns = { CT: [...CT_SPAWNS].sort(() => rand() - .5), T: [...T_SPAWNS].sort(() => rand() - .5) };
  const used = { CT: 1, T: 1 };
  for (const h of hs) {
    const sp = spawns[h.team][used[h.team]++ % spawns[h.team].length];
    h.spawn(h.team, h.name, sp[0], sp[1]); h.waiting = false; h.human = true;
    h.netPos = h.pos.clone(); h.netYaw = h.yaw;
    netTo(h, { t: 'round', team: h.team, x: h.pos.x, y: h.pos.y, z: h.pos.z, yaw: h.yaw, freeze: rules.freezetime });
  }
  const free = bots.slice(0, ID_HOST).filter(b => !b.human);
  let bi = 0;
  for (const team of ['CT', 'T']) for (let k = 0; k < need[team]; k++) {
    const b = free[bi++]; if (!b) break;
    const sp = spawns[team][used[team]++ % spawns[team].length];
    b.spawn(team, BOT_NAMES[team][k % BOT_NAMES[team].length], sp[0], sp[1]); b.guarding = false; b.headingTo = null;
  }
  for (; bi < free.length; bi++) { const b = free[bi]; b.active = b.alive = false; for (const k in b.meshes) b.meshes[k].g.visible = false; }
  // bomb goes to a random terrorist
  const ts = entities().filter(e => e.team === 'T' && e.alive);
  Object.assign(bomb, { state: ts.length ? 'carried' : 'none', carrier: ts.length ? pick(ts) : null, timer: 0, fetcher: null, defuser: null });
  bombMesh.visible = false; explosion.visible = false;
  if (bomb.carrier === p) cprint('You have the bomb! Plant it at bombsite A (hold E, or select it with 5 and hold fire).');
  for (const h of holes) h.visible = false;
  game.phase = 'live'; game.time = rules.roundtime * 60; game.freeze = rules.freezetime; game.roundStart = simTime; game.wasPlanted = false;
  showCenter('', '');
  if (game.freeze <= 0) radio('Go go go!');
  updateHUD(true);
}
function newGame(team) {
  if (isClient()) return;
  if (isHost()) netSend({ t: 'restart' });
  if (team) { player.team = team; player.pendingTeam = null; }
  game.ct = game.t = 0; player.kills = player.deaths = 0; player.lossStreak = 0; player.money = rules.startmoney;
  for (const b of bots) b.kills = b.deaths = 0;
  player.alive = false; player.secondary = null; startRound();
  conPrint(`New game. You joined the ${player.team === 'CT' ? 'Counter-Terrorists' : 'Terrorists'}. Buy during freeze time with B.`, 'dim');
}
const REASONS = { elim: null, bomb: 'Target Bombed', defuse: 'Bomb Defused', time: 'Target has been saved!' };
function endRound(winner, reason) {
  if (game.phase !== 'live') return;
  game.phase = 'end'; game.endT = 5;
  if (winner === 'CT') game.ct++; else game.t++;
  if (isHost()) netSend({ t: 'roundend', w: winner, r: reason, p: game.wasPlanted });
  roundEndLocal(winner, reason, game.wasPlanted);
}
function roundEndLocal(winner, reason, planted) {
  const won = player.team === winner;
  if (won) { addMoney(reason === 'bomb' || reason === 'defuse' ? 3500 : 3250); player.lossStreak = 0; }
  else { addMoney(1400 + 500 * Math.min(player.lossStreak, 4) + (player.team === 'T' && planted ? 800 : 0)); player.lossStreak++; }
  const title = winner === 'CT' ? 'Counter-Terrorists Win!' : 'Terrorists Win!';
  showCenter(REASONS[reason] ? `${REASONS[reason]}<br>${title}` : title, '');
  radio(reason === 'bomb' ? 'Terrorists win.' : reason === 'defuse' ? 'Bomb has been defused. Counter-terrorists win.' : winner === 'CT' ? 'Counter-terrorists win.' : 'Terrorists win.');
  player.plantT = player.defuseT = 0;
  updateHUD(true);
}
function updateRound(dt) {
  if (isClient()) return;
  if (game.restartAt > 0 && simTime >= game.restartAt) { game.restartAt = -1; newGame(); return; }
  if (game.freeze > 0) { game.freeze -= dt; if (game.freeze <= 0) radio('Go go go!'); return; }
  if (game.phase === 'live') {
    if (bomb.state === 'planted') game.wasPlanted = true;
    else game.time -= dt;
    const t = teamAlive('T'), ct = teamAlive('CT');
    if (ct === 0) endRound('T', 'elim');
    else if (bomb.state !== 'planted' && t === 0) endRound('CT', 'elim');
    else if (bomb.state !== 'planted' && game.time <= 0) endRound('CT', 'time');
  } else {
    game.endT -= dt;
    if (game.endT <= 0) startRound();
  }
}
function inBuyZone() { return inRect(Math.floor(player.pos.z / CELL), Math.floor(player.pos.x / CELL), BUYZONE[player.team]); }
const buyTimeLeft = () => rules.freezetime + rules.buytime - (simTime - game.roundStart);
function canBuy(silent) {
  const msg = !player.alive ? 'You can\'t buy while dead.' : !inBuyZone() ? 'You are not in a buy zone.' : buyTimeLeft() <= 0 ? `${Math.round(rules.buytime)} seconds have passed.\nYou can't buy anything now!` : null;
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
    if (e.team && e.team !== p.team) return deny('This item is not available to your team.');
    if (id === 'defuser') { if (p.kit) return deny('You already have a defuse kit!'); if (p.money < e.price) return deny('You have insufficient funds!'); p.kit = true; addMoney(-e.price); SFX.buy(); return true; }
    if (p.armor >= 100 && (id === 'vest' || p.helmet)) return deny('You already have kevlar!');
    let price = e.price; if (id === 'vesthelm' && p.armor >= 100) price = 350;
    if (p.money < price) return deny('You have insufficient funds!');
    p.armor = 100; if (id === 'vesthelm') p.helmet = true; addMoney(-price); SFX.buy(); return true;
  }
  const w = WEAPONS[id];
  if (!w || w.melee || w.c4) return deny(`Unknown item "${id}".`);
  if (w.team && w.team !== p.team && !cheats.enabled) return deny('This item is not available to your team.');
  if (p.primary === id || p.secondary === id) return deny('You already have one!');
  if (p.money < w.price) return deny('You have insufficient funds!');
  addMoney(-w.price); giveWeapon(id); SFX.buy(); return true;
}
function chooseTeam(team) {
  if (team === 'auto' && !net.pendingJoin && !isClient()) team = isHost() ? pickTeam('auto') : teamAlive('CT') <= teamAlive('T') ? 'CT' : 'T';
  closeTeamMenu();
  if (net.pendingJoin) {
    const sv = net.pendingJoin; net.pendingJoin = null; net.joining = true;
    joinServer(sv.code, sv.host, net.kind, team).catch(e => alertBox('Could not join: ' + e.message)).finally(() => { net.joining = false; updateNetMenu(); });
    started = true; lockPointer(); return;
  }
  if (isClient()) { netSend({ t: 'team', team }, net.hostId); lockPointer(); return; }
  if (!started || pendingNew) { pendingNewTeam = team; lockPointer(); return; }
  if (team !== player.team) {
    player.pendingTeam = team;
    if (player.alive && game.phase === 'live') killPlayer(null, false, 'world', true);
    conPrint(`You will join the ${team === 'CT' ? 'Counter-Terrorists' : 'Terrorists'} next round.`, 'dim');
  }
  lockPointer();
}

/* ============================================================
   HUD
   ============================================================ */
const hud = {
  hp: $('hpVal'), hpBox: $('hp'), ap: $('apVal'), speed: $('speedVal'), speedBox: $('speed'), mag: $('magVal'), res: $('resVal'), ammoBox: $('ammo'), wname: $('wname'),
  timer: $('timerVal'), timerBox: $('timer'), ct: $('ctScore'), t: $('tScore'), feed: $('feed'), center: $('center'), cprint: $('cprint'), dmg: $('dmg'),
  money: $('moneyVal'), mDelta: $('moneyDelta'), buyicon: $('buyicon'), scope: $('scope'), xh: $('xh'), fps: $('fps'), bombicon: $('bombicon'), kiticon: $('kiticon'),
  prog: $('prog'), progBar: $('progBar'), progLabel: $('progLabel'), spec: $('spec'), team: $('teamtag'),
  radar: $('radar').getContext('2d'), score: $('scoreboard'),
};
let dmgFlash = 0, crossGap = 0;
function showCenter(title, sub) { hud.center.innerHTML = title ? `${title}${sub ? `<br><small>${sub}</small>` : ''}` : ''; hud.center.classList.toggle('show', !!title); }
function cprint(msg) {
  hud.cprint.innerHTML = esc(msg).replace(/\n/g, '<br>'); hud.cprint.classList.add('show');
  clearTimeout(cprint.t); cprint.t = setTimeout(() => hud.cprint.classList.remove('show'), 2600);
}
let lastHudTxt = '';
function updateHUD(force) {
  const p = player, w = curW() || WEAPONS.knife;
  const t = Math.max(0, Math.ceil(game.freeze > 0 ? game.freeze : game.time));
  const sp = Math.round(hspeed());
  const am = w.melee || w.c4 ? null : p.ammo[p.weapon];
  const txt = [p.hp, p.armor, sp, am?.mag, am?.res, t, game.ct, game.t, p.weapon, p.money, bomb.state, bomb.carrier === p, p.kit, p.team, p.alive].join();
  if (txt === lastHudTxt && !force) return; lastHudTxt = txt;
  hud.hp.textContent = p.hp; hud.hpBox.classList.toggle('low', p.hp <= 25);
  hud.ap.textContent = p.armor;
  hud.speed.textContent = sp; hud.speedBox.className = sp > 450 ? 'vfast' : sp > 280 ? 'fast' : '';
  hud.ammoBox.classList.toggle('hidden', !am);
  if (am) { hud.mag.textContent = am.mag; hud.res.textContent = am.res; hud.ammoBox.classList.toggle('low', am.mag <= Math.ceil(w.mag * 0.2)); }
  hud.wname.textContent = w.name;
  const planted = bomb.state === 'planted';
  hud.timer.textContent = planted ? '' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  hud.timerBox.classList.toggle('low', planted || (game.freeze <= 0 && t <= 15));
  hud.timerBox.classList.toggle('planted', planted);
  hud.ct.textContent = game.ct; hud.t.textContent = game.t;
  hud.money.textContent = p.money;
  hud.bombicon.classList.toggle('hidden', !(bomb.carrier === p));
  hud.kiticon.classList.toggle('hidden', !(p.kit && p.team === 'CT'));
  hud.team.textContent = p.team === 'CT' ? 'Counter-Terrorist' : 'Terrorist'; hud.team.className = tcls(p.team);
}
function updateCrosshair(dt) {
  const w = curW() || WEAPONS.knife, p = player;
  const scoped = p.zoom > 0 && w.scope;
  hud.scope.classList.toggle('hidden', !(scoped && w.sniper));
  const show = p.alive && !(w.sniper && !p.zoom) && !(scoped && w.sniper);
  hud.xh.classList.toggle('hidden', !show);
  if (!show) return;
  const target = settings.xh.style === 0 ? currentSpread() * 500 + (p.shots > 0 && simTime - p.nextFire < 0.1 ? 3 : 0) : 0;
  crossGap += (target - crossGap) * Math.min(1, dt * 14);
  drawCrosshair(hud.xh, settings.xh, crossGap);
}

/* ---------- radar ---------- */
const RPX = 5;
const radarMap = document.createElement('canvas'); radarMap.width = MW * RPX; radarMap.height = MH * RPX;
{
  const g = radarMap.getContext('2d');
  for (let r = 0; r < MH; r++) for (let c = 0; c < MW; c++) {
    const i = cellInfo[r][c]; if (i.ch === '#') continue;
    g.fillStyle = i.ch === 't' || i.ch === 'u' ? 'rgba(120,140,110,.6)' : i.h > 0 || i.stair ? 'rgba(175,195,155,.65)' : 'rgba(150,170,130,.55)';
    g.fillRect(c * RPX, r * RPX, RPX, RPX);
  }
  g.strokeStyle = 'rgba(255,80,60,.8)'; g.strokeRect(SITE[1] * RPX, SITE[0] * RPX, (SITE[3] - SITE[1] + 1) * RPX, (SITE[2] - SITE[0] + 1) * RPX);
  g.fillStyle = 'rgba(255,80,60,.95)'; g.font = 'bold 14px Tahoma'; g.fillText('A', 24 * RPX, 6.6 * RPX);
}
function drawRadar() {
  const g = hud.radar, S = 170, C = S / 2, k = RPX / CELL;
  const center = player.alive ? player : specTarget() || player;
  const yaw = center.isPlayer ? player.yaw : center.yaw;
  g.clearRect(0, 0, S, S);
  g.save(); g.beginPath(); g.arc(C, C, C - 2, 0, 7); g.fillStyle = 'rgba(30,40,25,.55)'; g.fill(); g.clip();
  g.translate(C, C); g.rotate(yaw); g.translate(-center.pos.x * k, -center.pos.z * k);
  g.drawImage(radarMap, 0, 0);
  const dot = (x, z, col, r = 3.2) => { g.fillStyle = col; g.beginPath(); g.arc(x * k, z * k, r, 0, 7); g.fill(); };
  for (const b of bots) {
    if (!b.active) continue;
    const mate = b.team === player.team;
    if (!b.alive) { if (mate || b.spotT > -3) { g.save(); g.translate(b.pos.x * k, b.pos.z * k); g.rotate(-yaw); g.fillStyle = mate ? 'rgba(140,190,255,.45)' : 'rgba(255,60,60,.45)'; g.fillRect(-3, -0.8, 6, 1.6); g.fillRect(-0.8, -3, 1.6, 6); g.restore(); } continue; }
    if (mate) dot(b.pos.x, b.pos.z, player.team === 'CT' ? '#7ab8ff' : '#ffb04a');
    else if (b.spotT > 0) dot(b.pos.x, b.pos.z, '#ff3030');
  }
  if (!center.isPlayer && player.alive === false) dot(player.pos.x, player.pos.z, 'rgba(255,255,255,.3)', 2);
  if (bomb.state === 'planted' || bomb.state === 'dropped' && player.team === 'T') {
    if (bomb.state !== 'planted' || Math.floor(simTime * 3) % 2) { g.fillStyle = bomb.state === 'planted' ? '#ff2a2a' : '#ffb000'; g.fillRect(bomb.pos.x * k - 3.5, bomb.pos.z * k - 3.5, 7, 7); }
  } else if (bomb.carrier && !bomb.carrier.isPlayer && player.team === 'T') { g.strokeStyle = '#ffb000'; g.lineWidth = 2; g.strokeRect(bomb.carrier.pos.x * k - 5, bomb.carrier.pos.z * k - 5, 10, 10); g.lineWidth = 1; }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(C, C); g.lineTo(C - 60, C - 60); g.moveTo(C, C); g.lineTo(C + 60, C - 60); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(C, C, 3, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,160,0,.5)'; g.lineWidth = 1.5; g.beginPath(); g.arc(C, C, C - 2, 0, 7); g.stroke(); g.lineWidth = 1;
}

/* ---------- scoreboard ---------- */
function renderScoreboard() {
  const row = e => `<tr class="${e.alive ? '' : 'dead'} ${e.isPlayer ? 'me' : ''}"><td>${esc(e.name)}${e.alive ? '' : ' <small>DEAD</small>'}${bomb.carrier === e && e.team === player.team ? ' <small>BOMB</small>' : ''}</td><td class="num">${e.kills}</td><td class="num">${e.deaths}</td><td class="num">${e.isPlayer || e.human ? (e.isPlayer && !online() ? 5 : 'PLAYER') : 'BOT'}</td></tr>`;
  const table = (team, title, score) => {
    const list = entities().filter(e => e.team === team).sort((a, b) => b.kills - a.kills);
    return `<table class="${tcls(team)}"><tr><th>${title} — ${list.length} player${list.length === 1 ? '' : 's'}</th><th class="num">${score}</th><th class="num">Deaths</th><th class="num">Latency</th></tr>${list.map(row).join('')}</table>`;
  };
  hud.score.innerHTML = `<h2><span>${online() ? esc(net.name) + ' · ' : 'STRAFE 1.6 · '}de_dunes</span><span>Round ${game.ct + game.t + 1}</span></h2>` + table('CT', 'Counter-Terrorists', game.ct) + table('T', 'Terrorists', game.t);
}

/* ---------- spectating ---------- */
function specTarget() {
  const mates = bots.filter(b => b.active && b.alive && b.team === player.team);
  if (!mates.length) return null;
  if (player.spec < 0 || player.spec >= mates.length) player.spec = 0;
  return mates[player.spec];
}

/* ============================================================
   BUY MENU
   ============================================================ */
const bm = { el: $('buymenu'), list: $('bmList'), pic: $('bmPic'), stats: $('bmStats'), money: $('bmMoney'), open: false, page: -1, items: [] };
function openBuyMenu() { if (!canBuy()) return; bm.open = true; bm.page = -1; bm.el.classList.remove('hidden'); renderBuyMenu(); }
function closeBuyMenu() { bm.open = false; bm.el.classList.add('hidden'); }
function itemInfo(id) {
  const w = WEAPONS[id], e = EQUIP[id];
  if (e) return { name: e.name, price: e.price, stats: id === 'vest' ? 'Body armor.\nAbsorbs about half of body damage.' : id === 'vesthelm' ? 'Body armor + helmet.\nHelmet protects against headshots.' : 'Halves bomb defuse time\n(10 s -> 5 s).' };
  return {
    name: w.name, price: w.price,
    stats: `Price        $${w.price}\nDamage       ${w.dmg}${w.pellets ? ' x ' + w.pellets : ''}\nRate of fire ${Math.round(60 / w.rate)} rpm\nMagazine     ${w.mag} / ${w.res}\nMove speed   ${w.speed}${w.scope ? '\nScope        ' + w.scope.length + ' zoom level' + (w.scope.length > 1 ? 's' : '') : ''}\nFire mode    ${w.auto ? 'automatic' : 'semi-automatic'}${w.pat ? '\nRecoil       learnable spray pattern' : ''}`,
  };
}
function bmShow(id) { if (!id) { bm.pic.getContext('2d').clearRect(0, 0, 300, 120); bm.stats.textContent = ''; return; } drawGunPic(bm.pic, id); bm.stats.textContent = itemInfo(id).stats; }
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
    bm.items = teamItems(BUY_MENU[bm.page], player.team);
    bm.items.forEach((id, i) => { const inf = itemInfo(id); add(i + 1, inf.name, inf.price, player.money < inf.price, () => bmKey(i + 1), id); });
    add(0, 'Back', null, false, () => bmKey(0));
    bmShow(bm.items[0]);
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
    const id = bm.items[n - 1]; if (!id) return;
    if (buy(id)) closeBuyMenu(); else renderBuyMenu();
  }
}

/* ============================================================
   CONSOLE
   ============================================================ */
const con = { el: $('console'), out: $('conOut'), input: $('conIn'), sug: $('conSug'), history: [], hi: -1 };
function conPrint(text, cls) {
  const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text;
  con.out.appendChild(d);
  while (con.out.children.length > 400) con.out.firstChild.remove();
  con.out.scrollTop = con.out.scrollHeight;
}
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const xhVar = (key, lo, hi, desc) => ({ get: () => settings.xh[key], set: v => { settings.xh[key] = clamp(num(v, XH_DEFAULT[key]), lo, hi); syncXhEditor(); }, desc });
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
  sv_cheats: { get: () => +cheats.enabled, set: v => { cheats.enabled = num(v, 0) !== 0; if (!cheats.enabled) cheats.god = cheats.noclip = false; }, desc: 'Allow cheat commands (god, noclip, give, impulse 101)' },
  bot_quota: { get: () => settings.teamSize, set: v => settings.teamSize = clamp(Math.round(num(v, 5)), 1, 5), desc: 'Players per team, 1-5 (applies next round)' },
  bot_difficulty: { get: () => ['easy', 'normal', 'hard'].indexOf(settings.diff), set: v => settings.diff = ['easy', 'normal', 'hard'][clamp(Math.round(num(v, 1)), 0, 2)], desc: '0 easy, 1 normal, 2 hard' },
  bot_stop: { get: () => +botStop, set: v => botStop = num(v, 0) !== 0, desc: '1 = bots stand still and hold fire' },
  mp_roundtime: { get: () => rules.roundtime, set: v => rules.roundtime = clamp(num(v, 1.92), 0.5, 15), desc: 'Round time in minutes' },
  mp_freezetime: { get: () => rules.freezetime, set: v => rules.freezetime = clamp(num(v, 15), 0, 60), desc: 'Freeze time in seconds (you can buy during it)' },
  mp_buytime: { get: () => rules.buytime, set: v => rules.buytime = clamp(num(v, 20), 0, 600), desc: 'Seconds you can still buy after freeze time' },
  mp_startmoney: { get: () => rules.startmoney, set: v => rules.startmoney = clamp(Math.round(num(v, 800)), 0, 16000), desc: 'Starting money' },
  mp_c4timer: { get: () => rules.c4timer, set: v => rules.c4timer = clamp(num(v, 40), 10, 90), desc: 'Bomb timer in seconds' },
  cl_showfps: { get: () => +settings.showfps, set: v => settings.showfps = num(v, 0) !== 0 },
  cl_showpos: { get: () => +settings.showpos, set: v => settings.showpos = num(v, 0) !== 0 },
  cl_radio: { get: () => +settings.radio, set: v => settings.radio = num(v, 1) !== 0, desc: 'Radio voice announcements' },
  cl_crosshairstyle: xhVar('style', 0, 1, '0 dynamic, 1 static'),
  cl_crosshairsize: xhVar('size', 0, 20, 'Length of the lines'),
  cl_crosshairgap: xhVar('gap', -5, 20, 'Gap from the centre'),
  cl_crosshairthickness: xhVar('thick', 0.5, 8, 'Line thickness'),
  cl_crosshairdot: xhVar('dot', 0, 1, 'Centre dot'),
  cl_crosshair_t: xhVar('t', 0, 1, 'T-style (no top line)'),
  cl_crosshaircircle: xhVar('circle', 0, 1, 'Ring around the centre'),
  cl_crosshair_drawoutline: xhVar('outline', 0, 1, 'Black outline'),
  cl_crosshair_outlinethickness: xhVar('outlineThick', 0.5, 3),
  cl_crosshaircolor_r: xhVar('r', 0, 255), cl_crosshaircolor_g: xhVar('g', 0, 255), cl_crosshaircolor_b: xhVar('b', 0, 255),
  cl_crosshairalpha: xhVar('a', 0, 255),
};
const needCheats = () => { if (isClient()) { conPrint('Cheats are controlled by the server host.', 'err'); return true; } if (!cheats.enabled) { conPrint('Can\'t use cheat command in multiplayer, unless the server has sv_cheats set to 1.', 'err'); return true; } return false; };
const COMMANDS = {
  help: () => { conPrint('Type a command or cvar name. Tab completes, ↑/↓ browse history.'); conPrint('Useful: cmdlist, cvarlist, jointeam 1|2, buy <item>, bot_quota 1-5, mp_restartgame 1, crosshair, sv_cheats 1, noclip, god, impulse 101, give <weapon>, kill, clear'); },
  cmdlist: () => conPrint(Object.keys(COMMANDS).sort().join('  ')),
  cvarlist: () => { for (const k of Object.keys(CVARS).sort()) { const c = CVARS[k]; if (c.alias) continue; conPrint(`${k.padEnd(30)} = "${c.get()}"${c.desc ? '   ' + c.desc : ''}`); } },
  clear: () => { con.out.innerHTML = ''; },
  echo: a => conPrint(a.join(' ')),
  version: () => conPrint('STRAFE 1.6 build 2026 (browser), map de_dunes'),
  status: () => {
    conPrint(`map     : de_dunes   round: ${game.ct + game.t + 1}   CT ${game.ct} - ${game.t} T   bomb: ${bomb.state}`);
    for (const e of entities()) conPrint(`# ${e.isPlayer ? '' : 'BOT '}${e.name}  ${e.team}  kills ${e.kills}  deaths ${e.deaths}  ${e.alive ? 'alive' : 'dead'}${e.isPlayer ? '  $' + e.money : '  (' + e.gun + ')'}`);
  },
  buy: a => { if (!a[0]) return conPrint('Usage: buy <item>   items: ' + [...Object.keys(WEAPONS).filter(k => WEAPONS[k].price), ...Object.keys(EQUIP), 'pammo', 'sammo'].join(' ')); buy(a[0].toLowerCase().replace('weapon_', '')); },
  buymenu: () => { closeConsole(); openBuyMenu(); },
  chooseteam: () => { closeConsole(); openTeamMenu(); },
  jointeam: a => { const t = a[0] === '1' || /^t/i.test(a[0] || '') ? 'T' : a[0] === '2' || /^ct/i.test(a[0] || '') ? 'CT' : 'auto'; chooseTeam(t); },
  crosshair: () => { closeConsole(); openXhEditor(); },
  kill: () => { if (player.alive && game.phase === 'live') { const g = cheats.god; cheats.god = false; damagePlayer(999, null, false, 'world'); cheats.god = g; } },
  drop: () => dropBomb(player),
  god: () => { if (needCheats()) return; cheats.god = !cheats.god; conPrint(`godmode ${cheats.god ? 'ON' : 'OFF'}`); },
  noclip: () => { if (needCheats()) return; cheats.noclip = !cheats.noclip; conPrint(`noclip ${cheats.noclip ? 'ON' : 'OFF'}`); },
  impulse: a => { if (a[0] !== '101') return; if (needCheats()) return; addMoney(16000); player.armor = 100; player.helmet = true; for (const id in player.ammo) player.ammo[id].res = WEAPONS[id].res; conPrint('Gave money, armor and ammo.'); },
  give: a => {
    if (needCheats()) return; const id = ALIASES[(a[0] || '').replace('weapon_', '')] || (a[0] || '').replace('weapon_', '');
    if (id === 'item_assaultsuit' || id === 'vesthelm') { player.armor = 100; player.helmet = true; return; }
    if (!giveWeapon(id)) conPrint(`Unknown weapon "${a[0]}". Try: ${Object.keys(WEAPONS).filter(k => WEAPONS[k].price).join(' ')}`, 'err');
  },
  bot_add: () => { settings.teamSize = Math.min(5, settings.teamSize + 1); saveSettings(); conPrint(`bot_quota is now ${settings.teamSize} per team (next round).`); },
  bot_kick: () => { settings.teamSize = 1; saveSettings(); conPrint('Kicked bots: 1v1 from next round.'); },
  bot_kill: () => { bots.forEach(b => { if (b.alive && b.active) damageBot(b, 999, false, 'world', null); }); },
  mp_restartgame: a => { if (isClient()) return conPrint('Only the server host can restart the game.', 'err'); const s = Math.max(0, num(a[0], 1)); game.restartAt = simTime + s; conPrint(`Game will restart in ${s} second${s === 1 ? '' : 's'}`); cprint(`Game will restart in ${s} SECOND${s === 1 ? '' : 'S'}`); },
  restart: () => COMMANDS.mp_restartgame(['1']),
  disconnect: () => { closeConsole(); document.exitPointerLock?.(); },
  quit: () => closeConsole(), exit: () => closeConsole(),
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
      else { cv.set(args.join(' ')); saveSettings(); syncOptions(); }
      continue;
    }
    conPrint(`Unknown command: ${cmd}`, 'err');
  }
}
const ALL_NAMES = () => [...Object.keys(COMMANDS), ...Object.keys(CVARS)].sort();
function updateSuggestions() {
  const v = con.input.value.trim().toLowerCase();
  const m = v && !v.includes(' ') ? ALL_NAMES().filter(n => n.startsWith(v)).slice(0, 12) : [];
  con.sug.innerHTML = m.map(n => `<div>${n}${CVARS[n] && !CVARS[n].alias ? ' <span style="opacity:.6">' + esc(CVARS[n].get()) + '</span>' : ''}</div>`).join('');
  con.sug.classList.toggle('hidden', !m.length);
  [...con.sug.children].forEach((d, i) => d.onclick = () => { con.input.value = m[i] + ' '; con.input.focus(); updateSuggestions(); });
  return m;
}
const isConsoleKey = e => e.code === 'Backquote' || e.key === '`' || e.key === '~' || e.key === '§' || e.key === '½';
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
  else if (e.key === 'Escape') closeConsole();
});
$('conSubmit').onclick = () => { runCommand(con.input.value); con.input.value = ''; con.input.focus(); };
function openConsole() { if (document.pointerLockElement) document.exitPointerLock(); con.el.classList.remove('hidden'); setTimeout(() => con.input.focus(), 0); }
function closeConsole() { con.el.classList.add('hidden'); con.input.blur(); con.sug.classList.add('hidden'); }
function toggleConsole() { if (con.el.classList.contains('hidden')) openConsole(); else closeConsole(); }
conPrint('STRAFE 1.6 console. Type "help" for a list of useful commands.', 'dim');

/* ============================================================
   CROSSHAIR EDITOR
   ============================================================ */
const XH_COLORS = { Green: [50, 250, 50], Yellow: [255, 255, 0], Blue: [50, 120, 255], Cyan: [0, 255, 255], Red: [255, 40, 40], Pink: [255, 60, 255], White: [255, 255, 255] };
const xhPrev = $('xhPreview');
function buildXhEditor() {
  const body = $('xhBody');
  const sl = (key, label, min, max, step) => `<label>${label} <output data-o="${key}"></output><input type="range" data-xh="${key}" min="${min}" max="${max}" step="${step}"></label>`;
  const ck = (key, label) => `<label class="row check"><input type="checkbox" data-xh="${key}"> ${label}</label>`;
  body.innerHTML = `
    <div class="xh-presets">${Object.keys(XH_PRESETS).map(n => `<button data-preset="${n}">${n}</button>`).join('')}</div>
    <div class="xh-cols"><div>
      <label class="row">Style <select data-xh="style"><option value="0">Dynamic (spreads when moving/shooting)</option><option value="1">Static</option></select></label>
      ${sl('size', 'Size', 0, 15, 0.5)}${sl('gap', 'Gap', -5, 12, 0.5)}${sl('thick', 'Thickness', 0.5, 6, 0.5)}${sl('outlineThick', 'Outline thickness', 0.5, 3, 0.5)}
    </div><div>
      ${ck('outline', 'Outline')}${ck('dot', 'Centre dot')}${ck('t', 'T-style (no top line)')}${ck('circle', 'Circle')}
      <label class="row">Color <select id="xhColor">${Object.keys(XH_COLORS).map(c => `<option>${c}</option>`).join('')}<option>Custom</option></select></label>
      ${sl('r', 'Red', 0, 255, 1)}${sl('g', 'Green', 0, 255, 1)}${sl('b', 'Blue', 0, 255, 1)}${sl('a', 'Alpha', 0, 255, 1)}
    </div></div>`;
  body.querySelectorAll('[data-xh]').forEach(el => {
    const key = el.dataset.xh;
    el.oninput = el.onchange = () => { settings.xh[key] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : parseFloat(el.value); saveSettings(); syncXhEditor(); };
  });
  body.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { settings.xh = Object.assign({}, XH_PRESETS[b.dataset.preset]); saveSettings(); syncXhEditor(); });
  $('xhColor').onchange = e => { const c = XH_COLORS[e.target.value]; if (c) { [settings.xh.r, settings.xh.g, settings.xh.b] = c; saveSettings(); syncXhEditor(); } };
}
function syncXhEditor() {
  const body = $('xhBody'); if (!body.children.length) return;
  body.querySelectorAll('[data-xh]').forEach(el => { const v = settings.xh[el.dataset.xh]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; });
  body.querySelectorAll('[data-o]').forEach(o => o.textContent = settings.xh[o.dataset.o]);
  const { r, g, b } = settings.xh; $('xhColor').value = Object.keys(XH_COLORS).find(k => XH_COLORS[k].join() === [r, g, b].join()) || 'Custom';
  drawXhPreview();
}
let xhPrevT = 0;
function drawXhPreview() {
  const g = xhPrev.getContext('2d'); g.fillStyle = '#c9a670'; g.fillRect(0, 0, xhPrev.width, xhPrev.height);
  g.fillStyle = '#a88a5c'; g.fillRect(0, 0, xhPrev.width / 2, xhPrev.height); g.fillStyle = '#e8dcc0'; g.fillRect(xhPrev.width * 0.75, 0, xhPrev.width / 4, xhPrev.height);
  const tmp = document.createElement('canvas'); tmp.width = xhPrev.width; tmp.height = xhPrev.height;
  const spreadDemo = settings.xh.style === 0 ? (Math.sin(xhPrevT * 2) * 0.5 + 0.5) * 8 : 0;
  drawCrosshair(tmp, settings.xh, spreadDemo); g.drawImage(tmp, 0, 0);
  const code = `cl_crosshairstyle ${settings.xh.style}; cl_crosshairsize ${settings.xh.size}; cl_crosshairgap ${settings.xh.gap}; cl_crosshairthickness ${settings.xh.thick}; cl_crosshairdot ${settings.xh.dot}; cl_crosshair_t ${settings.xh.t}; cl_crosshaircircle ${settings.xh.circle}; cl_crosshair_drawoutline ${settings.xh.outline}; cl_crosshaircolor_r ${settings.xh.r}; cl_crosshaircolor_g ${settings.xh.g}; cl_crosshaircolor_b ${settings.xh.b}; cl_crosshairalpha ${settings.xh.a}`;
  $('xhCode').value = code;
}
function openXhEditor() { if (!$('xhBody').children.length) buildXhEditor(); syncXhEditor(); $('xhwin').classList.remove('hidden'); }
$('xhCopy').onclick = () => { $('xhCode').select(); try { navigator.clipboard.writeText($('xhCode').value); } catch {} };
$('xhApply').onclick = () => { runCommand($('xhCode').value); syncXhEditor(); };

/* ============================================================
   TEAM MENU
   ============================================================ */
const teamMenu = $('teammenu');
function openTeamMenu() { if (document.pointerLockElement) document.exitPointerLock(); teamMenu.classList.remove('hidden'); }
function closeTeamMenu() { teamMenu.classList.add('hidden'); }
teamMenu.querySelectorAll('[data-team]').forEach(b => b.onclick = () => chooseTeam(b.dataset.team));
addEventListener('keydown', e => {
  if (teamMenu.classList.contains('hidden')) return;
  if (e.code === 'Digit1') chooseTeam('T'); else if (e.code === 'Digit2') chooseTeam('CT'); else if (e.code === 'Digit5') chooseTeam('auto'); else if (e.code === 'Digit0' || e.code === 'Escape') closeTeamMenu();
});

/* ============================================================
   INPUT
   ============================================================ */
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
    if (e.code === 'Digit5') switchWeapon('c4');
    if (e.code === 'KeyB') openBuyMenu();
  }
  if (e.code === 'KeyM') openTeamMenu();
  if (e.code === 'KeyG') dropBomb(player);
  if (e.code === 'KeyQ') { const lw = player.lastWeapon; switchWeapon(lw === 'knife' || player.ammo[lw] || (lw === 'c4' && bomb.carrier === player) ? lw : 'knife'); }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Tab') { hud.score.classList.remove('hidden'); renderScoreboard(); }
  if (['Space', 'Tab', 'ControlLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') hud.score.classList.add('hidden'); });
addEventListener('wheel', e => { if (running) { player.jumpAt = simTime; e.preventDefault(); } }, { passive: false });
addEventListener('mousedown', e => {
  if (!running) return;
  if (e.button === 0) { mouseL = true; triggerUp = true; if (!player.alive) player.spec++; }
  if (e.button === 2) { mouseR = true; if (curW().scope && player.alive) toggleZoom(); }
});
addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
let swayX = 0, swayY = 0;
function zoomFov() { const w = curW(); return player.zoom && w && w.scope ? w.scope[player.zoom - 1] : settings.fov; }
addEventListener('mousemove', e => {
  if (!running || !player.alive || bm.open) return;
  const zr = player.zoom ? zoomFov() / settings.fov * 1.2 : 1;
  const k = settings.sens * zr * 0.022 * DEG;
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
  if (master) master.gain.value = settings.volume;
}
bindSetting('optName', 'name', v => v, v => v.slice(0, 24) || 'Player');
bindSetting('sens', 'sens', v => (+v).toFixed(1));
bindSetting('fov', 'fov', v => v + '°');
bindSetting('aa', 'airAccel');
bindSetting('bots', 'teamSize', v => `${v} v ${v}`, v => parseInt(v));
bindSetting('vol', 'volume', v => Math.round(v * 100) + '%', parseFloat, () => { if (master) master.gain.value = settings.volume; });
bindSetting('diff', 'diff', v => v, v => v);
bindSetting('autobhop', 'autoBhop');
bindSetting('radio', 'radio');
syncOptions();

document.querySelectorAll('[data-close]').forEach(el => el.onclick = () => { $(el.dataset.close).classList.add('hidden'); if (el.dataset.close === 'console') closeConsole(); });
let pendingNew = false, pendingNewTeam = null;
function lockPointer() {
  initAudio();
  const r = canvas.requestPointerLock?.({ unadjustedMovement: true });
  if (r && r.catch) r.catch(() => canvas.requestPointerLock()?.catch?.(() => {}));
}
$('mmNew').onclick = () => { pendingNew = true; openTeamMenu(); };
$('mmResume').onclick = () => lockPointer();
$('mmTeam').onclick = () => openTeamMenu();
$('mmOptions').onclick = () => { syncOptions(); $('options').classList.remove('hidden'); };
$('mmCrosshair').onclick = () => openXhEditor();
$('optXh').onclick = () => openXhEditor();
$('mmControls').onclick = () => $('controls').classList.remove('hidden');
$('mmConsole').onclick = () => openConsole();
canvas.addEventListener('click', () => { if (started && !running && mainmenu.classList.contains('hidden')) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  running = locked;
  mainmenu.classList.toggle('hidden', locked);
  hudEl.classList.toggle('hidden', !locked && !started);
  if (locked) {
    for (const id of ['options', 'controls', 'xhwin']) $(id).classList.add('hidden');
    closeConsole(); closeTeamMenu();
    if (pendingNewTeam) { started = true; pendingNew = false; const t = pendingNewTeam; pendingNewTeam = null; newGame(t); }
    else if (!started && !online() && !net.joining) { started = true; newGame('CT'); }
    $('mmResume').classList.remove('hidden'); $('mmTeam').classList.remove('hidden');
  } else {
    for (const k in keys) keys[k] = false; mouseL = mouseR = false; closeBuyMenu(); hud.score.classList.add('hidden');
    $('mmStats').textContent = started ? `${player.team}  ·  CT ${game.ct} – ${game.t} T  ·  Kills ${player.kills}  ·  Deaths ${player.deaths}  ·  $${player.money}` : '';
  }
});


/* ============================================================
   MULTIPLAYER
   A player's browser hosts the server: it runs the bots, rounds and
   bomb and sends snapshots. Joining players simulate their own movement
   and aim, and report hits to the host. Peers find each other through
   a "lobby" room; no game server is needed (WebRTC via Trystero).
   ============================================================ */
const NET_APP = 'strafe16-dunes-v1', ID_HOST = 20, BSTATES = ['none', 'carried', 'dropped', 'planted', 'defused', 'exploded'];
const net = { mode: 'off', kind: 'online', room: null, lobby: null, hostId: null, myId: -1, name: '', code: '', servers: new Map(), snapT: 0, stT: 0, annT: 0, lastSnap: 0, joinT: 0, pendingJoin: null, selected: null };
const isHost = () => net.mode === 'host', isClient = () => net.mode === 'client', online = () => net.mode !== 'off';
const LOCAL_ID = Math.random().toString(36).slice(2, 10);

function localRoom(roomId) {
  const ch = new BroadcastChannel('strafe16:' + roomId), peers = new Map();
  let onMsg = () => {}, onJoin = () => {}, onLeave = () => {};
  const post = o => { try { ch.postMessage(o); } catch {} };
  const seen = id => { if (!peers.has(id)) { peers.set(id, Date.now()); onJoin(id); } else peers.set(id, Date.now()); };
  ch.onmessage = e => {
    const m = e.data; if (!m || m.from === LOCAL_ID) return;
    if (m.k === 'bye') { if (peers.delete(m.from)) onLeave(m.from); return; }
    if (m.to && m.to !== LOCAL_ID) return;
    if (m.k === 'hi') { seen(m.from); post({ k: 'hb', from: LOCAL_ID, to: m.from }); return; }
    if (m.k === 'hb') { seen(m.from); return; }
    seen(m.from); onMsg(m.d, m.from);
  };
  post({ k: 'hi', from: LOCAL_ID });
  const hb = setInterval(() => {
    post({ k: 'hb', from: LOCAL_ID });
    const now = Date.now(); for (const [id, t] of peers) if (now - t > 6000) { peers.delete(id); onLeave(id); }
  }, 1000);
  const bye = () => post({ k: 'bye', from: LOCAL_ID });
  addEventListener('pagehide', bye);
  return {
    selfId: LOCAL_ID, send: (d, to) => post({ k: 'm', from: LOCAL_ID, to: to || null, d }),
    onMsg: f => onMsg = f, onJoin: f => onJoin = f, onLeave: f => onLeave = f,
    leave: () => { bye(); clearInterval(hb); removeEventListener('pagehide', bye); ch.close(); },
  };
}
async function openRoom(kind, roomId) {
  if (kind === 'local') return localRoom(roomId);
  const T = await import('./lib/trystero.js');
  const room = T.joinRoom({ appId: NET_APP }, roomId);
  const [send, get] = room.makeAction('m');
  let onMsg = () => {}, onJoin = () => {}, onLeave = () => {};
  get((d, id) => onMsg(d, id)); room.onPeerJoin(id => onJoin(id)); room.onPeerLeave(id => onLeave(id));
  return {
    selfId: T.selfId, send: (d, to) => { send(d, to || null).catch?.(() => {}); },
    onMsg: f => onMsg = f, onJoin: f => onJoin = f, onLeave: f => onLeave = f,
    leave: () => { try { room.leave(); } catch {} },
  };
}
const netSend = (d, to) => net.room && net.room.send(d, to);
const netTo = (h, d) => h && h.peer && netSend(d, h.peer);
const netIdOf = e => !e ? -1 : e === player ? (isClient() ? net.myId : ID_HOST) : e.idx;
function entById(id) {
  if (id == null || id < 0) return null;
  if (id === (isClient() ? net.myId : ID_HOST)) return player;
  return bots[id] || null;
}
const humans = () => bots.filter(b => b.human && b.idx < ID_HOST);
const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
const r1 = v => Math.round(v);

/* ---------------- server browser (lobby) ---------------- */
async function lobbyOpen(kind) {
  if (net.lobby && net.lobby.kind === kind) return net.lobby;
  lobbyClose();
  const r = await openRoom(kind, 'lobby'); r.kind = kind; net.lobby = r;
  r.onMsg((m, from) => {
    if (!m) return;
    if (m.t === 'ann' && m.code) { net.servers.set(m.code, { ...m, host: from, seen: Date.now() }); renderServers(); }
    if (m.t === 'q' && isHost()) announce(from);
  });
  r.onJoin(id => { if (isHost()) announce(id); });
  r.onLeave(id => { for (const [k, s] of net.servers) if (s.host === id) net.servers.delete(k); renderServers(); });
  return r;
}
function lobbyClose() { if (net.lobby) { net.lobby.leave(); net.lobby = null; } }
function announce(to) {
  if (!isHost() || !net.lobby) return;
  const hs = humans().length + 1;
  net.lobby.send({ t: 'ann', code: net.code, name: net.name, map: 'de_dunes', humans: hs, bots: bots.filter(b => b.active && !b.human && b.idx < ID_HOST).length, max: settings.teamSize * 2, score: [game.ct, game.t], v: 1 }, to);
}
function renderServers() {
  const list = $('srvList'); if (!list) return;
  const now = Date.now();
  for (const [k, s] of net.servers) if (now - s.seen > 9000) net.servers.delete(k);
  const rows = [...net.servers.values()];
  list.innerHTML = rows.map(s => `<tr data-code="${esc(s.code)}" class="${net.selected === s.code ? 'sel' : ''}"><td>${esc(s.name)}</td><td>${s.humans} + ${s.bots} bots / ${s.max}</td><td>${esc(s.map)}</td><td>${s.score[0]} : ${s.score[1]}</td></tr>`).join('');
  [...list.children].forEach(tr => {
    tr.onclick = () => { net.selected = tr.dataset.code; renderServers(); };
    tr.ondblclick = () => { net.selected = tr.dataset.code; joinSelected(); };
  });
  $('srvStatus').textContent = rows.length ? `${rows.length} server${rows.length === 1 ? '' : 's'} found.` : 'Searching for servers… (servers appear within a few seconds; create one if nobody is hosting)';
}
async function openBrowser() {
  $('mpName').value = settings.name; $('mpNet').value = net.kind;
  $('browser').classList.remove('hidden');
  net.servers.clear(); renderServers();
  try { const r = await lobbyOpen(net.kind); r.send({ t: 'q' }); }
  catch (e) { $('srvStatus').textContent = 'Could not start networking: ' + e.message; }
}
function refreshServers() { net.servers.clear(); renderServers(); net.lobby?.send({ t: 'q' }); }

/* ---------------- hosting ---------------- */
async function hostServer(name, kind) {
  await netStop(true);
  net.kind = kind; net.name = name || `${settings.name}'s server`; net.code = Math.random().toString(36).slice(2, 8);
  const room = await openRoom(kind, 'g-' + net.code);
  net.room = room; net.mode = 'host'; net.hostId = room.selfId;
  room.onMsg(hostOnMsg);
  room.onLeave(id => { const h = bots.find(b => b.human && b.peer === id); if (h) dropHuman(h, 'left the game'); });
  await lobbyOpen(kind); announce();
  conPrint(`Server "${net.name}" started (${kind === 'local' ? 'this browser only' : 'internet'}). Empty slots are filled with bots.`, 'dim');
}
function dropHuman(h, why) {
  killFeedMsg(`${h.name} ${why}`);
  if (bomb.carrier === h) dropBomb(h);
  if (bomb.defuser === h) bomb.defuser = null;
  h.human = false; h.peer = null; h.active = h.alive = false; h.waiting = false;
  for (const k in h.meshes) h.meshes[k].g.visible = false;
}
function hostOnMsg(m, from) {
  if (!m || !m.t) return;
  let h = bots.find(b => b.human && b.peer === from);
  if (m.t === 'hello') {
    if (h) { netTo(h, welcomeMsg(h)); return; }
    const free = bots.slice(0, ID_HOST).find(b => !b.human && !b.active) || bots.slice(0, ID_HOST).find(b => !b.human);
    if (!free) return netSend({ t: 'full' }, from);
    if (free.active) { free.active = free.alive = false; for (const k in free.meshes) free.meshes[k].g.visible = false; }
    h = free; h.human = true; h.peer = from; h.kills = 0; h.deaths = 0;
    h.name = String(m.name || 'Player').slice(0, 24);
    h.team = pickTeam(m.team);
    h.active = true; h.alive = false; h.waiting = true; h.hp = 100;
    for (const k in h.meshes) h.meshes[k].g.visible = false;
    netTo(h, welcomeMsg(h));
    killFeedMsg(`${h.name} joined the ${h.team === 'CT' ? 'Counter-Terrorists' : 'Terrorists'}`);
    announce();
    return;
  }
  if (!h) return;
  switch (m.t) {
    case 'st':
      (h.netPos ||= new THREE.Vector3()).set(m.x, m.y, m.z); h.netYaw = m.yaw;
      if (h.waiting || !h.alive) h.pos.copy(h.netPos);
      h.duck = !!m.d; h.netSpeed = m.mv; h.moving = m.mv > 20; h.busy = !!m.b; h.weapon = m.w;
      if (h.alive) { h.hp = m.hp; h.armor = m.ar; }
      break;
    case 'hit': {
      const t = entById(m.id); if (!t || !h.alive || game.phase !== 'live') break;
      const dmg = clamp(+m.dmg || 0, 0, 600);
      if (t === player) damagePlayer(dmg, h, !!m.hs, m.w); else if (t.active) damageBot(t, dmg, !!m.hs, m.w, h);
      break;
    }
    case 'shot':
      remoteShot(h, m);
      netSend({ t: 'fx', f: h.idx, a: m.a, b: m.b });
      for (const b of bots) if (b.alive && b.active && !b.human && b.team !== h.team && !b.target && b.pos.distanceTo(h.pos) < 2200) { b.alertT = 3; b.lastKnown = h.pos.clone(); b.hunt(h.pos); }
      break;
    case 'died': {
      if (!h.alive) break;
      h.alive = false; h.deathT = 0; h.deaths++; h.plantT = h.defuseT = 0; h.hp = 0;
      if (bomb.carrier === h) dropBomb(h);
      if (bomb.defuser === h) bomb.defuser = null;
      const k = entById(m.by);
      if (k && k !== h) { k.kills++; if (k === player) addMoney(300); else if (k.human) netTo(k, { t: 'money', n: 300 }); }
      killFeed(k, h, m.w || 'world', !!m.hs);
      break;
    }
    case 'plant':
      if (bomb.carrier === h && h.alive && game.phase === 'live') { h.pos.set(m.x, m.y, m.z); plantBomb(h); }
      break;
    case 'defuse':
      if (bomb.state === 'planted' && h.alive && h.team === 'CT' && Math.hypot(h.pos.x - bomb.pos.x, h.pos.z - bomb.pos.z) < 140) defuseBomb(h);
      break;
    case 'drop': if (bomb.carrier === h) dropBomb(h); break;
    case 'team': {
      const t = pickTeam(m.team, h);
      if (t !== h.team) { h.pendingTeam = t; netTo(h, { t: 'msg', s: `You will join the ${t === 'CT' ? 'Counter-Terrorists' : 'Terrorists'} next round.` }); }
      break;
    }
  }
}
function pickTeam(t, self) {
  if (t === 'CT' || t === 'T') return t;
  const count = team => humans().filter(b => b !== self && (b.pendingTeam || b.team) === team).length + (player.team === team ? 1 : 0);
  return count('CT') <= count('T') ? 'CT' : 'T';
}
const welcomeMsg = h => ({ t: 'welcome', id: h.idx, team: h.team, name: net.name, rules: { ...rules }, teamSize: settings.teamSize, phys: { ...phys }, airAccel: settings.airAccel });
function remoteShot(e, m) {
  e.flashT = 0.05;
  const a = v3(m.a), b = v3(m.b);
  if (rand() < 0.6) addTracer(a, b);
  SFX.enemy(a.distanceTo(camera.position));
}
function buildSnap() {
  const ents = [];
  const add = (e, id) => ents.push([id, e.team === 'CT' ? 1 : 0, e.alive ? 1 : 0, r1(e.pos.x), r1(e.pos.y), r1(e.pos.z), +(e.isPlayer ? player.yaw : e.yaw).toFixed(2), r1(Math.max(0, e.hp)), e.kills, e.deaths,
    (e.isPlayer ? (hspeed() > 20 ? 1 : 0) : e.moving ? 1 : 0) | ((e.isPlayer ? player.duck : e.duck) ? 2 : 0) | (e.plantT > 0 || e.defuseT > 0 || e.busy ? 4 : 0) | (e.isPlayer || e.human ? 8 : 0), e.name]);
  if (started) add(player, ID_HOST);
  for (const b of bots) if (b.active && b.idx < ID_HOST && !b.waiting) add(b, b.idx);
  return {
    t: 'snap', g: [game.phase === 'live' ? 1 : 0, +game.time.toFixed(1), +Math.max(0, game.freeze).toFixed(1), game.ct, game.t],
    b: [BSTATES.indexOf(bomb.state), netIdOf(bomb.carrier), r1(bomb.pos.x), r1(bomb.pos.y), r1(bomb.pos.z), +bomb.timer.toFixed(1), netIdOf(bomb.defuser)], e: ents,
  };
}

/* ---------------- joining ---------------- */
async function joinServer(code, hostId, kind, team) {
  await netStop(true);
  net.kind = kind; net.code = code; net.hostId = hostId;
  const s = net.servers.get(code); net.name = s ? s.name : 'server';
  lobbyClose();
  const room = await openRoom(kind, 'g-' + code);
  net.room = room; net.mode = 'client'; net.myId = -1; net.joinT = performance.now(); net.lastSnap = performance.now();
  const hello = () => netSend({ t: 'hello', name: settings.name, team }, net.hostId);
  room.onJoin(id => { if (id === net.hostId && net.myId < 0) hello(); });
  room.onLeave(id => { if (id === net.hostId) netStop(false, 'The server closed the connection.'); });
  room.onMsg(clientOnMsg);
  hello(); net.helloT = setInterval(() => { if (net.myId < 0) hello(); else clearInterval(net.helloT); }, 1000);
  // local state until the first round message arrives
  for (const b of bots) { b.active = b.alive = false; b.human = false; for (const k in b.meshes) b.meshes[k].g.visible = false; }
  player.team = team === 'auto' ? 'CT' : team; player.alive = false; player.deathT = 9; player.kills = player.deaths = 0; player.lossStreak = 0;
  player.money = rules.startmoney; player.secondary = null; defaultLoadout(); showVM(null);
  started = true; game.phase = 'end'; game.ct = game.t = 0;
  for (const h of holes) h.visible = false; bombMesh.visible = false;
  showCenter(`Connecting to ${esc(net.name)}…`, '');
}
function clientOnMsg(m, from) {
  if (!m || from !== net.hostId) return;
  switch (m.t) {
    case 'welcome':
      net.myId = m.id; player.team = m.team; net.name = m.name;
      Object.assign(rules, m.rules); Object.assign(phys, m.phys); settings.teamSize = m.teamSize; settings.airAccel = m.airAccel;
      player.money = rules.startmoney; defaultLoadout();
      showCenter(`Connected to ${esc(net.name)}`, 'You will spawn next round.');
      conPrint(`Connected to "${net.name}" as ${settings.name} (${m.team}).`, 'dim');
      break;
    case 'full': netStop(false, 'The server is full.'); break;
    case 'snap': applySnap(m); break;
    case 'round': clientRound(m); break;
    case 'roundend': game.phase = 'end'; roundEndLocal(m.w, m.r, m.p); break;
    case 'dmg': damagePlayer(m.d, entById(m.f), !!m.hs, m.w); break;
    case 'money': addMoney(m.n); break;
    case 'kill': killFeed(entById(m.a), entById(m.v), m.w, m.hs); break;
    case 'msg': killFeedMsg(m.s); break;
    case 'fx': if (m.f !== net.myId) { const e = entById(m.f); if (e && e !== player) remoteShot(e, m); } break;
    case 'bomb':
      if (m.k === 'planted') { showCenter('The bomb has been planted!', ''); setTimeout(() => game.phase === 'live' && showCenter('', ''), 2500); radio('Bomb has been planted.'); SFX.plant(); bomb.timer = rules.c4timer; bomb.beepT = 0; }
      if (m.k === 'boom') { bombMesh.visible = false; explosion.position.set(m.x, m.y + 60, m.z); explosion.visible = true; explodeT = 1.6; SFX.explode(); shake = 1.2; }
      break;
    case 'restart': player.money = rules.startmoney; player.lossStreak = 0; player.alive = false; break;
  }
}
function applySnap(s) {
  net.lastSnap = performance.now();
  const [live, time, freeze, ct, t] = s.g;
  game.time = time; game.freeze = freeze; game.ct = ct; game.t = t; game.phase = live ? 'live' : 'end';
  const seen = new Set();
  for (const a of s.e) {
    const [id, tm, al, x, y, z, yaw, hp, k, d, fl, name] = a, team = tm ? 'CT' : 'T';
    if (id === net.myId) { player.kills = k; player.deaths = d; continue; }
    const b = bots[id]; if (!b) continue; seen.add(b);
    if (!b.active || b.team !== team) {
      for (const m in b.meshes) b.meshes[m].g.visible = false;
      b.team = team; b.active = true; b.pos.set(x, y, z); b.yaw = yaw; b.deathT = al ? 0 : 5; b.alive = !!al;
      const g = b.m.g; g.visible = true; g.rotation.set(0, yaw, 0); g.position.set(x, y, z); b.gun = 'ak47';
    }
    if (b.alive && !al) b.deathT = 0;
    if (!b.alive && al) { b.pos.set(x, y, z); b.yaw = yaw; b.m.g.rotation.set(0, yaw, 0); }
    b.alive = !!al; b.hp = hp; b.kills = k; b.deaths = d; b.name = name; b.human = !!(fl & 8);
    b.moving = !!(fl & 1); b.duck = !!(fl & 2); b.busy = !!(fl & 4);
    (b.netPos ||= new THREE.Vector3()).set(x, y, z); b.netYaw = yaw;
  }
  for (const b of bots) if (b.active && !seen.has(b)) { b.active = b.alive = false; for (const m in b.meshes) b.meshes[m].g.visible = false; }
  const [bs, bc, bx, by, bz, bt, bd] = s.b, st = BSTATES[bs] || 'none';
  const wasMine = bomb.carrier === player;
  bomb.carrier = entById(bc); bomb.defuser = entById(bd); bomb.pos.set(bx, by, bz);
  if (st === 'planted' && (bomb.state !== 'planted' || Math.abs(bomb.timer - bt) > 1)) bomb.timer = bt;
  bomb.state = st;
  bombMesh.visible = st === 'planted' || st === 'dropped'; if (bombMesh.visible) bombMesh.position.copy(bomb.pos);
  if (!wasMine && bomb.carrier === player) { cprint('You have the bomb! Plant it at bombsite A (hold E, or select it with 5 and hold fire).'); updateHUD(true); }
  if (wasMine && bomb.carrier !== player && player.weapon === 'c4') switchWeapon(player.primary || player.secondary || 'knife');
}
function clientRound(m) {
  const p = player, changed = p.team !== m.team;
  p.team = m.team;
  if (!p.alive || !p.secondary || changed) defaultLoadout();
  p.pos.set(m.x, m.y + EPS, m.z); p.prev.copy(p.pos); p.vel.set(0, 0, 0);
  p.yaw = m.yaw; p.pitch = 0; p.hp = 100; p.alive = true; p.duck = false; p.eyeOff = EYE_STAND; p.onGround = false;
  p.punch = p.punchYaw = 0; p.reloading = 0; p.shots = 0; p.drawT = 0.3; p.zoom = 0; p.rezoomAt = -1; p.plantT = 0; p.defuseT = 0;
  if (!WEAPONS[p.weapon] || p.weapon === 'c4' || (p.weapon !== 'knife' && !p.ammo[p.weapon])) p.weapon = p.primary || p.secondary;
  showVM(p.weapon);
  for (const h of holes) h.visible = false;
  explosion.visible = false;
  game.phase = 'live'; game.freeze = m.freeze; game.roundStart = simTime; game.wasPlanted = false;
  showCenter('', ''); updateHUD(true);
}

/* ---------------- shared ---------------- */
async function netStop(silent, reason) {
  clearInterval(net.helloT);
  const was = net.mode;
  if (net.room) { try { net.room.leave(); } catch {} net.room = null; }
  lobbyClose();
  net.mode = 'off'; net.myId = -1; net.hostId = null;
  for (const b of bots) if (b.human) { b.human = false; b.peer = null; b.active = b.alive = false; for (const k in b.meshes) b.meshes[k].g.visible = false; }
  if (was === 'client') {
    for (const b of bots) { b.active = b.alive = false; for (const k in b.meshes) b.meshes[k].g.visible = false; }
    started = false; player.alive = false; showVM(null); bombMesh.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
    mainmenu.classList.remove('hidden'); hudEl.classList.add('hidden');
    $('mmResume').classList.add('hidden'); $('mmTeam').classList.add('hidden');
  }
  if (!silent && reason) { showCenter('', ''); alertBox(reason); }
  updateNetMenu();
}
function alertBox(text) { $('alertText').textContent = text; $('alertwin').classList.remove('hidden'); }
function updateNetMenu() {
  $('mmLeave').classList.toggle('hidden', !online());
  $('mmLeave').textContent = isHost() ? 'Stop Server' : 'Disconnect';
}
function netTick(dt) {
  if (!online() || !net.room) return;
  if (isHost()) {
    net.snapT -= dt; if (net.snapT <= 0) { net.snapT = 1 / 15; netSend(buildSnap()); }
    net.annT -= dt; if (net.annT <= 0) { net.annT = 2; announce(); }
  } else {
    net.stT -= dt;
    if (net.stT <= 0 && net.myId >= 0) {
      net.stT = 1 / 30; const p = player;
      netSend({ t: 'st', x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(1), z: +p.pos.z.toFixed(1), yaw: +p.yaw.toFixed(3), d: p.duck ? 1 : 0, mv: Math.round(hspeed()), hp: p.hp, ar: p.armor, b: p.plantT > 0 || p.defuseT > 0 ? 1 : 0, w: p.weapon }, net.hostId);
    }
    if (game.freeze > 0) game.freeze = Math.max(0, game.freeze - dt);
    else if (game.phase === 'live' && bomb.state !== 'planted') game.time -= dt;
    const quiet = performance.now() - net.lastSnap;
    if (net.myId < 0 && performance.now() - net.joinT > 20000) netStop(false, 'Could not connect to the server. The host may be offline, or your network may block peer-to-peer connections.');
    else if (net.myId >= 0 && quiet > 12000) netStop(false, 'Lost connection to the server.');
  }
}
// keep a hosted game running (slowly) when its tab is in the background
setInterval(() => {
  if (!document.hidden || !online() || !started) return;
  for (let i = 0; i < 10; i++) physicsTick(TICK);
  update(0.1);
}, 100);

/* ---------------- lobby UI ---------------- */
$('mmFind').onclick = () => openBrowser();
$('mmCreate').onclick = () => {
  $('crName').value = `${settings.name}'s server`; $('crSize').value = settings.teamSize; $('crSizeOut').textContent = `${settings.teamSize} v ${settings.teamSize}`;
  $('crDiff').value = settings.diff; $('crNet').value = net.kind; $('create').classList.remove('hidden');
};
$('crSize').oninput = () => $('crSizeOut').textContent = `${$('crSize').value} v ${$('crSize').value}`;
$('crStart').onclick = async () => {
  settings.teamSize = +$('crSize').value; settings.diff = $('crDiff').value; saveSettings(); syncOptions();
  $('create').classList.add('hidden');
  try { await hostServer($('crName').value.trim(), $('crNet').value); }
  catch (e) { alertBox('Could not start the server: ' + e.message); return; }
  pendingNew = true; openTeamMenu();
};
$('mpName').onchange = () => { settings.name = $('mpName').value.trim().slice(0, 24) || 'Player'; saveSettings(); syncOptions(); };
$('mpNet').onchange = async () => { net.kind = $('mpNet').value; net.servers.clear(); renderServers(); try { const r = await lobbyOpen(net.kind); r.send({ t: 'q' }); } catch {} };
$('srvRefresh').onclick = () => refreshServers();
$('srvJoin').onclick = () => joinSelected();
function joinSelected() {
  const s = net.servers.get(net.selected); if (!s) return alertBox('Select a server first.');
  settings.name = $('mpName').value.trim().slice(0, 24) || 'Player'; saveSettings();
  net.pendingJoin = s; $('browser').classList.add('hidden'); openTeamMenu();
}
$('mmLeave').onclick = () => { netStop(false); if (started && net.mode === 'off') conPrint('Server stopped. You can keep playing offline.', 'dim'); };
setInterval(() => { if (!$('browser').classList.contains('hidden')) renderServers(); }, 1000);
window.__net = { net, hostServer, joinServer, netStop, lobbyOpen, humans, entById };

/* ============================================================
   MAIN LOOP
   ============================================================ */
let vmKick = 0, vmFlashT = 0, muzzleT = 0, vmKnifeSwing = 0, bobT = 0, acc = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, fpsVal = 0;

function updatePlantDefuse(dt) {
  const p = player;
  let label = '', prog = 0;
  // planting
  const r = Math.floor(p.pos.z / CELL), c = Math.floor(p.pos.x / CELL);
  const wantPlant = p.alive && bomb.carrier === p && game.freeze <= 0 && game.phase === 'live' && ((p.weapon === 'c4' && mouseL) || keys.KeyE);
  if (wantPlant && inRect(r, c, SITE) && p.onGround) {
    if (p.weapon !== 'c4') switchWeapon('c4');
    if (p.plantT === 0) SFX.defuse();
    p.plantT += dt; label = 'Planting the bomb'; prog = p.plantT / 3.2;
    if (p.plantT >= 3.2) plantBomb(p);
  } else {
    if (wantPlant && mouseL && !inRect(r, c, SITE) && !updatePlantDefuse.warned) { cprint('C4 must be planted at a bomb site!'); updatePlantDefuse.warned = true; setTimeout(() => updatePlantDefuse.warned = false, 2000); }
    p.plantT = 0;
  }
  // defusing
  const near = bomb.state === 'planted' && Math.hypot(p.pos.x - bomb.pos.x, p.pos.z - bomb.pos.z) < 72 && Math.abs(p.pos.y - bomb.pos.y) < 70;
  if (p.alive && p.team === 'CT' && near && keys.KeyE && p.onGround && game.phase === 'live' && (!bomb.defuser || bomb.defuser === p)) {
    if (p.defuseT === 0) { SFX.defuse(); cprint(p.kit ? 'Defusing bomb with defuse kit.' : 'Defusing bomb without defuse kit.'); }
    bomb.defuser = p; p.defuseT += dt; const need = p.kit ? 5 : 10; label = 'Defusing'; prog = p.defuseT / need;
    if (p.defuseT >= need) defuseBomb(p);
  } else { if (bomb.defuser === p) bomb.defuser = null; p.defuseT = 0; }
  hud.prog.classList.toggle('hidden', !label);
  if (label) { hud.progBar.style.width = `${Math.min(100, prog * 100)}%`; hud.progLabel.textContent = label; }
}

function update(dt) {
  const p = player;
  if (p.alive && !bm.open) {
    const zr = p.zoom ? zoomFov() / settings.fov : 1;
    p.yaw += ((keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0)) * 210 * DEG * dt * zr;
    p.pitch = clamp(p.pitch + ((keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0)) * 225 * DEG * dt * zr, -1.55, 1.55);
  }
  if (p.alive) {
    p.drawT = Math.max(0, p.drawT - dt);
    const w = curW();
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) { const am = p.ammo[p.weapon]; const take = Math.min(w.mag - am.mag, am.res); am.mag += take; am.res -= take; p.reloading = 0; p.shots = 0; }
    }
    if (p.rezoomAt > 0 && simTime >= p.rezoomAt) { p.zoom = p.rezoomLevel; p.rezoomAt = -1; }
    if (!bm.open && !busy()) {
      if (mouseL && simTime >= p.nextFire && (w.auto || w.melee || triggerUp)) { fire(false); triggerUp = false; }
      else if (mouseR && w.melee && simTime >= p.nextFire) fire(true);
    }
    if (!mouseL) triggerUp = true;
    // recoil recovery: the spray index decays once you stop firing
    const firing = mouseL && w.auto && simTime < p.nextFire + 0.05;
    if (!firing && simTime > p.nextFire - w.rate * 0.5) p.shots *= Math.exp(-dt * (w.auto ? 5 : 3.5));
    if (p.shots < 0.05) p.shots = 0;
    const [tx, ty] = w.melee || w.c4 ? [0, 0] : patAt(w, p.shots);
    const kp = Math.min(1, dt * 30);
    p.punch += (ty * 0.5 * DEG - p.punch) * kp; p.punchYaw += (-tx * 0.5 * DEG - p.punchYaw) * kp;
    if (!w.melee && !w.c4 && p.ammo[p.weapon] && p.ammo[p.weapon].mag === 0 && p.ammo[p.weapon].res > 0 && p.reloading <= 0 && simTime > p.nextFire) startReload();
  }
  updatePlantDefuse(dt);
  if (bm.open && !canBuy(true)) closeBuyMenu();
  for (const b of bots) if (b.active) b.update(dt);
  updateBomb(dt);
  updateRound(dt);
  netTick(dt);
  updateEffects(dt);
  p.eyeOff += ((p.duck ? EYE_DUCK : EYE_STAND) - p.eyeOff) * Math.min(1, dt * 14);
  if (!p.alive) p.deathT += dt;
  dmgFlash = Math.max(0, dmgFlash - dt * 1.8); hud.dmg.style.opacity = dmgFlash;
  muzzleT -= dt; if (muzzleT <= 0) muzzleLight.intensity = 0;
  shake = Math.max(0, shake - dt);
  hud.buyicon.classList.toggle('hidden', !canBuy(true));
  if (game.freeze > 0 && canBuy(true)) hud.buyicon.title = 'Buy time';
  const st = !p.alive && p.deathT > 1.5 ? specTarget() : null;
  hud.spec.classList.toggle('hidden', !(!p.alive && started));
  if (!p.alive) hud.spec.innerHTML = st ? `Spectating <b class="${tcls(st.team)}">${esc(st.name)}</b> · ${Math.max(0, Math.round(st.hp))} HP · click for next player` : 'You are dead. Waiting for the next round…';
  updateHUD(); updateCrosshair(dt); drawRadar(); applyFov();
  if (!hud.score.classList.contains('hidden')) renderScoreboard();
  if (!$('xhwin').classList.contains('hidden')) { xhPrevT += dt; drawXhPreview(); }
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fpsVal = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  const lines = [];
  if (settings.showfps) lines.push(`${fpsVal} fps`);
  if (settings.showpos) lines.push(`pos: ${p.pos.x.toFixed(0)} ${p.pos.z.toFixed(0)} ${p.pos.y.toFixed(0)}\nang: ${(p.pitch / DEG).toFixed(1)} ${(p.yaw / DEG).toFixed(1)}\nvel: ${hspeed().toFixed(1)}`);
  hud.fps.textContent = lines.join('\n');
}

function render(dt) {
  const p = player, a = clamp(acc / TICK, 0, 1);
  const x = p.prev.x + (p.pos.x - p.prev.x) * a, y = p.prev.y + (p.pos.y - p.prev.y) * a, z = p.prev.z + (p.pos.z - p.prev.z) * a;
  const st = !p.alive && p.deathT > 1.5 ? specTarget() : null;
  if (p.alive) {
    camera.position.set(x, y + p.eyeOff, z);
    camera.rotation.set(p.pitch + p.punch, p.yaw + p.punchYaw, 0);
  } else if (st) {
    // third-person chase camera behind a living teammate
    const e = st.eye(), back = viewDir(st.yaw, -0.25).multiplyScalar(-1);
    const h = rayWorld(e.x, e.y, e.z, back.x, back.y, back.z, 130);
    const dist = h ? Math.max(10, h.t - 8) : 130;
    camera.position.copy(e).addScaledVector(back, dist);
    camera.rotation.set(-0.25, st.yaw, 0);
  } else {
    const k = Math.min(1, p.deathT * 2.5);
    camera.position.set(x, y + p.eyeOff - k * (p.eyeOff - 12), z);
    camera.rotation.set(p.pitch * (1 - k), p.yaw, k * 0.5);
  }
  if (shake > 0) { camera.position.x += (rand() - .5) * shake * 12; camera.position.y += (rand() - .5) * shake * 12; }
  const w = curW();
  if (p.alive && w) {
    const vm = getVM(p.weapon), base = vm.base;
    const sp = p.onGround ? hspeed() : 0;
    bobT += dt * (sp > 20 ? 10 : 0);
    const bob = Math.min(1, sp / 250) * 0.008;
    swayX *= Math.pow(0.0005, dt); swayY *= Math.pow(0.0005, dt);
    vmKick *= Math.pow(0.0001, dt); vmKnifeSwing = Math.max(0, vmKnifeSwing - dt * 3);
    const draw = p.drawT > 0 ? p.drawT / 0.45 : 0;
    const rl = p.reloading > 0 && w.reload ? Math.sin(Math.min(1, (w.reload - p.reloading) / w.reload) * Math.PI) : 0;
    const busyDip = busy() ? 0.08 : 0;
    vm.g.position.set(base[0] + Math.cos(bobT * 0.5) * bob - clamp(swayX, -0.04, 0.04), base[1] + Math.abs(Math.sin(bobT * 0.5)) * bob - draw * 0.25 - rl * 0.12 - busyDip + clamp(swayY, -0.04, 0.04) + (p.onGround ? 0 : 0.01), base[2] + vmKick);
    vm.g.rotation.set(vmKick * 1.5 - rl * 0.7 + draw * 0.6, vmKnifeSwing * 0.9, vmKnifeSwing * -0.6 + rl * 0.3);
    vmFlashT -= dt; vm.flash.visible = vmFlashT > 0; if (vm.flash.visible) vm.flash.rotation.z = rand() * 6;
  }
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  if (p.alive && w && !(p.zoom && w.sniper)) renderer.render(vmScene, vmCam);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running || (online() && started)) {
    acc += dt;
    while (acc >= TICK) { physicsTick(TICK); acc -= TICK; }
    update(dt);
  } else if (!started) {
    const t = now / 1000 * 0.05;
    camera.fov = vfov(settings.fov); camera.updateProjectionMatrix();
    camera.position.set(MW * CELL / 2 + Math.cos(t) * 1900, 1700, MH * CELL / 2 + Math.sin(t) * 1900);
    camera.lookAt(MW * CELL / 2, 0, MH * CELL / 2);
    renderer.clear(); renderer.render(scene, camera); return;
  }
  if (!$('xhwin').classList.contains('hidden') && !running) { xhPrevT += dt; drawXhPreview(); }
  render(running ? dt : 0);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = vmCam.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
});

// debug hook for testing
window.__game = { renderer, scene, player, bots, bomb, game, keys, newGame, startRound, physicsTick, update, settings, buy, runCommand, openBuyMenu, bmKey, bm, toggleZoom, fire, findPath, chooseTeam, plantBomb, MAP, set running(v) { running = v; }, get running() { return running; }, set started(v) { started = v; }, set mouseL(v) { mouseL = v; } };

requestAnimationFrame(frame);
