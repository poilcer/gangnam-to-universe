// ===== From my neighborhood to the edge of the universe — multi-scale explorer =====
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js';

const $ = (id) => document.getElementById(id);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---------- physical constants (meters) ----------
const R_E = 6.371e6, AU = 1.496e11, LY = 9.4607e15, KLY = 1e3 * LY, MLY = 1e6 * LY;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SUN0 = V(0, 0, 0);
const E = V(AU, 0, 0);                                         // Earth center (Sun at origin, ecliptic = xz)
const UP_S = V(-0.62, 0.70, 0.35).normalize();                 // Seoul "up" (afternoon sun)
const S = E.clone().addScaledVector(UP_S, R_E);                // Seoul surface point
const NORTH = (() => { const a = V(0.2, 0.98, 0).normalize(); return a.sub(UP_S.clone().multiplyScalar(a.dot(UP_S))).normalize(); })();
const EAST = NORTH.clone().cross(UP_S).normalize(), SOUTH = NORTH.clone().negate();
const Q_TOWN = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(EAST, UP_S, SOUTH));
const N_G = V(0, Math.cos(Math.PI / 3), Math.sin(Math.PI / 3));  // galactic plane normal
const G_DIR = V(1, 0, 0);                                       // Sun -> galactic center
const G = G_DIR.clone().multiplyScalar(26.6 * KLY);             // galactic center
const M31_DIR = V(0.45, 0.35, -0.82).normalize();
const M31 = G.clone().addScaledVector(M31_DIR, 2.54 * MLY);
const LG = G.clone().lerp(M31, 0.45);
const SUN_DIR_SEOUL = SUN0.clone().sub(S).normalize();

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: location.search.includes('test') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight); renderer.autoClear = false; renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

async function tex(url, srgb = true){
  const blob = await (await fetch(url)).blob(); const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  const t = new THREE.Texture(bmp); t.flipY = false; t.needsUpdate = true; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function canvasTex(w, h, draw, srgb = true){ const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const glowTex = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });

// ---------- layers ----------
function layer(unit, origin, near, far){ const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, near, far);
  return { scene, cam, unit, origin, near, far }; }
const L_TOWN = layer(1, S, 0.05, 3e6);
const L_EARTH = layer(1e3, E, 0.001, 5e9);
const L_SOLAR = layer(1e9, SUN0, 1e-5, 1e7);
const L_STARS = layer(LY, SUN0, 1e-7, 1e6);
const L_GAL = layer(KLY, G, 1e-5, 1e6);
const L_COS = layer(MLY, G, 1e-5, 1e7);
const LAYERS_FAR_TO_NEAR = [L_COS, L_GAL, L_STARS, L_SOLAR, L_EARTH, L_TOWN];

// sky backdrop scenes (camera at origin)
const skyCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 20);
const starBox = new THREE.Scene(), skyDome = new THREE.Scene();

