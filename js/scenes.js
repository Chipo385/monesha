import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateLandscape, makeNoise, sample, mulberry32 } from './terrain.js';
import { addLights, treeMesh, yardGroup, LOW, lin, linearizeUnlit, srgbVertexColors, waterMesh } from './detail.js';

// Colours are authored in sRGB and passed straight through.
THREE.ColorManagement.enabled = false;

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = window.matchMedia('(pointer: coarse)').matches;
// Phones and low-end machines render at a lower pixel ratio with lighter trees (see detail.js).
const DPR = () => Math.min(window.devicePixelRatio || 1, LOW ? 1.5 : 2);

/* ------------------------------------------------------------------ */
/* Shared viewer                                                       */
/* ------------------------------------------------------------------ */

function createViewer(canvas, { camPos, target = [0, 0, 0], autoRotate = 0.35, minDist = 6, maxDist = 22, orbit = true }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  let pixelRatio = DPR();
  renderer.setPixelRatio(pixelRatio);
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  camera.position.set(...camPos);

  const controls = orbit ? new OrbitControls(camera, canvas) : { target: new THREE.Vector3(), update() {}, addEventListener() {} };
  controls.target.set(...target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.enableZoom = false; // page scroll stays page scroll; zoom via buttons
  controls.minDistance = minDist;
  controls.maxDistance = maxDist;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.autoRotate = !REDUCED_MOTION && autoRotate > 0;
  controls.autoRotateSpeed = autoRotate;
  // On touch screens, rotation is opt-in so a swipe still scrolls the page.
  if (COARSE || !orbit) { controls.enabled = false; canvas.style.touchAction = 'pan-y'; }
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  const tickers = [];
  let running = false, raf = 0, ready = false;
  const clock = new THREE.Clock();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.9 ? 50 : 36; // keep the whole tile in frame on portrait screens
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // Adaptive resolution: if frames are consistently slow, render fewer pixels.
  let slowFrames = 0, sampled = 0;
  function adapt(rawDt) {
    if (pixelRatio <= 1 || rawDt > 0.25) return; // ignore tab switches and first frames
    sampled++;
    if (rawDt > 1 / 40) slowFrames++;
    if (sampled < 90) return;
    if (slowFrames > 45) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
    }
    sampled = slowFrames = 0;
  }

  function frame() {
    if (!running) return;
    const raw = clock.getDelta();
    adapt(raw);
    const dt = Math.min(raw, 0.05);
    tickers.forEach((t) => t(dt));
    controls.update();
    renderer.render(scene, camera);
    if (!ready) { ready = true; canvas.dispatchEvent(new Event('twin:ready', { bubbles: true })); }
    raf = requestAnimationFrame(frame);
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !running) { running = true; clock.getDelta(); frame(); }
    else if (!e.isIntersecting) { running = false; cancelAnimationFrame(raf); }
  }, { threshold: 0.01 }).observe(canvas);

  function zoom(factor) {
    const dir = camera.position.clone().sub(controls.target);
    const len = THREE.MathUtils.clamp(dir.length() * factor, minDist, maxDist);
    camera.position.copy(controls.target).add(dir.setLength(len));
  }
  function setInteractive(on) {
    controls.enabled = on;
    canvas.style.touchAction = on ? 'none' : 'pan-y';
  }

  return { renderer, scene, camera, controls, tickers, zoom, setInteractive };
}

/* Terrain shader: diffuse + hemisphere light, analytic contour lines, distance fog. */
function terrainMaterial({ contour = 0.12, contourAlpha = 0.22, alpha = 1, side = THREE.FrontSide, fog = [14, 34], ambient = 0.3, detail = false, ring = 0.1 } = {}) {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    defines: detail ? { USE_DETAIL: '' } : {},
    transparent: alpha < 1,
    side,
    uniforms: {
      uLight: { value: new THREE.Vector3(-0.5, 0.9, 0.35).normalize() },
      uContour: { value: contour },
      uContourAlpha: { value: contourAlpha },
      uAlpha: { value: alpha },
      uAmb: { value: ambient },
      uRing: { value: ring },
      uFarm: { value: 1 },
      uFog: { value: new THREE.Color(0x0b0d0c) },
      uFogNear: { value: fog[0] },
      uFogFar: { value: fog[1] },
    },
    vertexShader: /* glsl */`
      varying vec3 vColor; varying vec3 vN; varying float vH; varying vec3 vW;
      #ifdef USE_DETAIL
      attribute float aKind; attribute float aRow;
      varying float vKind; varying float vRow;
      #endif
      void main() {
        vColor = color;
        #ifdef USE_DETAIL
        vKind = aKind; vRow = aRow;
        #endif
        vN = normalize(mat3(modelMatrix) * normal);
        vH = position.y;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uLight; uniform float uContour; uniform float uContourAlpha; uniform float uAlpha; uniform float uAmb;
      uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform float uRing; uniform float uFarm;
      varying vec3 vColor; varying vec3 vN; varying float vH; varying vec3 vW;
      float lineAt(float x) { float f = abs(fract(x - 0.5) - 0.5) / max(fwidth(x), 1e-4); return 1.0 - min(f, 1.0); }
      #ifdef USE_DETAIL
      varying float vKind; varying float vRow;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      #endif
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float diff = max(dot(n, uLight), 0.0);
        float hemi = 0.5 + 0.5 * n.y;
        vec3 base = vColor;
        #ifdef USE_DETAIL
        // Ground micro-texture, tramlines in arable fields, wheel tracks under each pivot tower
        float dist = distance(vW, cameraPosition);
        float nearF = 1.0 - smoothstep(2.5, 14.0, dist);
        float n1 = vnoise(vW.xz * 45.0), n2 = vnoise(vW.xz * 190.0);
        base *= 0.87 + 0.26 * mix(n1, 0.5 * n1 + 0.5 * n2, nearF);
        if (uFarm < 0.5) {
          // land not yet farmed: no tramlines or wheel tracks
        } else if (vKind > 0.5 && vKind < 1.5) {
          base *= 1.0 - 0.26 * lineAt(vRow / 0.1);
          base *= 1.0 - 0.12 * lineAt(vRow / 0.0125) * nearF;
        } else if (vKind > 1.5 && vKind < 2.5) {
          base *= 1.0 - 0.34 * lineAt(vRow / uRing) * step(0.6, vRow / uRing);
        }
        #endif
        vec3 col = base * (uAmb + 0.62 * diff + 0.22 * hemi);
        float minor = lineAt(vH / uContour);
        float major = lineAt(vH / (uContour * 5.0));
        col = mix(col, vec3(0.96, 1.0, 0.92), clamp(minor * uContourAlpha * 0.55 + major * uContourAlpha, 0.0, 0.85));
        float fog = smoothstep(uFogNear, uFogFar, distance(vW, cameraPosition));
        gl_FragColor = vec4(mix(col, uFog, fog), uAlpha);
      }`,
  });
}

function heightMesh(N, W, heightAt, colors) {
  const g = new THREE.PlaneGeometry(W, W, N - 1, N - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let k = 0; k < N * N; k++) pos.setY(k, heightAt(k));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}


/*
 * Physically based terrain for the farm views. Vertex colours carry the data (crop, layer,
 * relief); the shader adds what a 13 m data grid cannot: grass, dry straw, bare laterite,
 * rock on steep ground, fine texture, field rows and pivot wheel tracks, baked ambient
 * occlusion and contour lines. uNatural = 1 for the natural-colour view, 0 for data layers
 * (so their colours stay readable). Lit by the sun, sky and shadows like everything else.
 */