// ---------- point-sprite shader (soft round points, size in px) ----------
function pointsMat(opts){
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uOpacity: { value: 1 }, uScale: { value: opts.scale || 1 }, uMin: { value: opts.min ?? 1 }, uMax: { value: opts.max ?? 8 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale, uMin, uMax;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * uScale / max(1e-6, -mv.z), uMin, uMax);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vC; uniform float uOpacity;
      #include <logdepthbuf_pars_fragment>
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; float a = exp(-r * 18.0);
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(vC * a * uOpacity, a * uOpacity); }`
  });
}
function pointCloud(pos, col, size, opts){ const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
  const p = new THREE.Points(g, pointsMat(opts)); p.frustumCulled = false; return p; }

// ================= TOWN (unit m, local frame: x=east, y=up, z=south) =================
const town = new THREE.Group(); town.quaternion.copy(Q_TOWN); L_TOWN.scene.add(town);
const sunLocal = SUN_DIR_SEOUL.clone().applyQuaternion(Q_TOWN.clone().invert());
L_TOWN.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5a6048, 1.1));
const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.6); sunLight.position.copy(SUN_DIR_SEOUL); L_TOWN.scene.add(sunLight); L_TOWN.scene.add(sunLight.target);
sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096); Object.assign(sunLight.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 2400 }); sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.6;
L_TOWN.scene.fog = new THREE.FogExp2(0xbcd3ea, 0.00006);
const RIVER = [-3150, -2150];                                    // Han river band (local z, north of Gangnam)
const REAL = 2000;                                               // real OSM area half-size (m)
const BLK = 110, ROAD = 14, HALF = 4600;
const PROC_ROT = 0.3665;                                          // align the procedural outskirts with Gangnam's street grid (~21 deg)
const proc = new THREE.Group(); proc.rotation.y = PROC_ROT; town.add(proc);
function toWorld(x, z){ const c = Math.cos(PROC_ROT), s = Math.sin(PROC_ROT); return [x * c + z * s, -x * s + z * c]; }
function skipProc(x, z, pad){ const [wx, wz] = toWorld(x, z); return (Math.abs(wx) < REAL + pad && Math.abs(wz) < REAL + pad) || (wz > RIVER[0] - pad && wz < RIVER[1] + pad); }
// ground texture (6 km)
const groundTex = canvasTex(2048, 2048, (g, w, h) => {
  const k = w / (2 * HALF), X = (x) => (x + HALF) * k;
  g.fillStyle = '#6f7a62'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++){ g.fillStyle = `rgba(${90 + rnd() * 40},${100 + rnd() * 30},${80 + rnd() * 25},0.5)`; g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 6, 3 + rnd() * 6); }
  for (let x = -HALF; x < HALF; x += BLK) for (let z = -HALF; z < HALF; z += BLK){ g.fillStyle = rnd() < 0.08 ? '#5d7d4a' : `rgb(${150 + rnd() * 25},${148 + rnd() * 22},${140 + rnd() * 20})`; g.fillRect(X(x + ROAD / 2), X(z + ROAD / 2), (BLK - ROAD) * k, (BLK - ROAD) * k); }
  g.fillStyle = '#3d3f44'; for (let x = -HALF; x <= HALF; x += BLK){ g.fillRect(X(x - ROAD / 2), 0, ROAD * k, h); g.fillRect(0, X(x - ROAD / 2), w, ROAD * k); }
  g.globalCompositeOperation = 'destination-in'; const rg = g.createRadialGradient(w / 2, h / 2, w * 0.36, w / 2, h / 2, w * 0.5);
  rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, transparent: true }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.8; ground.renderOrder = -1; proc.add(ground);
const river = new THREE.Mesh(new THREE.PlaneGeometry(60000, RIVER[1] - RIVER[0]), new THREE.MeshStandardMaterial({ color: 0x3b6a86, roughness: 0.15, metalness: 0.3 }));
river.rotation.x = -Math.PI / 2; river.position.set(0, 0.3, (RIVER[0] + RIVER[1]) / 2); town.add(river);
// buildings
const winTex = canvasTex(128, 256, (g, w, h) => { g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, w, h);
  for (let y = 6; y < h; y += 16) for (let x = 6; x < w; x += 20){ g.fillStyle = rnd() < 0.25 ? '#f6e3a8' : '#55616e'; g.fillRect(x, y, 12, 9); } });
const bGeo = new THREE.BoxGeometry(1, 1, 1); bGeo.translate(0, 0.5, 0);
const bMat = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.8 });
const bList = [];
for (let bx = -HALF; bx < HALF; bx += BLK) for (let bz = -HALF; bz < HALF; bz += BLK){
  const cx = bx + BLK / 2, cz = bz + BLK / 2; if (skipProc(cx, cz, 80) || Math.hypot(cx, cz) > HALF * 0.86) continue;
  const inner = BLK - ROAD - 6, d = Math.hypot(cx, cz), r = rnd();
  if (r < 0.07) continue;                                                    // park
  if (r < 0.22 && d > 250){ for (let k = 0; k < 3; k++) bList.push([cx - inner / 2 + 12 + k * (inner - 24) / 2, cz, 16, 42 + rnd() * 34, 52, 0xf1efe9]); continue; } // apartment slabs
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
    const w = inner / n - 4, x = cx - inner / 2 + (i + 0.5) * inner / n, z = cz - inner / 2 + (j + 0.5) * inner / n;
    const tall = d < 700 && rnd() < 0.35; const hgt = tall ? 25 + rnd() * 60 : 6 + rnd() * 12;
    const col = tall ? [0x9fa8b3, 0x7d8894, 0xb8bfc7][Math.floor(rnd() * 3)] : [0xc8c2b8, 0xb5aea4, 0xd6d1c8, 0xa9a39a, 0xbdb6ab][Math.floor(rnd() * 5)];
    bList.push([x, z, w * (0.75 + rnd() * 0.2), hgt, w * (0.75 + rnd() * 0.2), col]);
  }
}
const bInst = new THREE.InstancedMesh(bGeo, bMat, bList.length); const m4 = new THREE.Matrix4(), cl = new THREE.Color();
bList.forEach((b, i) => { m4.makeScale(b[2], b[3], b[4]); m4.setPosition(b[0], 0, b[1]); bInst.setMatrixAt(i, m4); bInst.setColorAt(i, cl.setHex(b[5])); });
proc.add(bInst);
// trees
const tGeo = new THREE.IcosahedronGeometry(1, 1), tMat = new THREE.MeshStandardMaterial({ color: 0x4f7a3c, roughness: 1, flatShading: true });
const trees = []; for (let x = -HALF; x < HALF; x += BLK) for (let z = -HALF; z < HALF; z += 22){ if (skipProc(x, z, 30) || Math.hypot(x, z) > HALF * 0.86) continue; if (rnd() < 0.55) trees.push([x + ROAD / 2 + 2.5, z]); if (rnd() < 0.55) trees.push([x - ROAD / 2 - 2.5, z]); }

const tInst = new THREE.InstancedMesh(tGeo, tMat, trees.length);
trees.forEach((t, i) => { const s = 2.6 + rnd() * 1.6; m4.makeScale(s, s * 1.25, s); m4.setPosition(t[0], s * 1.5, t[1]); tInst.setMatrixAt(i, m4); tInst.setColorAt(i, cl.setHSL(0.26 + rnd() * 0.06, 0.45, 0.28 + rnd() * 0.1)); });
proc.add(tInst);
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1, 5); trunkGeo.translate(0, 0.5, 0);
const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b4636 }), trees.length);
trees.forEach((t, i) => { m4.makeScale(1, 2.6, 1); m4.setPosition(t[0], 0, t[1]); trunk.setMatrixAt(i, m4); }); proc.add(trunk);
// street lamps around the start
const lampGeo = new THREE.CylinderGeometry(0.08, 0.1, 6, 6); lampGeo.translate(0, 3, 0);
const lamps = [];
const lInst = new THREE.InstancedMesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.4 }), lamps.length);
lamps.forEach((l, i) => { m4.makeTranslation(l[0], 0, l[1]); lInst.setMatrixAt(i, m4); }); town.add(lInst);

// ================= REAL GANGNAM (OpenStreetMap buildings, roads, parks) =================
const REALG = new THREE.Group(); town.add(REALG); const MARKS = []; const PAVE = { mesh: null, map: null, far: false };
async function loadGangnam(){
  const meta = JSON.parse(await (await fetch('geo_meta.js')).text());
  const U8 = await Promise.all([0, 1].map(async k => { const b = atob((await (await fetch(`geo${k}.b64.js`)).text()).trim()); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }));
  const T = {}; const names = ['Facade001','Facade002','Facade005','Facade006','Facade017','Facade018A','Facade019A','Facade020A','Asphalt031','PavingStones138','Concrete034','Grass004'];
  await Promise.all(names.map(async n => { const t = await tex(n + '.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; T[n] = t; }));
  const pav = T.PavingStones138; const pg = new THREE.Mesh(new THREE.PlaneGeometry(2 * REAL, 2 * REAL), new THREE.MeshStandardMaterial({ map: pav, roughness: 0.95, color: 0xb4b2ad }));
  pav.repeat.set(2 * REAL / 3.5, 2 * REAL / 3.5); PAVE.mesh = pg; PAVE.map = pav; pg.rotation.x = -Math.PI / 2; pg.position.y = 0.02; pg.receiveShadow = true; REALG.add(pg);
  for (const g of meta.groups){
    const geo = new THREE.BufferGeometry(); const u8 = U8[g.f];
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(u8.buffer, g.p, g.count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(u8.buffer, g.n, g.count * 3), 3, true));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(u8.buffer, g.uv, g.count * 2), 2));
    geo.computeBoundingSphere();
    let mat;
    if (g.name.startsWith('wall_')){ const k = g.name.slice(5), glass = ['Facade001','Facade002','Facade005'].includes(k);
      mat = new THREE.MeshStandardMaterial({ map: T[k], roughness: glass ? 0.3 : 0.8, metalness: glass ? 0.45 : 0.05, envMapIntensity: 1, side: THREE.DoubleSide }); }
    else if (g.name === 'roof') mat = new THREE.MeshStandardMaterial({ map: T.Concrete034, color: 0xb9b8b2, roughness: 0.95, side: THREE.DoubleSide });
    else if (g.name === 'asphalt') mat = new THREE.MeshStandardMaterial({ map: T.Asphalt031, color: 0x9a9a9a, roughness: 0.9 });
    else if (g.name === 'grass') mat = new THREE.MeshStandardMaterial({ map: T.Grass004, roughness: 1 });
    else if (g.name === 'water') mat = new THREE.MeshStandardMaterial({ color: 0x3b6a86, roughness: 0.15, metalness: 0.3 });
    else if (g.name === 'yellow') mat = new THREE.MeshStandardMaterial({ color: 0xe8b62c, roughness: 0.7 });
    else mat = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.7 });
    const m = new THREE.Mesh(geo, mat); m.castShadow = g.name.startsWith('wall_') || g.name === 'roof'; m.receiveShadow = true; m.frustumCulled = false; m.userData.kind = g.name; REALG.add(m); if (g.name === 'marking' || g.name === 'yellow') MARKS.push(m);
  }
  const tr = meta.trees, ti = new THREE.InstancedMesh(tGeo, tMat, tr.length), tk = new THREE.InstancedMesh(trunkGeo, trunk.material, tr.length);
  tr.forEach((t, i) => { const s = 2.4 + rnd() * 1.4; m4.makeScale(s, s * 1.3, s); m4.setPosition(t[0], 3.0 + s * 1.1, t[1]); ti.setMatrixAt(i, m4); ti.setColorAt(i, cl.setHSL(0.25 + rnd() * 0.07, 0.45, 0.26 + rnd() * 0.1));
    m4.makeScale(1.2, 3.4, 1.2); m4.setPosition(t[0], 0, t[1]); tk.setMatrixAt(i, m4); });
  ti.castShadow = true; tk.castShadow = true; REALG.add(ti); REALG.add(tk);
  const named = meta.labels.filter(l => l.t !== '강남역').sort((a, b) => b.h - a.h).slice(0, 16);
  named.concat(meta.labels.filter(l => l.t === '강남역')).forEach(l => { const lab = { text: l.t, pos: V(l.x, l.y, l.z).applyQuaternion(Q_TOWN).add(S), L: l.t === '강남역' ? [0, 3.6] : [0.9, 3.1], hi: l.t === '강남역' };
    const d = document.createElement('div'); d.className = 'lbl'; d.textContent = lab.text; if (lab.hi) d.style.color = '#ffe08a'; document.body.appendChild(d); lab.el = d; LABELS.push(lab); });
  return meta.groups.reduce((a, g) => a + g.count, 0);
}
// regional terrain disk (400 km)
const regionTex = canvasTex(2048, 2048, (g, w, h) => {
  g.fillStyle = '#4f6a3f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++){ const x = rnd() * w, y = rnd() * h, s = 4 + rnd() * 30; const t = rnd();
    g.fillStyle = t < 0.5 ? `rgba(${60 + rnd() * 30},${85 + rnd() * 35},${50 + rnd() * 20},0.35)` : t < 0.8 ? `rgba(${110 + rnd() * 30},${110 + rnd() * 20},${80},0.25)` : 'rgba(150,140,120,0.22)';
    g.beginPath(); g.arc(x, y, s, 0, 7); g.fill(); }
  const cx = w / 2, cy = h / 2, k = w / 800e3;
  { const ug = g.createRadialGradient(cx, cy, 0, cx, cy, 22e3 * k); ug.addColorStop(0, 'rgba(150,146,138,0.95)'); ug.addColorStop(0.55, 'rgba(150,146,138,0.75)'); ug.addColorStop(1, 'rgba(150,146,138,0)'); g.fillStyle = ug; g.beginPath(); g.arc(cx, cy, 22e3 * k, 0, 7); g.fill();
    for (let i = 0; i < 9000; i++){ const a = rnd() * 7, r = Math.pow(rnd(), 0.7) * 20e3 * k; const gv = 115 + rnd() * 70; g.fillStyle = `rgba(${gv + 6},${gv + 3},${gv - 4},0.6)`; g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1 + rnd() * 3, 1 + rnd() * 3); } }
  g.fillStyle = '#3b6a86'; g.fillRect(0, cy + RIVER[0] * k, w, (RIVER[1] - RIVER[0]) * k);
  g.fillStyle = '#2c5878'; g.beginPath(); g.moveTo(0, 0); g.lineTo(cx - 45e3 * k, 0); for (let y = 0; y <= h; y += 20) g.lineTo(cx - (45e3 + Math.sin(y / 37) * 9e3 + Math.sin(y / 11) * 2e3) * k, y); g.lineTo(0, h); g.fill();
  g.beginPath(); g.moveTo(w, 0); g.lineTo(cx + 175e3 * k, 0); for (let y = 0; y <= h; y += 20) g.lineTo(cx + (175e3 + Math.sin(y / 53) * 12e3) * k, y); g.lineTo(w, h); g.fill();
});
const region = new THREE.Mesh(new THREE.CircleGeometry(400e3, 96), new THREE.MeshStandardMaterial({ map: regionTex, roughness: 1, transparent: true, depthWrite: true }));
region.rotation.x = -Math.PI / 2; region.position.y = -3; region.renderOrder = -2; town.add(region);
// low clouds
const cloudTex = canvasTex(256, 256, (g) => { for (let i = 0; i < 26; i++){ const x = 128 + gauss() * 38, y = 128 + gauss() * 18, r = 30 + rnd() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); } });
const clouds = new THREE.Group(); town.add(clouds);
for (let i = 0; i < 260; i++){ const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.85, fog: false }));
  const s = 1800 + rnd() * 3200; sp.scale.set(s, s * 0.55, 1); sp.position.set((rnd() - 0.5) * 140e3, 2400 + rnd() * 1400, (rnd() - 0.5) * 140e3); clouds.add(sp); }

// sky dome (gradient + sun) and star box
const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false,
  uniforms: { uUp: { value: UP_S }, uSun: { value: SUN_DIR_SEOUL }, uA: { value: 1 } },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vD; uniform vec3 uUp, uSun; uniform float uA;
    void main(){ float h = dot(vD, uUp); vec3 zen = vec3(0.23, 0.47, 0.86), hor = vec3(0.72, 0.84, 0.95), gnd = vec3(0.55, 0.6, 0.62);
      vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor, gnd, min(1.0, -h * 4.0));
      float s = max(0.0, dot(vD, uSun)); c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
      gl_FragColor = vec4(c, uA); }` });
skyDome.add(new THREE.Mesh(new THREE.SphereGeometry(5, 48, 24), skyMat));
{ const pos = [], col = [], siz = [];
  for (let i = 0; i < 9000; i++){ const v = V(gauss(), gauss(), gauss()).normalize(); pos.push(v.x * 9, v.y * 9, v.z * 9); const b = 0.4 + rnd() * 0.6, t = rnd();
    col.push(b * (t < 0.2 ? 1 : 0.85), b * 0.9, b * (t > 0.8 ? 1 : 0.85)); siz.push(rnd() < 0.03 ? 3.2 : 1.4 + rnd()); }
  const perp = N_G.clone().cross(G_DIR).normalize();
  for (let i = 0; i < 26000; i++){ const a = rnd() * Math.PI * 2, bulge = Math.exp(-Math.pow(Math.atan2(Math.sin(a), Math.cos(a)) / 0.55, 2));
    const w = gauss() * (0.06 + 0.12 * bulge); const v = G_DIR.clone().multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a)).addScaledVector(N_G, w).normalize();
    if (rnd() > 0.35 + 0.65 * bulge) continue; pos.push(v.x * 9, v.y * 9, v.z * 9); const b = 0.25 + rnd() * 0.35; col.push(b, b * 0.93, b * 0.82); siz.push(1.1); }
  const p = pointCloud(pos, col, siz, { scale: 1, min: 1, max: 4 }); p.material.uniforms.uScale.value = 9; starBox.add(p); starBox.userData.mat = p.material; }

// ================= EARTH + MOON (unit km, origin Earth center) =================
const earthGroup = new THREE.Group(); L_EARTH.scene.add(earthGroup);
const lonS = 127.02798, latS = 37.49804, phi = (lonS + 180) * Math.PI / 180, la = latS * Math.PI / 180;
const v0 = V(-Math.cos(phi) * Math.cos(la), Math.sin(la), Math.sin(phi) * Math.cos(la)).normalize();
const n0 = V(0, 1, 0).sub(v0.clone().multiplyScalar(v0.y)).normalize();
const Bsrc = new THREE.Matrix4().makeBasis(n0.clone().cross(v0).normalize(), v0, n0.clone().negate());
const Bdst = new THREE.Matrix4().makeBasis(EAST, UP_S, SOUTH);
earthGroup.quaternion.setFromRotationMatrix(Bdst.clone().multiply(Bsrc.clone().transpose()));
const SUN_DIR_EARTH = SUN0.clone().sub(E).normalize();
const earthMat = new THREE.ShaderMaterial({
  uniforms: { dayMap: { value: null }, nightMap: { value: null }, specMap: { value: null }, uSun: { value: SUN_DIR_EARTH }, uA: { value: 1 } },
  transparent: true,
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `uniform sampler2D dayMap, nightMap, specMap; uniform vec3 uSun; uniform float uA; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    #include <logdepthbuf_pars_fragment>
    void main(){
      #include <logdepthbuf_fragment>
      float d = dot(normalize(vN), uSun); vec3 day = texture2D(dayMap, vUv).rgb, night = texture2D(nightMap, vUv).rgb;
      float k = smoothstep(-0.12, 0.22, d); vec3 c = mix(night * vec3(1.6, 1.35, 1.0), day * (0.15 + 1.1 * max(d, 0.0)), k);
      vec3 vdir = normalize(cameraPosition - vW); vec3 h = normalize(uSun + vdir); c += texture2D(specMap, vUv).r * pow(max(dot(normalize(vN), h), 0.0), 40.0) * 0.45 * k;
      gl_FragColor = vec4(c, uA);
      #include <colorspace_fragment>
    }` });