function realTerrainMaterial({ contour = 0.085, contourAlpha = 0.08, ring = 0.1 } = {}) {
  const U = {
    uContour: { value: contour }, uContourAlpha: { value: contourAlpha },
    uRing: { value: ring }, uFarm: { value: 1 }, uNatural: { value: 1 },
  };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.85 });
  m.uniforms = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aKind; attribute float aRow; attribute float aAO; attribute float aSeed;
        varying float vKind; varying float vRow; varying float vAO; varying float vSeed; varying vec3 vW; varying vec3 vNW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vKind = aKind; vRow = aRow; vAO = aAO; vSeed = aSeed;
        vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vNW = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uContour; uniform float uContourAlpha; uniform float uRing; uniform float uFarm; uniform float uNatural;
        varying float vKind; varying float vRow; varying float vAO; varying float vSeed; varying vec3 vW; varying vec3 vNW;
        float mo_h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float mo_n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mo_h(i), mo_h(i + vec2(1.0, 0.0)), f.x), mix(mo_h(i + vec2(0.0, 1.0)), mo_h(i + vec2(1.0, 1.0)), f.x), f.y); }
        float mo_fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * mo_n(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
        float mo_line(float x) { float f = abs(fract(x - 0.5) - 0.5) / max(fwidth(x), 1e-4); return 1.0 - min(f, 1.0); }`)
      .replace('#include <color_fragment>', `
        vec3 c = pow(vColor.rgb, vec3(2.2));
        float dist = distance(vW, cameraPosition);
        float nearF = 1.0 - smoothstep(1.5, 12.0, dist);
        float slopeW = 1.0 - clamp(normalize(vNW).y, 0.0, 1.0);
        float n1 = mo_fbm(vW.xz * 7.0), n2 = mo_n(vW.xz * 60.0), n3 = mo_n(vW.xz * 240.0);
        c *= 0.82 + 0.36 * mix(n1, 0.5 * n2 + 0.5 * n3, 0.3 + 0.45 * nearF);
        float wild = 1.0 - step(0.5, vKind) * uFarm;
        if (uNatural > 0.5) {
          // real ground is dusty: pull saturation down, farmed soil and crops most of all
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(lum), c, mix(0.74, 0.86, wild)) * mix(0.88, 1.0, wild);
          // patchwork: every field its own crop tone and density (yellow-green to blue-green)
          float farmed = 1.0 - wild;
          vec3 tone = mix(vec3(1.12, 1.02, 0.72), vec3(0.82, 1.03, 0.95), vSeed);
          c *= mix(vec3(1.0), tone * (0.86 + 0.28 * fract(vSeed * 7.31)), farmed);
          c *= mix(1.0, 0.9 + 0.2 * mo_fbm(vW.xz * 18.0 + vSeed * 40.0), farmed);
          // savanna ground: cured straw grass, green flush along drainage, bare laterite patches
          vec3 straw = vec3(0.36, 0.27, 0.12), flush = vec3(0.07, 0.13, 0.04), soil = vec3(0.30, 0.11, 0.05);
          float g = mo_fbm(vW.xz * 3.1 + 11.0);
          c = mix(c, mix(straw, flush, smoothstep(0.38, 0.72, g)) * (0.75 + 0.5 * n2), 0.32 * wild);
          float bare = smoothstep(0.64, 0.8, mo_fbm(vW.xz * 9.0 + 3.0)) * wild;
          c = mix(c, soil * (0.8 + 0.4 * n3), bare * 0.5);
          // rock and scree where the ground is steep
          float rock = smoothstep(0.4, 0.62, slopeW + (n1 - 0.5) * 0.22);
          c = mix(c, vec3(0.16, 0.14, 0.12) * (0.7 + 0.6 * n3), rock * 0.85);
        }
        if (uFarm > 0.5) {
          if (vKind > 0.5 && vKind < 1.5) {
            c *= 1.0 - 0.24 * mo_line(vRow / 0.1);
            c *= 1.0 - 0.16 * mo_line(vRow / 0.0125) * nearF;
          } else if (vKind > 1.5 && vKind < 2.5) {
            c *= 1.0 - 0.32 * mo_line(vRow / uRing) * step(0.6, vRow / uRing);
          }
        }
        c *= mix(1.0, vAO, 0.45 + 0.55 * uNatural);
        c = mix(c, c * 0.45, mo_line(vW.y / uContour) * uContourAlpha);
        diffuseColor.rgb = c;`);
  };
  return m;
}

/* Vertical walls around a heightfield tile, coloured by a callback (for strata). */
function skirtGeometry(N, W, topY, baseY, rows, colorFn) {
  const verts = [], cols = [], idx = [];
  const step = W / (N - 1), h0 = -W / 2;
  const edges = [
    (t) => [t, 0], (t) => [N - 1, t], (t) => [N - 1 - t, N - 1], (t) => [0, N - 1 - t],
  ];
  for (const edge of edges) {
    const start = verts.length / 3;
    for (let t = 0; t < N; t++) {
      const [i, j] = edge(t);
      const x = h0 + i * step, z = h0 + j * step, top = topY(j * N + i);
      for (let r = 0; r <= rows; r++) {
        const y = top + (baseY - top) * (r / rows);
        verts.push(x, y, z);
        cols.push(...colorFn(x, y, z, top - y));
      }
    }
    for (let t = 0; t < N - 1; t++) for (let r = 0; r < rows; r++) {
      const a = start + t * (rows + 1) + r, b = a + rows + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Colour helpers */
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function ramp(stops, t) {
  t = Math.min(1, Math.max(0, t));
  for (let s = 1; s < stops.length; s++) {
    if (t <= stops[s][0]) {
      const [t0, c0] = stops[s - 1], [t1, c1] = stops[s];
      return mix3(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

const RAMPS = {
  terrain: [[0, hex(0x2c4427)], [0.3, hex(0x4f6234)], [0.55, hex(0x76683f)], [0.78, hex(0x8a6a45)], [1, hex(0xa8987c)]],
  // Vigour and moisture read by lightness (light = low, dark = high), so they stay legible with colour-blindness.
  ndvi: [[0, hex(0xefe3a6)], [0.3, hex(0xc8cd78)], [0.55, hex(0x8db35a)], [0.78, hex(0x4f8a3f)], [1, hex(0x235f30)]],
  water: [[0, hex(0xe3d3a4)], [0.3, hex(0xa9bcae)], [0.55, hex(0x6a9cc6)], [0.8, hex(0x3471b3)], [1, hex(0x1b4685)]],
  fire: [[0, hex(0x1d2a22)], [0.4, hex(0x52603a)], [0.62, hex(0xd99a2b)], [0.8, hex(0xe0561f)], [1, hex(0xb81d13)]],
};

/* ------------------------------------------------------------------ */
/* Shared farm model: one landscape used by every farm visual          */
/* ------------------------------------------------------------------ */

export const STAGES = [
  { id: 'survey', label: 'Day 0 — Site survey', growth: 0, dry: 0.85 },
  { id: 'emerge', label: 'Day 14 — Emergence', growth: 0.22, dry: 0.45 },
  { id: 'veg', label: 'Day 45 — Vegetative growth', growth: 0.62, dry: 0.25 },
  { id: 'canopy', label: 'Day 80 — Canopy closure', growth: 1, dry: 0.15 },
  { id: 'mature', label: 'Day 120 — Physiological maturity', growth: 0.55, dry: 0.6 },
];

// Scale of the model site: 2.4 km square, ~60 m of relief.
export const SITE = { km: 2.4, reliefM: 60 };

let FARM = null;
export function getFarm() {
  if (FARM) return FARM;
  const N = 176, W = 10, VS = 1.3;
  const L = generateLandscape({ size: N, seed: 11 });
  const nStress = makeNoise(77);
  const inPivot = new Int8Array(N * N).fill(-1);
  const health = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, u = i / (N - 1), v = j / (N - 1);
    L.pivots.forEach((p, pi) => { if (Math.hypot(u - p.u, v - p.v) < p.r) inPivot[k] = pi; });
    const stress = Math.max(0, nStress(u * 7, v * 7) - 0.45) * 2.2;
    health[k] = Math.min(1, Math.max(0, 0.85 + 0.15 * nStress(u * 20, v * 20) - stress));
  }
  const heightAt = (k) => L.h[k] * VS;
  const groundY = (u, v) => sample(L.h, N, u, v) * VS;
  const toWorld = (u, v, lift = 0) => new THREE.Vector3((u - 0.5) * W, groundY(u, v) + lift, (v - 0.5) * W);
  const waterCol = hex(0x1d4f7a);
  const rand = mulberry32(4242);
  const wx = (i) => (i / (N - 1) - 0.5) * W;
  const cellOf = (u, v) => Math.round(Math.min(1, Math.max(0, v)) * (N - 1)) * N + Math.round(Math.min(1, Math.max(0, u)) * (N - 1));

  // Parcel roles: the largest parcel stays arable; the next two become an orchard and a plantation
  const counts = new Map();
  for (let k = 0; k < N * N; k++) { const f = L.field[k]; if (f >= 0 && inPivot[k] < 0) counts.set(f, (counts.get(f) || 0) + 1); }
  const bySize = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const orchardId = bySize[1] ?? -1, plantationId = bySize[2] ?? -1;
  const rowAngle = new Map();
  bySize.forEach((f) => rowAngle.set(f, rand() * Math.PI));
  const kindOf = (k) => inPivot[k] >= 0 ? 2 : (L.field[k] === orchardId || L.field[k] === plantationId) ? 3 : L.field[k] >= 0 ? 1 : 0;

  // Per-vertex surface attributes for the detail shader (tramlines, wheel tracks)
  const aKind = new Float32Array(N * N), aRow = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, kind = kindOf(k), x = wx(i), z = wx(j);
    aKind[k] = kind;
    if (kind === 1) { const a = rowAngle.get(L.field[k]); aRow[k] = x * Math.cos(a) + z * Math.sin(a); }
    else if (kind === 2) { const p = L.pivots[inPivot[k]]; aRow[k] = Math.hypot(x - (p.u - 0.5) * W, z - (p.v - 0.5) * W); }
  }

  // Farmyard next to pivot 1, facing the middle of the farm
  const p0 = L.pivots[0];
  let yard = null;
  for (let t = 0; t < 24 && !yard; t++) {
    const ang = Math.atan2(0.5 - p0.v, 0.5 - p0.u) + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 0.26;
    const u = p0.u + Math.cos(ang) * (p0.r + 0.035), v = p0.v + Math.sin(ang) * (p0.r + 0.035);
    if (u < 0.06 || v < 0.06 || u > 0.94 || v > 0.94) continue;
    const k = cellOf(u, v);
    if (L.riverMask[k] > 0.05 || inPivot[k] >= 0) continue;
    yard = { u, v, angle: ang };
  }
  yard ??= { u: p0.u + p0.r + 0.035, v: p0.v, angle: 0 };

  // Dirt roads: yard to each pivot, and out to the nearest boundary
  const segs = [];
  L.pivots.forEach((p) => { const a = Math.atan2(yard.v - p.v, yard.u - p.u); segs.push([yard.u, yard.v, p.u + Math.cos(a) * p.r, p.v + Math.sin(a) * p.r]); });
  const exits = [[yard.u, 0], [yard.u, 1], [0, yard.v], [1, yard.v]].sort((a, b) => Math.hypot(a[0] - yard.u, a[1] - yard.v) - Math.hypot(b[0] - yard.u, b[1] - yard.v));
  segs.push([yard.u, yard.v, exits[0][0], exits[0][1]]);
  const segDist = (u, v, [x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(u - x1 - t * dx, v - y1 - t * dy);
  };
  const road = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / (N - 1), v = j / (N - 1), k = j * N + i;
    const d = Math.min(...segs.map((s) => segDist(u, v, s)));
    road[k] = Math.max(0, Math.min(1, 1 - (d - 0.0022) / 0.002));
    if (Math.hypot(u - yard.u, v - yard.v) < 0.014) road[k] = Math.max(road[k], 0.75); // hardstanding
  }

  // Trees: natural miombo woodland (denser on moist ground and river banks), trees that stand on
  // the farmland before clearing, and planted rows in the orchard and plantation.
  const M = 1 / 240; // one metre in world units
  const trees = { natural: [], preclear: [], orchard: [], plantation: [] };
  const shadeNat = new Float32Array(N * N), shadePre = new Float32Array(N * N), shadeRows = new Float32Array(N * N);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    if (L.riverMask[k] > 0.45 || road[k] > 0.05) continue;
    const kind = kindOf(k), m = L.moisture[k];
    const bank = L.riverMask[k] > 0.04 ? 1 : 0;
    const p = kind === 0 ? (0.3 + 0.45 * m + 0.55 * bank) * (1 - 0.35 * L.slope[k]) : 0.45;
    const n = rand() < p ? (rand() < p - 0.45 ? 2 : 1) : 0;
    for (let t = 0; t < n; t++) {
      const u = (i + rand() - 0.5) / (N - 1), v = (j + rand() - 0.5) / (N - 1);
      if (Math.hypot(u - yard.u, v - yard.v) < 0.022) continue;
      const tint = mix(mix([0.33, 0.43, 0.22], [0.22, 0.36, 0.19], rand()), [0.5, 0.47, 0.29], rand() * 0.35 * (1 - bank));
      const tree = { x: (u - 0.5) * W, y: groundY(u, v) - 0.002, z: (v - 0.5) * W, w: (7 + rand() * 7) * M * 1.2, h: (8 + rand() * 7) * M * 1.6, rot: rand() * 6.28, c: tint };
      if (kind === 0) { trees.natural.push(tree); shadeNat[k] = Math.min(1, shadeNat[k] + 0.5); }
      else { trees.preclear.push(tree); shadePre[k] = Math.min(1, shadePre[k] + 0.5); }
    }
  }
  function plantRows(fieldId, alongM, acrossM, list, make) {
    if (fieldId < 0) return;
    let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
    for (let k = 0; k < N * N; k++) if (L.field[k] === fieldId) { const u = (k % N) / (N - 1), v = Math.floor(k / N) / (N - 1); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const a = rowAngle.get(fieldId), ca = Math.cos(a), sa = Math.sin(a);
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, D = Math.hypot(u1 - u0, v1 - v0) / 2;
    const sA = alongM / 2400, sB = acrossM / 2400;
    for (let b = -D; b <= D; b += sB) for (let s = -D; s <= D; s += sA) {
      const u = cu + s * ca - b * sa, v = cv + s * sa + b * ca;
      const k = cellOf(u, v);
      if (L.field[k] !== fieldId || road[k] > 0.05) continue;
      const i = k % N, j = Math.floor(k / N);
      if (L.field[k - 1] !== fieldId || L.field[k + 1] !== fieldId || L.field[k - N] !== fieldId || L.field[k + N] !== fieldId) continue; // headland
      list.push(make(u, v));
      shadeRows[k] = Math.min(1, shadeRows[k] + 0.12);
      if (list.length > 7000) return;
    }
  }
  plantRows(orchardId, 5, 8, trees.orchard, (u, v) => ({ x: (u - 0.5) * W, y: groundY(u, v) - 0.001, z: (v - 0.5) * W, w: (4.5 + rand()) * M * 1.2, h: (4 + rand()) * M * 1.6, rot: rand() * 6.28, c: mix([0.16, 0.34, 0.15], [0.22, 0.4, 0.18], rand()) }));
  plantRows(plantationId, 5, 6, trees.plantation, (u, v) => ({ x: (u - 0.5) * W, y: groundY(u, v) - 0.001, z: (v - 0.5) * W, w: (4 + rand()) * M * 1.2, h: (18 + rand() * 6) * M * 1.4, rot: rand() * 6.28, c: mix([0.42, 0.52, 0.38], [0.36, 0.47, 0.33], rand()) }));

  /** Per-vertex colours + summary stats for a layer and season stage. */
  function colorsFor(layer, stageIdx, { untouched = false, pivotRelief = null } = {}) {
    const st = STAGES[stageIdx];
    const g = st.growth;
    const out = new Float32Array(N * N * 3);
    let fieldN = 0, ndviSum = 0, covered = 0, floodN = 0, fireN = 0;
    for (let k = 0; k < N * N; k++) {
      const h = L.h[k], m = L.moisture[k], river = L.riverMask[k] > 0.5;
      const kind = untouched ? 0 : kindOf(k);
      const isCrop = kind === 1 || kind === 2;
      const irrigated = kind === 2;
      const natural = 0.28 + 0.42 * m + 0.1 * (1 - st.dry);
      const cropG = irrigated ? Math.min(1, g * 1.08) : g;
      const crop = 0.12 + 0.76 * cropG * health[k];
      const ndvi = river ? 0 : isCrop ? crop : kind === 3 ? 0.55 + 0.2 * health[k] : natural;
      if (isCrop) { fieldN++; ndviSum += ndvi; if (ndvi > 0.55) covered++; }
      const floodRisk = Math.max(0, m - 0.55) / 0.45 * (1 - h) * 1.6;
      if (floodRisk > 0.45) floodN++;
      const fuel = isCrop ? (irrigated ? 0.05 : 0.6 * (1 - cropG) * st.dry) : kind === 3 ? 0.35 * st.dry : (1 - m) * (0.4 + 0.6 * st.dry);
      const fire = Math.min(1, fuel * (0.75 + 0.6 * L.slope[k]));
      if (fire > 0.6) fireN++;

      let c;
      if (layer === 'ndvi') c = river ? waterCol : ramp(RAMPS.ndvi, ndvi);
      else if (layer === 'water') c = ramp(RAMPS.water, Math.min(1, 0.6 * m + 0.5 * floodRisk));
      else if (layer === 'fire') c = river ? waterCol : ramp(RAMPS.fire, fire);
      else {
        const baseC = ramp(RAMPS.terrain, h * 0.85 + L.slope[k] * 0.25 - m * 0.2);
        if (river) c = waterCol;
        else if (isCrop) c = mix3(hex(0x7a4a2c), hex(0x4f7d2e), Math.min(1, cropG * health[k]));
        else if (kind === 3) c = mix3(hex(0x6b5a3a), hex(0x5a7236), 0.55);
        else c = mix3(baseC, hex(0x3d5a2a), m * (1 - st.dry) * 0.6);
      }
      if (pivotRelief && inPivot[k] === pivotRelief.index) {
        const dzM = (h - pivotRelief.h0) * SITE.reliefM; // metres above/below the pivot point
        const sc = pivotRelief.scaleM || 4;
        c = dzM < 0 ? mix3(hex(0xeef2ea), hex(0x2a6fb5), Math.min(1, -dzM / sc)) : mix3(hex(0xeef2ea), hex(0xd9532b), Math.min(1, dzM / sc));
      }
      // Soft river banks instead of a hard pixel edge
      const rw = Math.min(1, Math.max(0, (L.riverMask[k] - 0.25) / 0.5));
      if (rw > 0 && layer !== 'water' && !pivotRelief) c = mix3(c, waterCol, rw);
      if (layer === 'terrain') {
        // Field margins between parcels
        if (!untouched && L.field[k] >= 0) {
          const f = L.field[k];
          if ((k % N < N - 1 && L.field[k + 1] !== f) || (k + N < N * N && L.field[k + N] !== f)) c = c.map((x) => x * 0.93); // soft margin: the 13 m grid would show as steps
        }
        // Dirt roads and yard hardstanding
        if (!untouched && road[k] > 0) c = mix3(c, hex(0xa38b68), road[k]);
        // Ground darkened under tree canopies
        const sh = shadeNat[k] + (untouched ? shadePre[k] : shadeRows[k]);
        if (sh > 0 && !pivotRelief) c = c.map((x) => x * (1 - 0.34 * Math.min(1, sh)));
      }
      out[k * 3] = c[0]; out[k * 3 + 1] = c[1]; out[k * 3 + 2] = c[2];
    }
    const HA = (SITE.km * 10) ** 2 / (N * N); // 2.4 km square = 576 ha
    return {
      colors: out,
      stats: { ndvi: fieldN ? ndviSum / fieldN : 0, cover: fieldN ? covered / fieldN : 0, floodHa: floodN * HA, fireHa: fireN * HA },
    };
  }

  // Ambient occlusion: how much of the sky each point sees, from the terrain horizon in 8 directions.
  let aoCache = null;
  function ambientOcclusion() {
    if (aoCache) return aoCache;
    const ao = new Float32Array(N * N), cell = W / (N - 1), steps = [1, 2, 3, 5, 8, 12];
    const dirs = Array.from({ length: 8 }, (_, d) => [Math.cos(d * Math.PI / 4), Math.sin(d * Math.PI / 4)]);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, h0 = heightAt(k);
      let occ = 0;
      for (const [dx, dz] of dirs) {
        let best = 0;
        for (const s of steps) {
          const x = Math.round(i + dx * s), z = Math.round(j + dz * s);
          if (x < 0 || z < 0 || x >= N || z >= N) break;
          best = Math.max(best, (heightAt(z * N + x) - h0) / (s * cell));
        }
        occ += Math.atan(best) / (Math.PI / 2);
      }
      const canopy = Math.min(1, shadeNat[k] + shadeRows[k] * 0.5);
      ao[k] = Math.max(0.35, 1 - 1.6 * occ / 8 - 0.18 * canopy);
    }
    return (aoCache = ao);
  }
  // One random value per field (and per pivot), so each field gets its own crop tone.
  let seedCache = null;
  function fieldSeed() {
    if (seedCache) return seedCache;
    const sd = new Float32Array(N * N), fr = (x) => { const v = Math.sin(x * 12.9898 + 4.1) * 43758.5453; return v - Math.floor(v); };
    for (let k = 0; k < N * N; k++) sd[k] = inPivot[k] >= 0 ? fr(100 + inPivot[k]) : L.field[k] >= 0 ? fr(L.field[k]) : 0.5;
    return (seedCache = sd);
  }
  function mesh(colors, material) {
    const geom = heightMesh(N, W, heightAt, colors);
    geom.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));
    geom.setAttribute('aRow', new THREE.BufferAttribute(aRow, 1));
    geom.setAttribute('aAO', new THREE.BufferAttribute(ambientOcclusion(), 1));
    geom.setAttribute('aSeed', new THREE.BufferAttribute(fieldSeed(), 1));
    const m = new THREE.Mesh(geom, material);
    m.receiveShadow = !LOW;
    return m;
  }
  function skirt() {
    const soil = hex(0x3a2b20), deep = hex(0x1a1714);
    return new THREE.Mesh(skirtGeometry(N, W, heightAt, -0.6, 10, (x, y, z, d) => mix3(soil, deep, Math.min(1, d / 2))),
      srgbVertexColors(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })));
  }
  const ringSpacing = L.pivots.length ? (L.pivots[0].r * W) / 7 : 0.1;

  /** Add trees and the farmyard to a scene; returns the groups so views can toggle them. */
  function addDetail(scene, { preclear = false, planted = true, farmyard = true } = {}) {
    const groups = {
      natural: treeMesh(trees.natural, 'miombo', { thin: true }),
      preclear: treeMesh(trees.preclear, 'miombo', { thin: true }),
      orchard: treeMesh(trees.orchard, 'citrus'),
      plantation: treeMesh(trees.plantation, 'euc'),
      yard: yardGroup(FARM),
      water: waterMesh(N, W, heightAt, L.riverMask),
    };
    groups.preclear.visible = preclear;
    groups.orchard.visible = groups.plantation.visible = planted;
    groups.yard.visible = farmyard;
    Object.values(groups).forEach((o) => scene.add(o));
    return groups;
  }

  FARM = { N, W, VS, L, inPivot, health, heightAt, groundY, toWorld, colorsFor, mesh, skirt, yard, trees, ringSpacing, addDetail };
  return FARM;
}

/** Alert locations, chosen from the farm data itself (shared by the Watch view and the story). */
function farmAlerts(farm) {
  const { N, L, inPivot, health } = farm;
  // Alert locations come from the farm data itself
  // Each alert takes the best-scoring cell that is not too close to one already placed,
  // so markers and their labels never sit on top of each other.
  const taken = [];
  const pick = (score) => {
    let best = -Infinity, bk = 0;
    for (let j = 8; j < N - 8; j += 2) for (let i = 8; i < N - 8; i += 2) {
      const u = i / (N - 1), v = j / (N - 1);
      if (taken.some((t) => Math.abs(t.v - v) < 0.07 && Math.abs(t.u - u) < 0.22)) continue;
      const k = j * N + i, s = score(k);
      if (s > best) { best = s; bk = k; }
    }
    const at = { u: (bk % N) / (N - 1), v: Math.floor(bk / N) / (N - 1) };
    taken.push(at);
    return at;
  };
  const isField = (k) => L.field[k] >= 0 && inPivot[k] < 0;
  const pestPivot = L.pivots.length > 1 ? 1 : 0;
  return [
    { k: 'flood', label: 'Flood', ...pick((k) => L.riverMask[k] > 0.3 ? -1 : Math.max(0, L.moisture[k] - 0.55) * (1 - L.h[k])) },
    { k: 'fire', label: 'Fire', ...pick((k) => (L.field[k] >= 0 || inPivot[k] >= 0 || L.riverMask[k] > 0.2) ? -1 : (1 - L.moisture[k]) * (0.7 + L.slope[k]) * L.h[k]) },
    { k: 'pest', label: 'Pest', ...pick((k) => inPivot[k] === pestPivot ? 1 - health[k] : -1) },
    { k: 'disease', label: 'Disease', ...pick((k) => isField(k) ? 1 - health[k] : -1) },
    { k: 'wind', label: 'Wind', ...pick((k) => isField(k) ? L.h[k] : -1) },
    { k: 'change', label: 'Change', ...pick((k) => { const u = (k % N) / (N - 1); return (u > 0.82 && L.field[k] < 0 && L.riverMask[k] < 0.2) ? u - L.slope[k] * 0.1 : -1; }) },
  ];
}

/* Centre-pivot model that follows the ground: towers, truss, drops and spray. */
function buildPivot(farm, p, { towers = 7, spray = true } = {}) {
  const { W, groundY } = farm;
  const group = new THREE.Group();
  const R = p.r * W;
  const cx = (p.u - 0.5) * W, cz = (p.v - 0.5) * W;
  const steel = new THREE.LineBasicMaterial({ color: 0x15191a });
  const wheelMat = new THREE.MeshBasicMaterial({ color: 0x1b1f1d });
  const TOWER_H = 0.075;

  // Pivot point
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.015, TOWER_H * 1.4, 8), new THREE.MeshBasicMaterial({ color: 0xc6f36b }));
  base.position.set(cx, groundY(p.u, p.v) + TOWER_H * 0.7, cz);
  group.add(base);

  const trussGeo = new THREE.BufferGeometry();
  trussGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((towers * 4 + towers * 6) * 2 * 3), 3));
  const truss = new THREE.LineSegments(trussGeo, steel);
  truss.frustumCulled = false;
  group.add(truss);

  const wheels = [];
  for (let i = 0; i < towers; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.03), wheelMat);
    group.add(w); wheels.push(w);
  }

  const DROPS = spray ? 420 : 0;
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 3), 3));
  const sprayPts = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: 0x5fb8ff, size: 0.01, transparent: true, opacity: 0.75, depthWrite: false }));
  sprayPts.frustumCulled = false;
  if (spray) group.add(sprayPts);
  const seeds = Array.from({ length: DROPS }, () => [Math.random(), Math.random(), Math.random() * 2 - 1]);

  const towerData = [];
  function update(theta, t = 0) {
    const ca = Math.cos(theta), sa = Math.sin(theta);
    const px = -sa, pz = ca; // perpendicular, for A-frame legs
    const pts = [];
    const topAt = (r) => {
      const x = cx + ca * r, z = cz + sa * r;
      return new THREE.Vector3(x, groundY(x / W + 0.5, z / W + 0.5) + TOWER_H, z);
    };
    const pivotTop = new THREE.Vector3(cx, groundY(p.u, p.v) + TOWER_H * 1.4, cz);
    let prev = pivotTop;
    towerData.length = 0;
    for (let i = 1; i <= towers; i++) {
      const r = (i / towers) * R;
      const top = topAt(r);
      const g = top.y - TOWER_H;
      // span pipe (with sag) + under-truss chord
      const mid = prev.clone().lerp(top, 0.5); mid.y -= 0.012;
      pts.push(prev, mid, mid, top);
      const chordA = prev.clone(); chordA.y -= 0.02;
      const chordB = top.clone(); chordB.y -= 0.02;
      const chordM = mid.clone(); chordM.y -= 0.03;
      pts.push(chordA, chordM, chordM, chordB);
      // A-frame tower legs
      const footL = new THREE.Vector3(top.x + px * 0.03, g, top.z + pz * 0.03);
      const footR = new THREE.Vector3(top.x - px * 0.03, g, top.z - pz * 0.03);
      pts.push(top, footL, top, footR, footL, footR);
      wheels[i - 1].position.set(top.x, g + 0.011, top.z);
      wheels[i - 1].rotation.y = -theta;
      towerData.push({ r, ground: g });
      prev = top;
    }
    const arr = trussGeo.attributes.position.array;
    pts.forEach((v, n) => { arr[n * 3] = v.x; arr[n * 3 + 1] = v.y; arr[n * 3 + 2] = v.z; });
    trussGeo.attributes.position.needsUpdate = true;

    if (spray) {
      const sp = sprayGeo.attributes.position.array;
      for (let n = 0; n < DROPS; n++) {
        const [a, b, c] = seeds[n];
        const r = 0.04 + a * (R - 0.04);
        const phase = (b + t * 1.6) % 1;
        const x0 = cx + ca * r, z0 = cz + sa * r;
        const g0 = groundY(x0 / W + 0.5, z0 / W + 0.5);
        const top = g0 + TOWER_H - 0.03;
        const spread = 0.05 * phase;
        sp[n * 3] = x0 + px * c * spread;
        sp[n * 3 + 1] = top - phase * (TOWER_H - 0.035);
        sp[n * 3 + 2] = z0 + pz * c * spread;
      }
      sprayGeo.attributes.position.needsUpdate = true;
    }
  }
  update(0.6);
  return { group, update, towers: towerData, R, cx, cz };
}

/* ------------------------------------------------------------------ */
/* Hero: farm digital twin                                             */
/* ------------------------------------------------------------------ */

export function initHero(canvas, { onStats } = {}) {
  const farm = getFarm();
  const { N, W, VS, L, inPivot, groundY } = farm;
  const viewer = createViewer(canvas, { camPos: [9.5, 7.2, 10.5], target: [0, 0.2, 0], autoRotate: 0.3 });
  const { scene } = viewer;

  const colors = new Float32Array(N * N * 3);
  let target = colors;
  const terrain = farm.mesh(colors, realTerrainMaterial({ contour: 0.085, contourAlpha: 0.07, ring: farm.ringSpacing }));
  const geom = terrain.geometry;
  scene.add(terrain, farm.skirt());
  addLights(scene, [14, 34], viewer.renderer);
  farm.addDetail(scene);

  // Pivot outlines
  for (const p of L.pivots) {
    const pts = [];
    for (let a = 0; a <= 96; a++) {
      const u = p.u + Math.cos(a / 96 * Math.PI * 2) * p.r, v = p.v + Math.sin(a / 96 * Math.PI * 2) * p.r;
      pts.push(farm.toWorld(u, v, 0.02));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xc6f36b, transparent: true, opacity: 0.7 })));
  }

  // Survey layer: soil sample points + survey flight lines (visible on Day 0)
  const surveyGroup = new THREE.Group();
  const dotGeo = new THREE.SphereGeometry(0.045, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xc6f36b });
  const rows = 9;
  for (let r = 0; r < rows; r++) for (let c = 0; c < rows; c++) {
    const u = 0.08 + (c + 0.5 * (r % 2)) / rows * 0.84, v = 0.08 + r / (rows - 1) * 0.84;
    const k = Math.round(v * (N - 1)) * N + Math.round(u * (N - 1));
    if (L.field[k] < 0 && inPivot[k] < 0) continue;
    const m = new THREE.Mesh(dotGeo, dotMat);
    m.position.copy(farm.toWorld(u, v, 0.05));
    surveyGroup.add(m);
  }
  const flight = [];
  const alt = VS + 0.9;
  for (let r = 0; r < 12; r++) {
    const z = (-0.45 + r / 11 * 0.9) * W;
    const xs = r % 2 ? [0.45 * W, -0.45 * W] : [-0.45 * W, 0.45 * W];
    flight.push(new THREE.Vector3(xs[0], alt, z), new THREE.Vector3(xs[1], alt, z));
  }
  const flightLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(flight),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.45 }));
  flightLine.computeLineDistances();
  surveyGroup.add(flightLine);
  scene.add(surveyGroup);

  linearizeUnlit(scene);
  const state = { layer: 'terrain', stage: 0 };
  let blending = true;
  viewer.tickers.push((dt) => {
    if (!blending) return;
    const a = 1 - Math.exp(-dt * 8);
    let maxD = 0;
    for (let k = 0; k < colors.length; k++) {
      const d = target[k] - colors[k];
      colors[k] += d * a;
      if (Math.abs(d) > maxD) maxD = Math.abs(d);
    }
    geom.attributes.color.needsUpdate = true;
    if (maxD < 0.002) blending = false;
  });

  function update() {
    const res = farm.colorsFor(state.layer, state.stage);
    target = res.colors;
    onStats?.(res.stats);
    surveyGroup.visible = state.stage === 0;
    blending = true;
  }
  update();
  colors.set(target);
  geom.attributes.color.needsUpdate = true;

  return {
    setLayer(l) { state.layer = l; terrain.material.uniforms.uNatural.value = l === 'terrain' ? 1 : 0; update(); },
    setStage(s) { state.stage = s; update(); },
    zoom: viewer.zoom,
    setInteractive: viewer.setInteractive,
  };
}

/* ------------------------------------------------------------------ */
/* Groundwater: geological block with water table, fracture, boreholes */
/* ------------------------------------------------------------------ */

export function initSubsurface(canvas, { onReadout } = {}) {
  const N = 110, W = 10, VS = 1.1, BASE = -3.6, M_PER_UNIT = 10;
  const L = generateLandscape({ size: N, seed: 29, erosion: 16 });
  const nz = makeNoise(5);
  const viewer = createViewer(canvas, { camPos: [12.5, 3.4, 13], target: [0, -1.1, 0], autoRotate: 0.25, minDist: 9, maxDist: 28 });
  const { scene } = viewer;
  const heightAt = (k) => L.h[k] * VS;

  // Surface: natural savanna colouring
  const sc = new Float32Array(N * N * 3);
  for (let k = 0; k < N * N; k++) {
    const c = L.riverMask[k] > 0.5 ? hex(0x1d4f7a)
      : mix3(ramp(RAMPS.terrain, L.h[k] * 0.9 + L.slope[k] * 0.2), hex(0x3d5a2a), L.moisture[k] * 0.5);
    sc.set(c, k * 3);
  }
  const surfMat = terrainMaterial({ contour: 0.1, contourAlpha: 0.18, alpha: 0.999, fog: [30, 60] });
  surfMat.depthWrite = true;
  const surface = new THREE.Mesh(heightMesh(N, W, heightAt, sc), surfMat);
  scene.add(surface);

  // Dipping strata (angles in scene units; ~12° apparent dip toward +x)
  const STRATA = [
    { name: 'Topsoil (A/B horizons)', to: 0.08, color: hex(0x4a3426) },
    { name: 'Ferricrete / laterite', to: 0.4, color: hex(0x9c5a2e) },
    { name: 'Saprolite (weathered)', to: 1.35, color: hex(0xc49a62) },
    { name: 'Fractured saprock', to: 2.15, color: hex(0x8d8777) },
    { name: 'Fresh basement', to: 99, color: hex(0x5b5f66) },
  ];
  const dip = (x, z) => 0.13 * x + 0.12 * nz(x * 0.25, z * 0.25);
  let wtOffset = -1.25; // water table depth below smoothed surface (scene units)
  const smoothH = (x, z) => sample(L.h, N, x / W + 0.5, z / W + 0.5) * VS * 0.35 + 0.42;
  const wtY = (x, z) => smoothH(x, z) + wtOffset;

  function strataColor(x, y, z, d) {
    const dd = d - (d > 0.1 ? dip(x, z) : 0);
    let c = STRATA[STRATA.length - 1].color;
    for (const s of STRATA) if (dd < s.to) { c = s.color; break; }
    const band = 0.06 * nz(x * 0.6 + y * 9, z * 0.6);
    c = c.map((v) => v * (0.92 + band));
    if (y < wtY(x, z)) c = mix3(c, hex(0x2d6f9e), 0.2);
    return c;
  }
  let skirtMesh;
  const skirtMat = terrainMaterial({ contourAlpha: 0, side: THREE.DoubleSide, fog: [30, 60], ambient: 0.62 });
  function buildSkirt() {
    if (skirtMesh) { scene.remove(skirtMesh); skirtMesh.geometry.dispose(); }
    skirtMesh = new THREE.Mesh(skirtGeometry(N, W, heightAt, BASE, 48, strataColor), skirtMat);
    scene.add(skirtMesh);
  }
  buildSkirt();

  // Base plate
  const base = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshBasicMaterial({ color: 0x24262a, side: THREE.DoubleSide }));
  base.rotation.x = -Math.PI / 2; base.position.y = BASE;
  scene.add(base);

  // Water table surface
  const WN = 64;
  const wtGeo = new THREE.PlaneGeometry(W * 0.998, W * 0.998, WN - 1, WN - 1);
  wtGeo.rotateX(-Math.PI / 2);
  const wtMat = new THREE.MeshBasicMaterial({ color: 0x48a8e8, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const waterTable = new THREE.Mesh(wtGeo, wtMat);
  const wtWire = new THREE.LineSegments(new THREE.WireframeGeometry(wtGeo), new THREE.LineBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.18 }));
  scene.add(waterTable, wtWire);
  function placeWaterTable() {
    const p = wtGeo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k);
      const surf = sample(L.h, N, x / W + 0.5, z / W + 0.5) * VS;
      p.setY(k, Math.min(wtY(x, z), surf - 0.03));
    }
    p.needsUpdate = true;
    wtWire.geometry.dispose();
    wtWire.geometry = new THREE.WireframeGeometry(wtGeo);
  }

  // Fracture zone: a planar shear dipping ~58°, clipped to the block
  const clip = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), W / 2), new THREE.Plane(new THREE.Vector3(-1, 0, 0), W / 2),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), W / 2), new THREE.Plane(new THREE.Vector3(0, 0, -1), W / 2),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -BASE),
  ];
  const FR_DIP = THREE.MathUtils.degToRad(58), FR_X0 = -1.6, FR_TOP = 1.0;
  const fracX = (y) => FR_X0 + (FR_TOP - y) / Math.tan(FR_DIP);
  const fracGeo = new THREE.PlaneGeometry(W * 1.2, (FR_TOP - BASE) / Math.sin(FR_DIP), 1, 1);
  const fracture = new THREE.Mesh(fracGeo, new THREE.MeshBasicMaterial({
    color: 0x7ff0d4, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clip,
  }));
  fracture.rotation.order = 'YXZ';
  fracture.rotation.y = Math.PI / 2;
  fracture.rotation.x = -(Math.PI / 2 - FR_DIP);
  fracture.position.set((fracX(FR_TOP) + fracX(BASE)) / 2, (FR_TOP + BASE) / 2, 0);
  // Only keep the part below ground
  fracture.material.clippingPlanes = [...clip, new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.25)];
  scene.add(fracture);

  // Boreholes: one sited on the fracture, one blind
  const holes = [
    { id: 'A', x: 0.55, z: 1.4, color: 0xc6f36b },
    { id: 'B', x: -3.4, z: -1.8, color: 0xff6b4a },
  ];
  const holeGroup = new THREE.Group();
  for (const b of holes) {
    const top = sample(L.h, N, b.x / W + 0.5, b.z / W + 0.5) * VS;
    b.top = top;
    b.bottom = b.id === 'A' ? fracYAt(b.x) - 0.35 : top - 1.4;
    const len = top - b.bottom + 0.25;
    const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 10), new THREE.MeshBasicMaterial({ color: b.color }));
    casing.position.set(b.x, top + 0.25 - len / 2, b.z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), new THREE.MeshBasicMaterial({ color: b.color }));
    head.position.set(b.x, top + 0.3, b.z);
    holeGroup.add(casing, head);
    if (b.id === 'A') {
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9ff7ff }));
      hit.position.set(b.x, fracYAt(b.x), b.z);
      holeGroup.add(hit);
      b.hit = hit;
    }
  }
  function fracYAt(x) { return FR_TOP - (x - FR_X0) * Math.tan(FR_DIP); }
  scene.add(holeGroup);

  if (!REDUCED_MOTION) {
    let t = 0;
    viewer.tickers.push((dt) => { t += dt; const s = 1 + 0.25 * Math.sin(t * 3); holes[0].hit.scale.setScalar(s); });
  }

  function readout() {
    const a = holes[0];
    const wt = wtY(a.x, a.z);
    onReadout?.({
      waterDepthM: (a.top - wt) * M_PER_UNIT,
      fractureDepthM: (a.top - fracYAt(a.x)) * M_PER_UNIT,
      holeBDepthM: (holes[1].top - holes[1].bottom) * M_PER_UNIT,
      holeBWet: holes[1].bottom < wtY(holes[1].x, holes[1].z),
    });
  }

  function setSeason(t) { // 0 = end of rains, 1 = late dry season
    wtOffset = -0.95 - 0.75 * t;
    placeWaterTable();
    buildSkirt();
    readout();
  }
  setSeason(0.35);

  return {
    setSeason,
    setCutaway(on) {
      surfMat.uniforms.uAlpha.value = on ? 0.12 : 0.999;
      surfMat.transparent = on;
      surfMat.depthWrite = !on;
      surfMat.needsUpdate = true;
    },
    toggle(name, on) {
      ({ water: [waterTable, wtWire], fracture: [fracture], boreholes: [holeGroup] })[name]?.forEach((o) => { o.visible = on; });
    },
    strata: STRATA.map((s) => ({ name: s.name, color: '#' + s.color.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') })),
    zoom: viewer.zoom,
    setInteractive: viewer.setInteractive,
  };
}

/* ------------------------------------------------------------------ */
/* Watch: the same farm seen from orbit, with alert locations          */
/* ------------------------------------------------------------------ */

export function initWatch(canvas, { layer = 'terrain', stage = 2 } = {}) {
  const farm = getFarm();
  const { N, W, L, inPivot, health } = farm;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(DPR());
  const scene = new THREE.Scene();
  const half = W / 2;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
  cam.position.set(0, 20, 0);
  cam.up.set(0, 0, -1); // screen up = north (-z), so u -> left %, v -> top %
  cam.lookAt(0, 0, 0);

  const mat = realTerrainMaterial({ contour: 0.085, contourAlpha: 0.03, ring: farm.ringSpacing });
  const mesh = farm.mesh(farm.colorsFor(layer, stage).colors, mat);
  scene.add(mesh);
  addLights(scene, null, renderer);
  farm.addDetail(scene);
  for (const p of L.pivots) {
    const pts = [];
    for (let a = 0; a <= 96; a++) pts.push(farm.toWorld(p.u + Math.cos(a / 96 * 6.2832) * p.r, p.v + Math.sin(a / 96 * 6.2832) * p.r, 0.05));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x0b0d0c, transparent: true, opacity: 0.75 })));
  }

  linearizeUnlit(scene);
  mat.uniforms.uNatural.value = layer === 'terrain' ? 1 : 0;
  function render() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    cam.left = -half * Math.max(1, aspect); cam.right = half * Math.max(1, aspect);
    cam.top = half * Math.max(1, 1 / aspect); cam.bottom = -half * Math.max(1, 1 / aspect);
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    canvas.dispatchEvent(new Event('twin:ready', { bubbles: true }));
  }
  new ResizeObserver(render).observe(canvas);
  render();

  const alerts = farmAlerts(farm);

  return {
    alerts,
    setLayer(l) {
      mat.uniforms.uNatural.value = l === 'terrain' ? 1 : 0;
      mesh.geometry.attributes.color.array.set(farm.colorsFor(l, stage).colors);
      mesh.geometry.attributes.color.needsUpdate = true;
      render();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Engineering: a centre pivot designed on the real terrain            */
/* ------------------------------------------------------------------ */

export function initEngineering(canvas, { onReadout } = {}) {
  const farm = getFarm();
  const { N, W, L, inPivot } = farm;
  const p = L.pivots[0];
  const h0 = sample(L.h, N, p.u, p.v);
  const centre = farm.toWorld(p.u, p.v);
  const viewer = createViewer(canvas, {
    camPos: [centre.x + 1.55, centre.y + 1.0, centre.z + 1.75],
    target: [centre.x, centre.y + 0.02, centre.z], autoRotate: 0.35, minDist: 0.7, maxDist: 5,
  });
  const { scene } = viewer;
  // 2 m contour interval (vertical units: VS per 60 m of relief)
  const mat = realTerrainMaterial({ contour: (farm.VS / SITE.reliefM) * 2, contourAlpha: 0.22, ring: farm.ringSpacing });
  const crop = farm.colorsFor('terrain', 3).colors;
  let dev = 0;
  for (let k = 0; k < N * N; k++) if (inPivot[k] === 0) dev = Math.max(dev, Math.abs(L.h[k] - h0));
  const relief = farm.colorsFor('terrain', 3, { pivotRelief: { index: 0, h0, scaleM: dev * SITE.reliefM } }).colors;
  const mesh = farm.mesh(relief.slice(), mat);
  scene.add(mesh);
  addLights(scene, [3, 7], viewer.renderer, { center: centre, extent: 1.9 });
  farm.addDetail(scene);

  const pivot = buildPivot(farm, p, { towers: 7 });
  scene.add(pivot.group);
  const ring = [];
  for (let a = 0; a <= 128; a++) ring.push(farm.toWorld(p.u + Math.cos(a / 128 * 6.2832) * p.r, p.v + Math.sin(a / 128 * 6.2832) * p.r, 0.006));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: 0xc6f36b })));

  let theta = 0.6, t = 0;
  viewer.tickers.push((dt) => {
    t += dt;
    if (!REDUCED_MOTION) theta += dt * 0.12;
    pivot.update(theta, t);
  });

  // Engineering numbers measured from the terrain under the span
  const mPerUnit = (SITE.km * 1000) / W;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < N * N; k++) if (inPivot[k] === 0) { lo = Math.min(lo, L.h[k]); hi = Math.max(hi, L.h[k]); }
  const rangeM = (hi - lo) * SITE.reliefM;
  let maxGrade = 0;
  const towers = 7, R = p.r;
  for (let a = 0; a < 72; a++) {
    const ca = Math.cos(a / 72 * 6.2832), sa = Math.sin(a / 72 * 6.2832);
    let prev = h0;
    for (let i = 1; i <= towers; i++) {
      const hh = sample(L.h, N, p.u + ca * R * i / towers, p.v + sa * R * i / towers);
      const grade = Math.abs(hh - prev) * SITE.reliefM / ((R / towers) * SITE.km * 1000) * 100;
      maxGrade = Math.max(maxGrade, grade);
      prev = hh;
    }
  }
  const radiusM = p.r * W * mPerUnit;
  onReadout?.({
    radiusM, areaHa: Math.PI * radiusM ** 2 / 10000, towers,
    rangeM, pressureBar: rangeM * 0.0981, maxGrade,
  });

  linearizeUnlit(scene);
  mat.uniforms.uNatural.value = 0; // starts on "height under span"
  return {
    setRelief(on) {
      mat.uniforms.uNatural.value = on ? 0 : 1;
      mesh.geometry.attributes.color.array.set(on ? relief : crop);
      mesh.geometry.attributes.color.needsUpdate = true;
    },
    zoom: viewer.zoom,
    setInteractive: viewer.setInteractive,
  };
}

/* ------------------------------------------------------------------ */
/* Outcome: today vs the designed farm, rendered from the same twin    */
/* ------------------------------------------------------------------ */

export function renderOutcome(beforeImg, afterImg, { width = LOW ? 1100 : 1600, height = LOW ? 564 : 820 } = {}) {
  const farm = getFarm();
  const { L } = farm;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(lin(0x0b0d0c), 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(28, width / height, 0.1, 100);
  cam.position.set(6.2, 3.4, 7.4);
  const aim = L.pivots.length ? L.pivots.reduce((s, p) => s.add(farm.toWorld(p.u, p.v)), new THREE.Vector3()).divideScalar(L.pivots.length) : new THREE.Vector3(0, 0.3, 0);
  cam.position.set(aim.x + 3.6, aim.y + 2.3, aim.z + 4.4);
  cam.lookAt(aim);
  const mat = realTerrainMaterial({ contour: 0.085, contourAlpha: 0.03, ring: farm.ringSpacing });
  const before = farm.colorsFor('terrain', 0, { untouched: true }).colors;
  const after = farm.colorsFor('terrain', 3).colors;
  const mesh = farm.mesh(before.slice(), mat);
  scene.add(mesh, farm.skirt());
  addLights(scene, [11, 24], renderer);
  const det = farm.addDetail(scene, { preclear: true, planted: false, farmyard: false });
  mat.uniforms.uFarm.value = 0;
  linearizeUnlit(scene);
  renderer.render(scene, cam);
  beforeImg.src = canvas.toDataURL('image/jpeg', 0.88);

  mesh.geometry.attributes.color.array.set(after);
  mesh.geometry.attributes.color.needsUpdate = true;
  L.pivots.forEach((p, i) => {
    const pv = buildPivot(farm, p, { spray: false });
    pv.update(0.9 + i * 2.1);
    scene.add(pv.group);
    const ring = [];
    for (let a = 0; a <= 96; a++) ring.push(farm.toWorld(p.u + Math.cos(a / 96 * 6.2832) * p.r, p.v + Math.sin(a / 96 * 6.2832) * p.r, 0.01));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: 0xc6f36b, transparent: true, opacity: 0.8 })));
  });
  det.preclear.visible = false;
  mat.uniforms.uFarm.value = 1;
  det.orchard.visible = det.plantation.visible = det.yard.visible = true;
  linearizeUnlit(scene);
  renderer.render(scene, cam);
  afterImg.src = canvas.toDataURL('image/jpeg', 0.88);
  renderer.dispose();
  renderer.forceContextLoss();
}

/* ------------------------------------------------------------------ */
/* Story: one twin, four camera stops (Survey, Model, Engineer, Watch) */
/* ------------------------------------------------------------------ */

const ALERT_COLORS = { flood: 0x48a8e8, fire: 0xff5a4a, pest: 0xff8a3d, disease: 0xff8a3d, wind: 0xb9c3ff, change: 0xc6f36b };

export function initStory(canvas) {
  const farm = getFarm();
  const { N, W, VS, L, inPivot, groundY } = farm;
  const viewer = createViewer(canvas, { camPos: [9.5, 7.2, 10.5], target: [0, 0.2, 0], autoRotate: 0, orbit: false });
  const { scene, camera, controls } = viewer;

  // Terrain whose colours blend between chapters
  const colors = new Float32Array(N * N * 3);
  let target = colors, blending = false;
  const mat = realTerrainMaterial({ contour: 0.085, contourAlpha: 0.07, ring: farm.ringSpacing });
  const terrain = farm.mesh(colors, mat);
  scene.add(terrain, farm.skirt());
  addLights(scene, [18, 42], viewer.renderer);
  const det = farm.addDetail(scene, { preclear: true, planted: false, farmyard: false });

  const ring = (p, y, color, opacity) => {
    const pts = [];
    for (let a = 0; a <= 96; a++) pts.push(farm.toWorld(p.u + Math.cos(a / 96 * 6.2832) * p.r, p.v + Math.sin(a / 96 * 6.2832) * p.r, y));
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  };

  // 1 · Survey: lawn-mower flight lines, a survey aircraft flying them, soil sample points
  const survey = new THREE.Group();
  const alt = VS + 0.9, flight = [];
  for (let r = 0; r < 12; r++) {
    const z = (-0.45 + r / 11 * 0.9) * W;
    const xs = r % 2 ? [0.45 * W, -0.45 * W] : [-0.45 * W, 0.45 * W];
    flight.push(new THREE.Vector3(xs[0], alt, z), new THREE.Vector3(xs[1], alt, z));
  }
  const flightLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(flight),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.4 }));
  flightLine.computeLineDistances();
  survey.add(flightLine);
  const craft = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc6f36b }));
  const footprint = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 48), new THREE.MeshBasicMaterial({ color: 0xc6f36b, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  footprint.rotation.x = -Math.PI / 2;
  survey.add(craft, footprint);
  const legLen = flight.slice(1).map((v, i) => v.distanceTo(flight[i]));
  const pathLen = legLen.reduce((a, b) => a + b, 0);
  const dotGeo = new THREE.SphereGeometry(0.045, 10, 8), dotMat = new THREE.MeshBasicMaterial({ color: 0xc6f36b });
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const u = 0.08 + (c + 0.5 * (r % 2)) / 9 * 0.84, v = 0.08 + r / 8 * 0.84;
    const k = Math.round(v * (N - 1)) * N + Math.round(u * (N - 1));
    if (L.field[k] < 0 && inPivot[k] < 0) continue;
    const m = new THREE.Mesh(dotGeo, dotMat);
    m.position.copy(farm.toWorld(u, v, 0.05));
    survey.add(m);
  }
  scene.add(survey);

  // 2 · Model: borehole targets on the low, wet ground near the river
  const model = new THREE.Group();
  const holes = [];
  for (let t = 0; t < 3; t++) {
    let best = -Infinity, bk = 0;
    for (let j = 10; j < N - 10; j += 2) for (let i = 10; i < N - 10; i += 2) {
      const k = j * N + i, u = i / (N - 1), v = j / (N - 1);
      if (L.riverMask[k] > 0.05 || inPivot[k] >= 0) continue;
      if (holes.some((h) => Math.hypot(h.u - u, h.v - v) < 0.16)) continue;
      const sc = L.moisture[k] * (1 - L.h[k]) - 0.6 * L.slope[k] - 0.4 * Math.hypot(u - 0.45, v - 0.5);
      if (sc > best) { best = sc; bk = k; }
    }
    holes.push({ u: (bk % N) / (N - 1), v: Math.floor(bk / N) / (N - 1) });
  }
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x48a8e8 });
  holes.forEach((h) => {
    const base = farm.toWorld(h.u, h.v, 0);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8), holeMat);
    post.position.set(base.x, base.y + 0.45, base.z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), holeMat);
    cap.position.set(base.x, base.y + 0.92, base.z);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: 0x48a8e8, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(base.x, base.y + 0.02, base.z);
    model.add(post, cap, halo);
  });
  scene.add(model);
  const holeCentre = holes.reduce((a, h) => a.add(farm.toWorld(h.u, h.v, 0)), new THREE.Vector3()).divideScalar(holes.length);

  // 3 · Engineer: the designed farm, pivot rings, a working pivot
  const engineer = new THREE.Group();
  L.pivots.forEach((p) => engineer.add(ring(p, 0.02, 0xc6f36b, 0.75)));
  const pivot = L.pivots.length ? buildPivot(farm, L.pivots[0]) : null;
  if (pivot) engineer.add(pivot.group);
  scene.add(engineer);
  const pc = L.pivots.length ? farm.toWorld(L.pivots[0].u, L.pivots[0].v, 0) : new THREE.Vector3();

  // 4 · Watch: alert beacons standing on the farm
  const watch = new THREE.Group();
  const alerts = farmAlerts(farm);
  const beacons = alerts.map((a) => {
    const base = farm.toWorld(a.u, a.v, 0), col = ALERT_COLORS[a.k];
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 }));
    beam.position.y = 0.7;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshBasicMaterial({ color: col }));
    head.position.y = 1.45;
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03;
    g.add(beam, head, halo);
    g.position.copy(base);
    watch.add(g);
    return { g, halo };
  });
  L.pivots.forEach((p) => watch.add(ring(p, 0.05, 0x0b0d0c, 0.7)));
  scene.add(watch);

  // Chapters: colours, what is shown, and where the camera sits
  const fit = (off) => off.clone().multiplyScalar(camera.aspect < 1 ? Math.min(1.6, 0.92 / camera.aspect) : 1);
  const CHAPTERS = [
    { colors: () => farm.colorsFor('terrain', 0, { untouched: true }).colors, groups: [survey], wood: 'wild', contour: 0.1,
      pose: () => ({ tgt: new THREE.Vector3(0, 0.2, 0), pos: new THREE.Vector3(0, 0.2, 0).add(fit(new THREE.Vector3(9.5, 7.0, 10.5))) }) },
    { colors: () => farm.colorsFor('water', 0, { untouched: true }).colors, groups: [model], wood: 'none', contour: 0.32,
      pose: () => ({ tgt: holeCentre.clone().add(new THREE.Vector3(0, 0.2, 0)), pos: holeCentre.clone().add(fit(new THREE.Vector3(4.6, 3.6, 5.2))) }) },
    { colors: () => farm.colorsFor('terrain', 3).colors, groups: [engineer], wood: 'farm', contour: 0.16,
      pose: () => ({ tgt: pc.clone().add(new THREE.Vector3(0, 0.02, 0)), pos: pc.clone().add(fit(new THREE.Vector3(1.55, 1.0, 1.75))) }) },
    { colors: () => farm.colorsFor('ndvi', 2).colors, groups: [watch], wood: 'farm', contour: 0.04,
      pose: () => {
        const h = 5.6 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect);
        return { tgt: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(0.01, h, 0.9) };
      } },
  ];
  const ALL = [survey, model, engineer, watch];
  const cache = new Map();
  const colorsOf = (i) => { if (!cache.has(i)) cache.set(i, CHAPTERS[i].colors()); return cache.get(i); };

  let step = 0, from = null, t0 = 0, swapped = true;
  const DUR = REDUCED_MOTION ? 0 : 1.9;
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function applyScene(i) {
    const c = CHAPTERS[i];
    ALL.forEach((g) => { g.visible = c.groups.includes(g); });
    const farmed = c.wood === 'farm';
    det.preclear.visible = c.wood === 'wild';
    det.natural.visible = c.wood !== 'none';
    det.orchard.visible = det.plantation.visible = det.yard.visible = farmed;
    mat.uniforms.uContourAlpha.value = c.contour;
    mat.uniforms.uFarm.value = farmed ? 1 : 0;
    mat.uniforms.uNatural.value = i === 0 || i === 2 ? 1 : 0;
  }
  function go(i) {
    if (i === step && from) return;
    from = { pos: camera.position.clone(), tgt: controls.target.clone() };
    step = i; t0 = performance.now(); swapped = false;
    target = colorsOf(i); blending = true;
    if (!DUR) { applyScene(i); swapped = true; }
  }

  // Start on chapter 1
  colors.set(colorsOf(0));
  terrain.geometry.attributes.color.needsUpdate = true;
  applyScene(0);
  { const p0 = CHAPTERS[0].pose(); camera.position.copy(p0.pos); controls.target.copy(p0.tgt); camera.lookAt(p0.tgt); }

  let clock = 0;
  viewer.tickers.push((dt) => {
    clock += dt;
    // Camera: ease between chapters, then drift gently
    const to = CHAPTERS[step].pose();
    const k = from && DUR ? Math.min(1, (performance.now() - t0) / (DUR * 1000)) : 1;
    if (!swapped && k >= 0.45) { applyScene(step); swapped = true; }
    const e = ease(k);
    const pos = from ? from.pos.clone().lerp(to.pos, e) : to.pos;
    const tgt = from ? from.tgt.clone().lerp(to.tgt, e) : to.tgt;
    if (!REDUCED_MOTION) {
      const off = pos.clone().sub(tgt), a = Math.sin(clock * 0.12) * 0.07;
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      pos.copy(tgt).add(off);
    }
    camera.position.copy(pos); controls.target.copy(tgt); camera.lookAt(tgt);

    // Colours
    if (blending) {
      const a = 1 - Math.exp(-dt * 5);
      let maxD = 0;
      for (let n = 0; n < colors.length; n++) { const d = target[n] - colors[n]; colors[n] += d * a; if (Math.abs(d) > maxD) maxD = Math.abs(d); }
      terrain.geometry.attributes.color.needsUpdate = true;
      if (maxD < 0.002) blending = false;
    }

    // Chapter animation
    if (survey.visible) {
      let d = ((clock * 1.6) % pathLen), seg = 0;
      while (seg < legLen.length - 1 && d > legLen[seg]) { d -= legLen[seg]; seg++; }
      craft.position.copy(flight[seg]).lerp(flight[seg + 1], d / legLen[seg]);
      footprint.position.set(craft.position.x, groundY(craft.position.x / W + 0.5, craft.position.z / W + 0.5) + 0.03, craft.position.z);
    }
    if (engineer.visible && pivot) pivot.update(0.6 + clock * 0.25, clock);
    if (watch.visible) beacons.forEach((b, i) => { const s = 1 + 0.35 * Math.sin(clock * 3 + i); b.halo.scale.set(s, s, s); });
    if (model.visible) model.children.forEach((m) => { if (m.geometry.type === 'RingGeometry') { const s = 1 + 0.3 * Math.sin(clock * 2.5); m.scale.set(s, s, s); } });
  });

  linearizeUnlit(scene);
  return { go, alerts, holes, chapters: CHAPTERS.length };
}