const earth = new THREE.Mesh(new THREE.SphereGeometry(6371, 160, 80), earthMat); earthGroup.add(earth);
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
const earthClouds = new THREE.Mesh(new THREE.SphereGeometry(6384, 128, 64), cloudMat); earthGroup.add(earthClouds);
const atmMat = new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uSun: { value: SUN_DIR_EARTH }, uA: { value: 1 } },
  vertexShader: `varying vec3 vN; varying vec3 vW;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `uniform vec3 uSun; uniform float uA; varying vec3 vN; varying vec3 vW;
    #include <logdepthbuf_pars_fragment>
    void main(){
      #include <logdepthbuf_fragment>
      vec3 v = normalize(cameraPosition - vW); float f = pow(max(0.0, 0.78 - dot(-v, normalize(vN))), 2.4); float lit = 0.25 + 0.75 * smoothstep(-0.3, 0.4, dot(normalize(vN), uSun));
      gl_FragColor = vec4(vec3(0.35, 0.62, 1.0) * f * 1.6 * lit * uA, f * uA);
      #include <colorspace_fragment>
    }` });
earthGroup.add(new THREE.Mesh(new THREE.SphereGeometry(6371 * 1.03, 96, 48), atmMat));
const SUN_LIGHT_E = new THREE.DirectionalLight(0xffffff, 2.2); SUN_LIGHT_E.position.copy(SUN_DIR_EARTH); L_EARTH.scene.add(SUN_LIGHT_E); L_EARTH.scene.add(new THREE.AmbientLight(0x223344, 0.25));
const ED = pointCloud([0,0,0], [0.55,0.75,1.0], [1], { scale: 1, min: 13, max: 13 }); L_EARTH.scene.add(ED);
const MOON_DIR = EAST.clone().multiplyScalar(0.85).addScaledVector(UP_S, 0.25).addScaledVector(NORTH, 0.45).normalize();
const MOON = E.clone().addScaledVector(MOON_DIR, 3.844e8);
const moonMat = new THREE.MeshStandardMaterial({ roughness: 1 });
const moon = new THREE.Mesh(new THREE.SphereGeometry(1737, 96, 48), moonMat); moon.position.copy(MOON.clone().sub(E).multiplyScalar(1e-3)); L_EARTH.scene.add(moon);
const MD = pointCloud([moon.position.x, moon.position.y, moon.position.z], [0.8,0.8,0.8], [1], { scale: 1, min: 9, max: 9 }); L_EARTH.scene.add(MD);
{ const pts = []; const ax = MOON_DIR.clone(), ay = UP_S.clone().cross(ax).normalize().cross(ax).normalize().negate(); for (let i = 0; i <= 256; i++){ const a = i / 256 * Math.PI * 2; pts.push(ax.clone().multiplyScalar(Math.cos(a) * 384400).addScaledVector(ay, Math.sin(a) * 384400)); }
  const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8899bb, transparent: true, opacity: 0.35 })); L_EARTH.scene.add(orbit); L_EARTH.scene.userData.orbit = orbit; }

// ================= SOLAR SYSTEM (unit 1e9 m = 1,000,000 km) =================
const PLANETS = [
  ['수성', 0.387, 2440, 0xb1a89c, 1.3], ['금성', 0.723, 6052, 0xe8d3a1, 2.4], ['지구', 1.0, 6371, 0x4f8fe6, 0], ['화성', 1.524, 3390, 0xd0603a, 4.1],
  ['목성', 5.203, 69911, 0xd9b58c, 0.6], ['토성', 9.537, 58232, 0xe6d29a, 2.2], ['천왕성', 19.19, 25362, 0x9fe0e6, 5.0], ['해왕성', 30.07, 24622, 0x4b6fe0, 3.3]];
L_SOLAR.scene.add(new THREE.PointLight(0xffffff, 3, 0, 0)); L_SOLAR.scene.add(new THREE.AmbientLight(0x333333, 0.4));
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(0.696, 64, 32), new THREE.MeshBasicMaterial({ color: 0xfff1c0 })); L_SOLAR.scene.add(sunMesh);
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false }));
sunGlow.scale.set(0.12, 0.12, 1); L_SOLAR.scene.add(sunGlow);
const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc56a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sunHalo.scale.set(6.5, 6.5, 1); L_SOLAR.scene.add(sunHalo);
const PLANET_POS = {};
const LABELS = [];
const planetPts = { pos: [], col: [], siz: [] };
PLANETS.forEach(([name, a, rkm, color, ang]) => {
  const p = V(Math.cos(ang) * a * 149.6, 0, -Math.sin(ang) * a * 149.6);
  const m = new THREE.Mesh(new THREE.SphereGeometry(rkm / 1e6, 32, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.9 })); m.position.copy(p); L_SOLAR.scene.add(m);
  if (name === '토성'){ const ring = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.14, 64), new THREE.MeshBasicMaterial({ color: 0xd9c89a, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })); ring.position.copy(p); ring.rotation.x = 1.2; L_SOLAR.scene.add(ring); }
  PLANET_POS[name] = { p: p.clone().multiplyScalar(1e9), r: rkm * 1e3 };
  const c = new THREE.Color(color); planetPts.pos.push(p.x, p.y, p.z); planetPts.col.push(c.r, c.g, c.b); planetPts.siz.push(1e9);
  const pts = []; for (let i = 0; i <= 256; i++){ const t = i / 256 * Math.PI * 2; pts.push(V(Math.cos(t) * a * 149.6, 0, Math.sin(t) * a * 149.6)); }
  L_SOLAR.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x6f86b0, transparent: true, opacity: 0.4 })));
  if (name !== '지구') LABELS.push({ text: name, pos: p.clone().multiplyScalar(1e9), L: [10.3, 14.6] });
});
const planetDots = pointCloud(planetPts.pos, planetPts.col, planetPts.siz, { scale: 1, min: 14, max: 14 }); L_SOLAR.scene.add(planetDots);
{ const pos = [], col = [], siz = []; for (let i = 0; i < 5000; i++){ const r = (2.2 + rnd() * 1.1) * 149.6, a = rnd() * 7; pos.push(Math.cos(a) * r, gauss() * 4, Math.sin(a) * r); col.push(0.5, 0.45, 0.4); siz.push(1); }
  for (let i = 0; i < 7000; i++){ const r = (30 + rnd() * 20) * 149.6, a = rnd() * 7; pos.push(Math.cos(a) * r, gauss() * 60, Math.sin(a) * r); col.push(0.35, 0.4, 0.5); siz.push(1); }
  L_SOLAR.scene.add(pointCloud(pos, col, siz, { scale: 1, min: 1, max: 1.6 })); }
LABELS.push({ text: '태양', pos: SUN0.clone(), L: [9.6, 16.5] });
LABELS.push({ text: '소행성대', pos: V(2.7 * AU * 0.7, 0, 2.7 * AU * 0.7), L: [11.4, 12.6] });
LABELS.push({ text: '카이퍼 벨트', pos: V(-40 * AU * 0.7, 0, 40 * AU * 0.7), L: [12.8, 14.2] });

// ================= NEARBY STARS (unit ly) =================
{ const pos = [], col = [], siz = [];
  for (let i = 0; i < 9000; i++){ const r = 1.5 * LY / LY * 0 + Math.pow(rnd(), 1 / 3) * 2000; const v = V(gauss(), gauss() * 0.6, gauss()).normalize().multiplyScalar(r); pos.push(v.x, v.y, v.z);
    const t = rnd(); const c = t < 0.12 ? [0.7, 0.8, 1] : t < 0.6 ? [1, 0.95, 0.85] : [1, 0.75, 0.55]; const b = 0.5 + rnd() * 0.5; col.push(c[0] * b, c[1] * b, c[2] * b); siz.push(0.6 + rnd() * 1.4); }
  for (let i = 0; i < 6000; i++){ const v = V(gauss(), gauss(), gauss()).normalize().multiplyScalar(0.05 + rnd() * 1.4); pos.push(v.x, v.y, v.z); col.push(0.32, 0.36, 0.45); siz.push(0.002); }
  const p = pointCloud(pos, col, siz, { scale: 1, min: 1, max: 9 }); L_STARS.scene.add(p); L_STARS.scene.userData.mat = p.material; }
const sunStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe3a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false })); sunStar.scale.set(0.05, 0.05, 1); L_STARS.scene.add(sunStar);
const STAR_POS = {}, STAR_LOOK = { '알파 센타우리': [0xfff0c8, 2.2e-5], '시리우스': [0xcfe0ff, 3.5e-5], '베텔게우스': [0xff8a4a, 2.4e-4] };
const NAMED = [['알파 센타우리', 14.66, -60.8, 4.37], ['시리우스', 6.75, -16.7, 8.6], ['베가', 18.62, 38.8, 25], ['아크투루스', 14.26, 19.2, 37], ['카노푸스', 6.4, -52.7, 310], ['북극성', 2.53, 89.3, 433], ['베텔게우스', 5.92, 7.4, 548], ['리겔', 5.24, -8.2, 860]];
{ const pos = [], col = [], siz = [];
  NAMED.forEach(([n, ra, dec, d]) => { const a = ra / 24 * Math.PI * 2, b = dec * Math.PI / 180; const v = V(Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)).multiplyScalar(d);
    STAR_POS[n] = v.clone().multiplyScalar(LY); if (STAR_LOOK[n]){ const [hex, sz] = STAR_LOOK[n]; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp.scale.set(sz, sz, 1); sp.position.copy(v); L_STARS.scene.add(sp); }
    pos.push(v.x, v.y, v.z); col.push(1, 0.95, 0.85); siz.push(4); LABELS.push({ text: `${n} (${d}광년)`, pos: v.clone().multiplyScalar(LY), L: [d < 50 ? 16.4 : 18.4, d < 50 ? 18.4 : 19.6] }); });
  L_STARS.scene.add(pointCloud(pos, col, siz, { scale: 1, min: 3, max: 6 })); }
LABELS.push({ text: '오르트 구름', pos: V(0.7, 0.3, 0.6).normalize().multiplyScalar(0.8 * LY), L: [15.2, 16.4] });

// ================= MILKY WAY (unit 1000 ly, local plane xz, normal y) =================
const galaxy = new THREE.Group(); galaxy.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(G_DIR, N_G, G_DIR.clone().cross(N_G).normalize())); L_GAL.scene.add(galaxy);
{ const pos = [], col = [], siz = [];
  for (let i = 0; i < 160000; i++){
    const arm = i % 4, r = Math.min(52, -Math.log(1 - rnd() * 0.985) * 11 + 1.5), pitch = 0.22;
    const inArm = rnd() < 0.72; const th = arm * Math.PI / 2 + Math.log(r / 2) / Math.tan(pitch) + (inArm ? gauss() * 0.16 : rnd() * Math.PI / 2);
    const x = Math.cos(th) * r + gauss() * 0.5, z = Math.sin(th) * r + gauss() * 0.5, y = gauss() * (0.35 + 0.6 * Math.exp(-r / 6));
    pos.push(x, y, z); const t = rnd(); const hot = Math.exp(-r / 7);
    let c = t < 0.03 && inArm ? [1, 0.45, 0.6] : [0.75 + 0.25 * hot, 0.8 + 0.1 * hot, 1 - 0.35 * hot]; const b = (inArm ? 0.4 : 0.16) + rnd() * 0.4; col.push(c[0] * b, c[1] * b, c[2] * b); siz.push(0.25 + rnd() * 0.35); }
  for (let i = 0; i < 30000; i++){ const v = V(gauss() * 2.6, gauss() * 1.5, gauss() * 2.6); pos.push(v.x, v.y, v.z); const b = 0.45 + rnd() * 0.4; col.push(b, b * 0.85, b * 0.6); siz.push(0.3); }
  const p = pointCloud(pos, col, siz, { scale: 1, min: 1, max: 3 }); galaxy.add(p); L_GAL.scene.userData.mat = p.material; }
const sunInGal = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false }));
sunInGal.scale.set(0.035, 0.035, 1); sunInGal.position.copy(SUN0.clone().sub(G).multiplyScalar(1 / KLY)); L_GAL.scene.add(sunInGal);
LABELS.push({ text: '★ 여기가 우리 태양계', pos: SUN0.clone(), L: [19.6, 22.2], hi: true });
LABELS.push({ text: '우리 은하 중심 (2만 6천 광년)', pos: G.clone(), L: [20.0, 21.8] });

// ================= LOCAL GROUP & COSMIC WEB (unit 1,000,000 ly) =================
function galaxySprite(tint){ return canvasTex(256, 256, (g) => { g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5000; i++){ const arm = i % 2, r = Math.pow(rnd(), 0.8) * 110, th = arm * Math.PI + r / 22 + gauss() * 0.35; const x = 128 + Math.cos(th) * r, y = 128 + Math.sin(th) * r * 0.42;
    g.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},0.18)`; g.fillRect(x, y, 2, 2); }
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 40); gr.addColorStop(0, 'rgba(255,240,210,0.9)'); gr.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }); }
function galaxyBillboard(texture, sizeMly, pos, quat){ const m = new THREE.Mesh(new THREE.PlaneGeometry(sizeMly, sizeMly), new THREE.MeshBasicMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.position.copy(pos); if (quat) m.quaternion.copy(quat); L_COS.scene.add(m); return m; }
const mwTex = galaxySprite([190, 210, 255]);
const mwBoard = galaxyBillboard(mwTex, 0.16, V(0, 0, 0), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), N_G));
const m31Board = galaxyBillboard(galaxySprite([220, 210, 255]), 0.3, M31.clone().sub(G).multiplyScalar(1 / MLY), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.2, 0.4, 0.3)));
galaxyBillboard(galaxySprite([200, 220, 255]), 0.06, M31.clone().sub(G).multiplyScalar(1 / MLY).add(V(0.35, -0.2, 0.25)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.0, 0.2)));
LABELS.push({ text: '우리 은하', pos: G.clone(), L: [22.0, 23.6] });
LABELS.push({ text: '안드로메다 은하 (250만 광년)', pos: M31.clone(), L: [22.1, 23.9] });
LABELS.push({ text: '삼각형자리 은하', pos: M31.clone().add(V(0.35, -0.2, 0.25).multiplyScalar(MLY)), L: [22.3, 23.3] });
{ const pos = [], col = [], siz = []; const nodes = [];
  for (let i = 0; i < 260; i++) nodes.push(V(gauss(), gauss(), gauss()).normalize().multiplyScalar(30 + Math.pow(rnd(), 0.6) * 900));
  nodes.push(V(30, 25, -38));
  for (let i = 0; i < nodes.length; i++){ const a = nodes[i]; const near = nodes.map((b, j) => [a.distanceTo(b), j]).sort((x, y) => x[0] - y[0]).slice(1, 4);
    near.forEach(([d, j]) => { const b = nodes[j]; const n = Math.floor(d * 1.4); for (let k = 0; k < n; k++){ const t = rnd(); const p = a.clone().lerp(b, t).add(V(gauss(), gauss(), gauss()).multiplyScalar(4 + 6 * Math.sin(t * Math.PI)));
      pos.push(p.x, p.y, p.z); const c = rnd(); col.push(0.55 + 0.3 * c, 0.6 + 0.2 * c, 0.9); siz.push(1); } });
    for (let k = 0; k < 120; k++){ const p = a.clone().add(V(gauss(), gauss(), gauss()).multiplyScalar(5)); pos.push(p.x, p.y, p.z); col.push(1, 0.85, 0.7); siz.push(1.3); } }
  const p = pointCloud(pos, col, siz, { scale: 1, min: 1, max: 2.6 }); L_COS.scene.add(p); L_COS.scene.userData.mat = p.material; L_COS.scene.userData.web = p;
  LABELS.push({ text: '처녀자리 은하단 (5,400만 광년)', pos: G.clone().add(V(30, 25, -38).multiplyScalar(MLY)), L: [23.6, 25.2] }); }

// ---------- labels DOM ----------
LABELS.push({ text: '서울 강남', pos: S.clone(), L: [4.4, 6.9] }); LABELS.push({ text: '달 (38만 km)', pos: MOON.clone(), L: [7.9, 9.9] }); LABELS.push({ text: '지구', pos: E.clone(), L: [8.3, 11.8] });
LABELS.forEach(l => { const d = document.createElement('div'); d.className = 'lbl'; d.textContent = l.text; if (l.hi) d.style.color = '#ffe08a'; document.body.appendChild(d); l.el = d; });

// ---------- milestones ----------
const MILE = [[0, '강남역', '실제 지도 데이터로 만든 강남대로 — Space를 누르고 있으면 하늘로'], [1.6, '강남대로 위로', '고도 40 m'], [2.6, '강남역 사거리', '고도 400 m — 테헤란로와 강남대로'], [3.4, '강남 일대', '북쪽으로 한강이 보여요'],
  [4.0, '구름 위', '고도 10 km — 여객기 순항 고도'], [5.0, '카르만 선', '고도 100 km — 여기서부터 우주'], [5.6, '국제우주정거장 고도', '약 400 km'], [7.2, '푸른 행성, 지구', '지름 12,742 km'],
  [8.7, '달 궤도', '지구에서 약 38만 km'], [10.6, '내행성계', '수성 · 금성 · 지구 · 화성'], [12.6, '태양계', '해왕성까지 약 45억 km'], [15.4, '오르트 구름', '혜성들의 고향, 약 1광년'],
  [16.7, '가장 가까운 별들', '빛으로 4년 넘게 가야 하는 거리'], [18.6, '태양 이웃의 별들', '수백 광년'], [20.4, '우리 은하', '지름 약 10만 광년, 별 수천억 개'], [22.4, '국부 은하군', '안드로메다 은하까지 250만 광년'], [24.5, '우주 거대구조', '은하들이 그물처럼 이어진 우주']];
let mileIdx = -1, capTimer = 0;
function showCaption(i){ $('capt').textContent = MILE[i][1]; $('caps').textContent = MILE[i][2]; $('cap').style.opacity = 1; capTimer = 4.2; try { Sound.chime(i); } catch(e){} }

// ---------- sound (procedural) ----------
const Sound = (() => { let ac, master, wind, windF, drone, city, on = true;
  function noise(sec){ const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  return {
    start(){ if (ac){ if (ac.state === 'suspended') ac.resume(); return; } ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ac.destination);
      const n = ac.createBufferSource(); n.buffer = noise(4); n.loop = true; windF = ac.createBiquadFilter(); windF.type = 'bandpass'; windF.Q.value = 0.6; wind = ac.createGain(); wind.gain.value = 0; n.connect(windF); windF.connect(wind); wind.connect(master); n.start();
      const n2 = ac.createBufferSource(); n2.buffer = noise(3); n2.loop = true; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; city = ac.createGain(); city.gain.value = 0; n2.connect(lp); lp.connect(city); city.connect(master); n2.start();
      drone = ac.createGain(); drone.gain.value = 0; drone.connect(master); [55, 82.41, 110, 164.8, 246.9].forEach((f, i) => { const o = ac.createOscillator(); o.type = i < 3 ? 'sine' : 'triangle'; o.frequency.value = f; const g = ac.createGain(); g.gain.value = i < 3 ? 0.22 : 0.05;
        const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 0.05 + i * 0.03; lg.gain.value = 0.08; l.connect(lg); lg.connect(g.gain); l.start(); o.connect(g); g.connect(drone); o.start(); }); },
    update(L, climb){ if (!ac) return; const t = ac.currentTime;
      wind.gain.setTargetAtTime((0.02 + Math.min(0.12, Math.abs(climb) * 0.1)) * (1 - sstep(4.6, 5.4, L)) * (L > 0.6 ? 1 : 0.3), t, 0.3); windF.frequency.setTargetAtTime(280 + Math.min(1, Math.abs(climb)) * 900, t, 0.3);
      city.gain.setTargetAtTime(0.05 * (1 - sstep(1.0, 3.2, L)), t, 0.5); drone.gain.setTargetAtTime(0.09 * sstep(4.8, 6.5, L), t, 1.2);
      if (L < 1.4 && Math.random() < 0.012){ const o = ac.createOscillator(), g = ac.createGain(), f = 2600 + Math.random() * 1600; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.08);
        g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16); } },
    chime(i){ if (!ac || !on) return; const t = ac.currentTime, base = [523.25, 587.33, 659.25, 783.99, 880][i % 5];
      [1, 2, 3.01].forEach((r, k) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = base * r * (i > 12 ? 0.5 : 1); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 / (k + 1), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6); o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.7); }); },
    whoosh(){ if (!ac || !on) return; const t = ac.currentTime, n = ac.createBufferSource(); n.buffer = noise(3); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(2400, t + 1.2); f.frequency.exponentialRampToValueAtTime(300, t + 2.8);
      const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9); n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t + 3); },
    toggle(){ on = !on; if (ac) master.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.2); return on; } }; })();

// ---------- FREE FLIGHT (자유 비행) ----------
const toSun = (P) => SUN0.clone().sub(P).normalize();
const tilt = (d, up, a, b) => { const r = up.clone().cross(d).normalize(); return d.clone().applyAxisAngle(up, a).applyAxisAngle(r, -b).normalize(); };
const Y = V(0, 1, 0);
function planetDest(name, sub, mult = 4){ const P = PLANET_POS[name]; return { name, sub, P: P.p, r: P.r, d: P.r * mult, D: tilt(toSun(P.p), Y, 0.55, 0.28) }; }
const DESTS = [
  { name: '강남역', sub: '실제 지도 데이터로 만든 강남대로', P: S.clone(), r: 150, d: 950, D: UP_S.clone().multiplyScalar(0.55).addScaledVector(SOUTH, 0.83).normalize(), town: true },
  { name: '지구', sub: '지름 12,742 km', P: E.clone(), r: R_E, d: 3.3 * R_E, D: tilt(toSun(E), Y, 0.75, 0.3) },
  { name: '달', sub: '지구에서 약 38만 km · 지름 3,474 km', P: MOON.clone(), r: 1.737e6, d: 4.2 * 1.737e6, D: tilt(toSun(MOON), Y, 0.6, 0.25) },
  { name: '태양', sub: '지름 약 139만 km — 지구 109개를 늘어놓은 크기', P: SUN0.clone(), r: 6.96e8, d: 6 * 6.96e8, D: tilt(V(1, 0, 0), Y, 0.5, 0.35) },
  planetDest('수성', '태양에서 가장 가까운 행성'), planetDest('금성', '두꺼운 구름에 덮인 행성'), planetDest('화성', '붉은 행성 · 지름 6,779 km'),
  planetDest('목성', '태양계에서 가장 큰 행성'), planetDest('토성', '고리를 두른 행성', 7), planetDest('천왕성', '옆으로 누운 채 도는 얼음 행성'), planetDest('해왕성', '태양에서 약 45억 km'),
  { name: '알파 센타우리', sub: '태양에서 가장 가까운 별 · 4.37광년', P: () => STAR_POS['알파 센타우리'], r: 2e10, d: 2.0e-5 * LY * 3, D: V(0.3, 0.4, 0.86).normalize() },
  { name: '시리우스', sub: '밤하늘에서 가장 밝은 별 · 8.6광년', P: () => STAR_POS['시리우스'], r: 2e10, d: 3.5e-5 * LY * 3, D: V(-0.4, 0.3, 0.86).normalize() },
  { name: '베텔게우스', sub: '붉은 초거성 · 약 548광년', P: () => STAR_POS['베텔게우스'], r: 2e11, d: 2.4e-4 * LY * 3, D: V(0.5, 0.3, -0.8).normalize() },
  { name: '우리 은하 중심', sub: '지구에서 약 2만 6천 광년', P: G.clone(), r: 5 * KLY, d: 70 * KLY, D: N_G.clone().multiplyScalar(0.8).addScaledVector(G_DIR, -0.6).normalize() },
  { name: '안드로메다 은하', sub: '약 250만 광년 떨어진 이웃 은하', P: M31.clone(), r: 50 * KLY, d: 0.36 * MLY, D: V(0, 0, 1).applyQuaternion(m31Board.quaternion).applyAxisAngle(V(1, 0, 0), 0.5).normalize() },
];
const destP = (de) => (typeof de.P === 'function' ? de.P() : de.P).clone();
const fl = { T: S.clone(), d: 950, D: DESTS[0].D.clone(), minD: 160, fly: null, dest: null };
function upFor(eyeLeff, nearTown){ let u = Y.clone().lerp(N_G, sstep(18.8, 20.4, eyeLeff)).normalize(); return u.lerp(UP_S, nearTown).normalize(); }
function leffOf(eye){ return Math.log10(Math.max(1.6, eye.distanceTo(E) - R_E)); }
function enterFree(eye, q, h){ const fwd = V(0, 0, -1).applyQuaternion(q); const dd = Math.max(5, h); fl.T = eye.clone().addScaledVector(fwd, dd); fl.d = dd; fl.D = fwd.clone().negate(); fl.minD = 2; fl.fly = null; }
function flyTo(de){ const T1 = destP(de); const d1 = de.d, D1 = de.D.clone();
  const sep = T1.distanceTo(fl.T), l0 = Math.log10(fl.d), l1 = Math.log10(d1);
  const peak = Math.max(l0, l1, Math.log10(Math.max(1, sep * 1.25)));
  const dur = Math.min(9, 2.6 + 0.22 * Math.abs(l1 - l0) + 0.35 * Math.max(0, peak - Math.max(l0, l1)));
  fl.fly = { t: 0, dur, T0: fl.T.clone(), T1, l0, l1, peak, D0: fl.D.clone(), D1, de }; fl.dest = de; fl.minD = de.r * 1.15;
  document.querySelectorAll('#dest button').forEach(b => b.classList.toggle('on', b.textContent === de.name)); try { Sound.whoosh && Sound.whoosh(); } catch(e){} }
function freeCamera(dt){
  if (fl.fly){ const F = fl.fly; F.t += dt; const s = Math.min(1, F.t / F.dur), e = s * s * (3 - 2 * s);
    const u = sstep(0.18, 0.82, s); fl.T = F.T0.clone().lerp(F.T1, u);
    const base = lerp(F.l0, F.l1, e), bump = Math.max(0, F.peak - Math.max(F.l0, F.l1)) + 0.25;
    fl.d = Math.pow(10, base + bump * Math.sin(Math.PI * e) * (F.peak > Math.max(F.l0, F.l1) ? 1 : 0.4));
    fl.D = F.D0.clone().lerp(F.D1, e).normalize();
    if (s >= 1){ fl.fly = null; const de = F.de; $('capt').textContent = de.name; $('caps').textContent = de.sub; $('cap').style.opacity = 1; capTimer = 4.5; try { Sound.chime(DESTS.indexOf(de)); } catch(e){} } }
  const eye0 = fl.T.clone().addScaledVector(fl.D, fl.d); const Le = leffOf(eye0);
  const nearTown = 1 - sstep(4.5, 6.0, Le); const up = upFor(Le, nearTown);
  // keep D away from the pole
  const c = fl.D.dot(up); if (Math.abs(c) > 0.985){ fl.D.addScaledVector(up, -(c - Math.sign(c) * 0.985)).normalize(); }
  const eye = fl.T.clone().addScaledVector(fl.D, fl.d);
  mTmp.lookAt(eye, fl.T, up); qTmp.setFromRotationMatrix(mTmp);
  return { eye, q: qTmp.clone(), h: Math.max(1.6, eye.distanceTo(E) - R_E), L: Le, up };
}
function freeRotate(dx, dy){ if (fl.fly) return; const eye = fl.T.clone().addScaledVector(fl.D, fl.d); const up = upFor(leffOf(eye), 1 - sstep(4.5, 6.0, leffOf(eye)));
  const right = up.clone().cross(fl.D).normalize(); fl.D.applyAxisAngle(up, -dx * 0.005).applyAxisAngle(right, dy * 0.005).normalize(); }
function freeZoom(k){ if (fl.fly) return; fl.d = Math.max(fl.minD, Math.min(3e25, fl.d * Math.exp(k))); }

// ---------- state & input ----------
const st = { L: Math.log10(1.6), Lt: Math.log10(1.6), px: 21, pz: 45, yaw: -0.05, pitch: 0.05, az: 0, el: 0, auto: false, upHeld: false, climb: 0, free: false };
const keys = {};
const LMIN = Math.log10(1.6), LMAX = 26.2;
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => { Sound.start(); drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; renderer.domElement.style.cursor = 'grabbing'; });
addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (st.free){ freeRotate(dx, dy); return; }
  if (st.L < 2.6){ st.yaw += dx * 0.005; st.pitch = Math.max(-1.45, Math.min(1.4, st.pitch - dy * 0.005)); }
  else { st.az -= dx * 0.005; st.el = Math.max(-1.2, Math.min(1.2, st.el + dy * 0.005)); } });
addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id){ drag = null; renderer.domElement.style.cursor = 'grab'; } });
renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); if (st.free){ freeZoom(e.deltaY * 0.0016); return; } st.auto = false; $('auto').classList.remove('on'); st.Lt = Math.max(LMIN, Math.min(LMAX, st.Lt + e.deltaY * 0.0025)); }, { passive: false });
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); Sound.start(); });
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; st.upHeld = false; });
const upBtn = $('up'); ['pointerdown'].forEach(ev => upBtn.addEventListener(ev, e => { e.stopPropagation(); Sound.start(); st.upHeld = true; }));
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => upBtn.addEventListener(ev, () => { st.upHeld = false; }));
$('auto').onclick = (e) => { Sound.start(); st.auto = !st.auto; e.target.classList.toggle('on', st.auto); if (st.auto && st.L > 25.5){ st.L = st.Lt = LMIN; } };
function setFree(on){ st.free = on; $('free').classList.toggle('on', on); $('dest').style.display = on ? 'flex' : 'none'; $('auto').style.display = on ? 'none' : ''; 
  if (on){ st.auto = false; $('auto').classList.remove('on'); enterFree(window.__eye || S.clone().addScaledVector(UP_S, 2), window.__q || new THREE.Quaternion(), Math.pow(10, st.L)); }
  else { st.L = st.Lt = Math.max(LMIN, Math.min(LMAX, st.L)); st.az = 0; st.el = 0; mileIdx = -1; } }
window.__free = { DESTS, flyTo, fl, setFree: (o) => setFree(o) };
$('free').onclick = () => { Sound.start(); setFree(!st.free); };
{ const box = $('dest'); DESTS.forEach(de => { const b = document.createElement('button'); b.textContent = de.name; b.onclick = (e) => { e.stopPropagation(); Sound.start(); if (!st.free) setFree(true); flyTo(de); }; box.appendChild(b); }); }
$('home').onclick = () => { if (st.free){ flyTo(DESTS[0]); return; } st.auto = false; $('auto').classList.remove('on'); st.Lt = LMIN; st.az = 0; st.el = 0; };
$('snd').onclick = (e) => { Sound.start(); e.target.classList.toggle('on', Sound.toggle()); };
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); });


// ---------- camera solve (universal, float64) ----------
const qTmp = new THREE.Quaternion(), mTmp = new THREE.Matrix4();
function solveCamera(){
  const L = st.L, h = Math.pow(10, L);
  const fLocal = V(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), -Math.cos(st.yaw) * Math.cos(st.pitch));
  const down = sstep(1.0, 2.6, L), p = lerp(st.pitch, -1.45, down);
  const fL = V(Math.sin(st.yaw) * Math.cos(p), Math.sin(p), -Math.cos(st.yaw) * Math.cos(p));
  if (L < 2.6){
    const local = V(st.px, h, st.pz); const eye = local.clone().applyQuaternion(Q_TOWN).add(S);
    const fU = fL.clone().applyQuaternion(Q_TOWN); const upU = UP_S.clone();
    mTmp.lookAt(V(0, 0, 0), fU, upU); qTmp.setFromRotationMatrix(mTmp);
    return { eye, q: qTmp.clone(), h };
  }
  // ground target where the descending camera looks
  const k = h / Math.max(0.05, -fL.y); const tLocal = V(st.px + fL.x * k, 0, st.pz + fL.z * k);
  const Tg = tLocal.applyQuaternion(Q_TOWN).add(S);
  const w1 = sstep(6.6, 7.4, L), w2 = sstep(10.0, 11.3, L), w3 = sstep(18.6, 20.4, L), w4 = sstep(22.3, 23.1, L);
  const T = Tg.clone().lerp(E, w1).lerp(SUN0, w2).lerp(G, w3).lerp(LG, w4);
  let D = fL.clone().negate().applyQuaternion(Q_TOWN).normalize();
  const dSol = V(0, Math.cos(0.45), Math.sin(0.45)).normalize();
  const perpG = N_G.clone().cross(G_DIR).normalize(); const dGal = N_G.clone().multiplyScalar(Math.cos(0.62)).addScaledVector(perpG, Math.sin(0.62)).normalize();
  const dCos = dGal.clone().addScaledVector(M31_DIR.clone().cross(N_G).normalize(), 0.5).normalize();
  D.lerp(dSol, sstep(9.2, 10.8, L)).normalize(); D.lerp(dGal, sstep(18.8, 20.4, L)).normalize(); D.lerp(dCos, w4).normalize();
  let upRef = NORTH.clone().lerp(V(0, 1, 0), sstep(9.2, 10.8, L)).lerp(N_G, sstep(18.8, 20.4, L)).normalize();
  // user orbit offsets (+ an oblique 'orbital' angle around low Earth orbit to show the curved horizon)
  const right = upRef.clone().cross(D).normalize();
  const obl = 1.05 * sstep(4.6, 5.4, L) * (1 - sstep(6.4, 7.2, L));
  D.applyAxisAngle(right, -st.el - obl).applyAxisAngle(upRef, st.az).normalize();
  const dist = h + w1 * R_E;
  const eye = T.clone().addScaledVector(D, dist);
  mTmp.lookAt(eye, T, upRef); qTmp.setFromRotationMatrix(mTmp);
  return { eye, q: qTmp.clone(), h };
}

// ---------- formatting ----------
function fmtAlt(h){
  if (h < 10) return `${h.toFixed(1)} m`; if (h < 1000) return `${Math.round(h)} m`; if (h < 1e7) return `${(h / 1000).toLocaleString('ko-KR', { maximumFractionDigits: h < 1e5 ? 1 : 0 })} km`;
  if (h < 0.05 * AU) return `${Math.round(h / 1e7).toLocaleString('ko-KR')}만 km`; if (h < 3000 * AU) return `${(h / AU).toLocaleString('ko-KR', { maximumFractionDigits: h < 10 * AU ? 2 : 0 })} AU`;
  const ly = h / LY; if (ly < 1e4) return `${ly.toLocaleString('ko-KR', { maximumFractionDigits: ly < 10 ? 2 : 0 })} 광년`; if (ly < 1e8) return `${(ly / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}만 광년`;
  return `${(ly / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 광년`; }

// ---------- frame ----------
let last = performance.now(), fpsA = 0, fpsN = 0;
const knob = $('knob');
function frame(now){
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  // input -> altitude target
  const climbKey = st.free ? 0 : (keys.Space || st.upHeld ? 1 : 0) + (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
  if (st.free){ const z = (keys.KeyS || keys.KeyQ ? 1 : 0) - (keys.KeyW || keys.KeyE || keys.Space || st.upHeld ? 1 : 0); if (z) freeZoom(z * 1.6 * dt); }
  if (climbKey){ st.auto = false; $('auto').classList.remove('on'); st.Lt = Math.max(LMIN, Math.min(LMAX, st.Lt + climbKey * (keys.ShiftLeft || keys.ShiftRight ? 1.4 : 0.65) * dt)); }
  if (st.auto){ const nearMile = MILE.some(m => Math.abs(m[0] - st.Lt) < 0.12); st.Lt = Math.min(LMAX, st.Lt + (nearMile ? 0.16 : 0.42) * dt); st.az *= 0.99; st.el *= 0.99; if (st.Lt >= LMAX){ st.auto = false; $('auto').classList.remove('on'); } }
  const prevL = st.L; st.L += (st.Lt - st.L) * Math.min(1, dt * 2.6); st.climb = (st.L - prevL) / Math.max(dt, 1e-3);
  if (st.L < 1.0 && !st.free){ const sp = (keys.ShiftLeft || keys.ShiftRight ? 9 : 4) * dt; const fw = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), sd = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    st.px += (Math.sin(st.yaw) * fw + Math.cos(st.yaw) * sd) * sp; st.pz += (-Math.cos(st.yaw) * fw + Math.sin(st.yaw) * sd) * sp; }
  let eye, q, h, L;
  if (st.free){ const fc = freeCamera(dt); eye = fc.eye; q = fc.q; h = fc.h; st.climb = (fc.L - st.L) / Math.max(dt, 1e-3); st.L = st.Lt = fc.L; L = fc.L; }
  else { ({ eye, q, h } = solveCamera()); L = st.L; }
  window.__eye = eye; window.__q = q;
  // layer visibility / fades
  const aTown = 1 - sstep(4.7, 5.3, L), aRegion = 1 - sstep(4.85, 5.45, L), aEarth = sstep(4.5, 5.1, L) * (1 - sstep(10.6, 11.4, L));
  const aSolar = sstep(9.3, 10.0, L) * (1 - sstep(16.2, 17.2, L)); let aStars = sstep(14.4, 15.4, L) * (1 - sstep(20.6, 21.6, L)); const aGal = sstep(18.9, 19.9, L) * (1 - sstep(23.6, 24.4, L)), aCos = sstep(21.8, 22.6, L);
  const aSky = 1 - sstep(4.3, 5.2, L), aStarBox = (1 - sstep(19.4, 20.2, L));
  L_TOWN.scene.visible = aTown > 0.003; region.material.opacity = aRegion; region.visible = aRegion > 0.003;
  clouds.visible = L > 2.4 && L < 5.2; clouds.children.forEach(c => c.material.opacity = 0.85 * sstep(2.4, 3.1, L) * (1 - sstep(4.3, 5.0, L)));
  L_TOWN.scene.fog.density = 0.00012 * Math.pow(10, -0.55 * Math.max(0, L - 0.2)); L_TOWN.scene.fog.color.setRGB(0.74, 0.83, 0.92);
  earthMat.uniforms.uA.value = aEarth; atmMat.uniforms.uA.value = aEarth; cloudMat.opacity = 0.85 * aEarth; moonMat.opacity = aEarth; moonMat.transparent = true; L_EARTH.scene.visible = aEarth > 0.003;
  L_EARTH.scene.userData.orbit.material.opacity = 0.35 * sstep(8.0, 8.8, L) * aEarth; ED.material.uniforms.uOpacity.value = sstep(8.0, 8.6, L) * aEarth; MD.material.uniforms.uOpacity.value = sstep(8.2, 8.7, L) * aEarth;
  L_SOLAR.scene.visible = aSolar > 0.003; L_SOLAR.scene.traverse(o => { if (o.material && o !== sunMesh){ o.material.transparent = true; if (o.material.uniforms) o.material.uniforms.uOpacity.value = aSolar; else if (o.material.userData.baseOp === undefined) o.material.userData.baseOp = o.material.opacity ?? 1; if (!o.material.uniforms) o.material.opacity = o.material.userData.baseOp * aSolar; } });
  { let dmin = Infinity; for (const k in PLANET_POS) dmin = Math.min(dmin, eye.distanceTo(PLANET_POS[k].p)); planetDots.material.uniforms.uOpacity.value = aSolar * sstep(8.6, 9.8, Math.log10(dmin));
    sunHalo.material.opacity = aSolar * (1 - sstep(10.3, 11.0, Math.log10(eye.distanceTo(SUN0)))); }
  if (st.free){ const far = sstep(3.4, 3.9, Math.log10(Math.max(1, eye.distanceTo(SUN0) / LY))); aStars *= 1 - far; }
  L_STARS.scene.visible = aStars > 0.003; L_STARS.scene.traverse(o => { if (o.material && o.material.uniforms) o.material.uniforms.uOpacity.value = aStars; else if (o.material) o.material.opacity = aStars; });
  L_GAL.scene.visible = aGal > 0.003; L_GAL.scene.userData.mat.uniforms.uOpacity.value = aGal; sunInGal.material.opacity = aGal;
  L_COS.scene.visible = aCos > 0.003; L_COS.scene.userData.mat.uniforms.uOpacity.value = aCos * sstep(23.2, 24.1, L); L_COS.scene.traverse(o => { if (o.isMesh) o.material.opacity = aCos * (1 - 0.6 * sstep(24, 25, L)); });
  skyMat.uniforms.uA.value = aSky; starBox.userData.mat.uniforms.uOpacity.value = aStarBox;
  earthClouds.rotation.y += dt * 0.004;
  // sun shadow follows the camera near the ground
  sunLight.castShadow = L < 2.4; MARKS.forEach(m => m.visible = L < 2.9);
  if (PAVE.mesh && (L > 3.0) !== PAVE.far){ PAVE.far = L > 3.0; PAVE.mesh.material.map = PAVE.far ? null : PAVE.map; PAVE.mesh.material.color.setHex(PAVE.far ? 0x96948f : 0xb4b2ad); PAVE.mesh.material.needsUpdate = true; }
  if (L < 2.4){ const camT = eye.clone().sub(S); const gnd = camT.clone().addScaledVector(UP_S, -Math.min(h, 200)); sunLight.target.position.copy(gnd); sunLight.position.copy(gnd).addScaledVector(SUN_DIR_SEOUL, 1200); sunLight.target.updateMatrixWorld(); }
  // render
  renderer.clear();
  skyCam.quaternion.copy(q); skyCam.aspect = innerWidth / innerHeight; skyCam.updateProjectionMatrix();
  if (aStarBox > 0.003){ renderer.render(starBox, skyCam); }
  if (aSky > 0.003){ renderer.clearDepth(); renderer.render(skyDome, skyCam); }
  for (const Ly of LAYERS_FAR_TO_NEAR){ if (!Ly.scene.visible) continue;
    Ly.cam.position.copy(eye.clone().sub(Ly.origin).multiplyScalar(1 / Ly.unit)); Ly.cam.quaternion.copy(q);
    Ly.cam.aspect = innerWidth / innerHeight; Ly.cam.updateProjectionMatrix(); Ly.cam.updateMatrixWorld();
    renderer.clearDepth(); renderer.render(Ly.scene, Ly.cam); }
  // labels
  const qi = q.clone().invert(), f = (innerHeight / 2) / Math.tan(30 * Math.PI / 180);
  for (const l of LABELS){ const vis = sstep(l.L[0], l.L[0] + 0.3, L) * (1 - sstep(l.L[1] - 0.3, l.L[1], L));
    if (vis < 0.02){ l.el.style.opacity = 0; continue; }
    const v = l.pos.clone().sub(eye).applyQuaternion(qi); if (v.z >= 0){ l.el.style.opacity = 0; continue; }
    const x = innerWidth / 2 + v.x / -v.z * f, y = innerHeight / 2 - v.y / -v.z * f;
    if (x < -50 || x > innerWidth + 50 || y < -50 || y > innerHeight + 50){ l.el.style.opacity = 0; continue; }
    l.el.style.left = x + 'px'; l.el.style.top = y + 'px'; l.el.style.opacity = vis; }
  // HUD
  $('altv').textContent = (st.free ? '지구에서 ' : '') + fmtAlt(h); $('altp').textContent = `10^${L.toFixed(1)} m`;
  knob.style.top = (100 - L / 26.2 * 100) + '%';
  let mi = 0; for (let i = 0; i < MILE.length; i++) if (L >= MILE[i][0] - 0.05) mi = i;
  if (mi !== mileIdx && !st.free){ mileIdx = mi; showCaption(mi); }
  capTimer -= dt; if (capTimer < 0) $('cap').style.opacity = 0;
  upBtn.textContent = st.free ? '▲ 누르고 있으면 가까이' : (st.L < 2.6 ? '▲ 누르고 있으면 상승' : '▲ 더 멀리');
  Sound.update(L, st.climb);
  fpsA += dt; fpsN++; if (fpsA > 0.5){ $('fps').textContent = `${Math.round(fpsN / fpsA)} fps`; fpsA = 0; fpsN = 0; }
  window.__st = st; window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}

// ---------- boot ----------
(async () => {
  try {
    $('lmsg').textContent = '지구 텍스처 불러오는 중…';
    const [day, night, spec, cloudsT, moonT] = await Promise.all([tex('earth_day.jpg'), tex('earth_night.png'), tex('earth_spec.jpg', false), tex('earth_clouds.png', false), tex('moon.jpg')]);
    earthMat.uniforms.dayMap.value = day; earthMat.uniforms.nightMap.value = night; earthMat.uniforms.specMap.value = spec;
    cloudMat.alphaMap = cloudsT; cloudMat.needsUpdate = true; moonMat.map = moonT; moonMat.needsUpdate = true;
  } catch (e){ $('lmsg').textContent = '텍스처 일부를 불러오지 못했어요: ' + e.message; }
  try { $('lmsg').textContent = '강남역 실제 건물 불러오는 중…'; const nv = await loadGangnam(); $('lmsg').textContent = `준비 완료 — 강남역 주변 실제 건물 약 1만 동`; }
  catch (e){ $('lmsg').textContent = '건물 데이터를 불러오지 못했어요: ' + e.message; }
  $('go').style.display = 'block';
  $('go').onclick = () => { Sound.start(); $('load').style.opacity = 0; setTimeout(() => $('load').remove(), 600); };
  requestAnimationFrame(frame);
})();
