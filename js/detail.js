// Scene detail and physically based look for the farm twin: lighting (sky environment,
// sun shadows, filmic tone mapping), trees, the farmyard and the river surface.
// Everything is placed from data computed in getFarm().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mulberry32 } from './terrain.js';

/** Low-power tier: touch devices, small screens, few cores or little memory. */
export const LOW = (() => {
  const mq = (q) => window.matchMedia(q).matches;
  const cores = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'high') return false;
  if (q === 'low') return true;
  return mq('(pointer: coarse)') || Math.min(screen.width, screen.height) < 700 || cores <= 4 || mem <= 4;
})();

/** Afternoon sun in the dry season: from the north-west, about 35° above the horizon. */
export const SUN_DIR = new THREE.Vector3(-0.62, 0.56, 0.55).normalize();

/** sRGB hex (as authored) to a linear colour for lighting maths. */
export const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

/* ---------------- Renderer, sky environment, sun ---------------- */

function setupRenderer(renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  if (!LOW) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
}

const ENV = new WeakMap();
/** Image-based lighting from a physical sky, so ground, trees and water pick up skylight and reflections. */
function skyEnvironment(renderer) {
  if (ENV.has(renderer)) return ENV.get(renderer);
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const u = sky.material.uniforms;
  u.turbidity.value = 7;          // dry-season haze
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(SUN_DIR).multiplyScalar(100);
  const scene = new THREE.Scene();
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  ENV.set(renderer, tex);
  return tex;
}

/**
 * Light a farm scene: sky environment, warm sun with soft shadows, low bounce light.
 * `center` and `extent` frame the shadow map (tight framing = sharper shadows).
 */
export function addLights(scene, fog = null, renderer = null, { center = new THREE.Vector3(), extent = 7.4 } = {}) {
  if (renderer) {
    setupRenderer(renderer);
    scene.environment = skyEnvironment(renderer);
  }
  const hemi = new THREE.HemisphereLight(lin(0xc9dcf2), lin(0x5a4630), 0.3);
  const sun = new THREE.DirectionalLight(lin(0xffead0), 3.6);
  sun.position.copy(center).addScaledVector(SUN_DIR, 20);
  sun.target.position.copy(center);
  if (!LOW) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent;
    c.near = 2; c.far = 45;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.015 * (extent / 7.4);
    sun.shadow.radius = 2.5;
  }
  scene.add(hemi, sun, sun.target);
  if (fog) scene.fog = new THREE.Fog(lin(0x0b0d0c), fog[0], fog[1]);
  return sun;
}

/**
 * Overlay graphics (rings, markers, flight lines) keep their exact brand colours:
 * convert to linear once and skip tone mapping.
 */
export function linearizeUnlit(root) {
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m || m.userData.linear || m.isMeshStandardMaterial || m.isShaderMaterial) return;
      if (m.color) m.color.convertSRGBToLinear();
      m.toneMapped = false;
      m.userData.linear = true;
    });
  });
}

/** Vertex/instance colours are authored in sRGB: decode them in the shader. */
export function srgbVertexColors(material) {
  material.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb *= pow(vColor.rgb, vec3(2.2));');
  };
  return material;
}

/* ---------------- Trees ---------------- */

function colorize(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.set(fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getY(i)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

function lumpy(geo, seed, amt) {
  const r = mulberry32(seed);
  const p = geo.attributes.position;
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(key)) cache.set(key, 1 + (r() * 2 - 1) * amt);
    const s = cache.get(key);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * A crown built from several lumpy lobes. Vertex shade darkens the underside and the
 * inside of the crown (cheap ambient occlusion); white elsewhere so instance colour tints it.
 * lobes: [x, y, z, sx, sy, sz, detail]
 */
function crown(lobes, seed, amt, top) {
  const parts = lobes.map(([x, y, z, sx, sy, sz, d], i) =>
    lumpy(new THREE.IcosahedronGeometry(0.5, d), seed + i * 13, amt).scale(sx, sy, sz).translate(x, y, z));
  return parts.map((g) => colorize(g, (x, y, z, ny) => {
    const under = 0.42 + 0.58 * Math.max(0, ny);
    const inner = 0.75 + 0.25 * Math.min(1, Math.hypot(x, z) * 2.2);
    const height = 0.8 + 0.2 * Math.min(1, Math.max(0, (y - top * 0.6) / (top * 0.4)));
    const v = under * inner * height;
    return [v, v, v];
  }));
}

const TREE_GEO = {};
function treeGeometry(kind) {
  if (TREE_GEO[kind]) return TREE_GEO[kind];
  const bark = [0.24, 0.18, 0.13];
  const d = LOW ? 0 : 1, s = 0; // main lobe detail; side lobes stay light
  let trunk, lobes;
  if (kind === 'euc') { // tall, narrow, layered crown
    trunk = new THREE.CylinderGeometry(0.03, 0.055, 0.8, 6, 1, true).translate(0, 0.4, 0);
    lobes = LOW ? [[0, 0.72, 0, 0.38, 0.75, 0.38, 0]]
      : [[0, 0.55, 0, 0.36, 0.42, 0.36, d], [0.04, 0.8, -0.02, 0.3, 0.36, 0.3, s], [-0.02, 1.0, 0.03, 0.2, 0.3, 0.2, s]];
  } else if (kind === 'citrus') { // dense, round, low skirt
    trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.28, 6, 1, true).translate(0, 0.14, 0);
    lobes = LOW ? [[0, 0.58, 0, 1, 0.9, 1, 0]]
      : [[0, 0.55, 0, 0.95, 0.85, 0.95, d], [0.22, 0.68, 0.1, 0.55, 0.5, 0.55, s], [-0.18, 0.66, -0.16, 0.5, 0.45, 0.5, s]];
  } else { // miombo: broad, flat-topped umbrella crown
    trunk = new THREE.CylinderGeometry(0.045, 0.08, 0.66, 6, 1, true).translate(0, 0.33, 0);
    lobes = LOW ? [[0, 0.76, 0, 1, 0.5, 1, 0]]
      : [[0, 0.78, 0, 0.92, 0.42, 0.92, d], [0.3, 0.74, 0.12, 0.55, 0.32, 0.55, s], [-0.26, 0.72, -0.2, 0.5, 0.3, 0.5, s], [0.05, 0.86, -0.28, 0.42, 0.28, 0.42, s]];
  }
  const top = Math.max(...lobes.map((l) => l[1] + l[4] / 2));
  const t = colorize(trunk, () => bark);
  return (TREE_GEO[kind] = mergeGeometries([t, ...crown(lobes, kind.length * 7, 0.2, top)]));
}

/** InstancedMesh of trees from a list of {x, y, z, w, h, c:[r,g,b], rot}. */
export function treeMesh(list, kind, { thin = false } = {}) {
  // On the low tier, scattered woodland keeps every other tree with slightly wider crowns,
  // so canopy cover looks the same with half the geometry. Planted rows are never thinned.
  if (LOW && thin) list = list.filter((_, i) => i % 2 === 0).map((t) => ({ ...t, w: t.w * 1.3 }));
  const geo = treeGeometry(kind);
  const mat = srgbVertexColors(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.7 }));
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  list.forEach((t, i) => {
    q.setFromAxisAngle(up, t.rot);
    m.compose(p.set(t.x, t.y, t.z), q, sc.set(t.w, t.h, t.w));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.setRGB(t.c[0], t.c[1], t.c[2]));
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.castShadow = !LOW;
  mesh.receiveShadow = !LOW;
  return mesh;
}

/* ---------------- Farmyard ---------------- */

/** Farmyard: sheds, silos, tank, solar array and a tractor, sitting on the ground. */
export function yardGroup(farm) {
  const { yard, groundY, W } = farm;
  const g = new THREE.Group();
  const M = (c, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color: lin(c), roughness, metalness });
  const wall = M(0xd6cfbf, 0.9), roof = M(0xa9b0b4, 0.42, 0.65), steel = M(0xc9cdd1, 0.32, 0.8), dark = M(0x1a1d1f, 0.7),
    panel = M(0x1b2a4a, 0.18, 0.3), red = M(0xb0432a, 0.45, 0.1), tank = M(0x8f9a9f, 0.4, 0.6);
  const at = (du, dv, lift = 0) => {
    const u = yard.u + du, v = yard.v + dv;
    return new THREE.Vector3((u - 0.5) * W, groundY(u, v) + lift, (v - 0.5) * W);
  };
  const rot = yard.angle;
  const put = (mesh, du, dv, lift) => {
    // rotate offsets with the yard so buildings face the road
    const c = Math.cos(rot), s = Math.sin(rot);
    const pu = du * c - dv * s, pv = du * s + dv * c;
    mesh.position.copy(at(pu, pv, lift));
    mesh.rotation.y = -rot;
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = !LOW; o.receiveShadow = !LOW; } });
    g.add(mesh);
    return mesh;
  };
  const U = 1 / 2400; // 1 metre in uv units (site is 2.4 km)
  const Y = (m) => (m / 240) * 1.6; // metres to world height, mildly exaggerated
  const X = (m) => (m / 240) * 1.1; // metres to world horizontal, slightly enlarged for legibility

  // Sheds with pitched corrugated roofs
  [[0, 0, 34, 16], [0, 26, 28, 14], [-30, 8, 20, 12]].forEach(([du, dv, len, wid]) => {
    put(new THREE.Mesh(new THREE.BoxGeometry(X(len), Y(6), X(wid)), wall), du * U, dv * U, Y(3));
    const r = new THREE.Mesh(new THREE.CylinderGeometry(X(wid) * 0.62, X(wid) * 0.62, X(len) * 1.02, 3, 1), roof);
    r.geometry.rotateZ(Math.PI / 2);
    r.geometry.scale(1, 0.45, 1);
    put(r, du * U, dv * U, Y(6) + X(wid) * 0.12);
  });
  // Grain silos
  [[34, -6], [44, -6], [54, -6]].forEach(([du, dv]) => {
    put(new THREE.Mesh(new THREE.CylinderGeometry(X(4.5), X(4.5), Y(14), 20), steel), du * U, dv * U, Y(7));
    put(new THREE.Mesh(new THREE.ConeGeometry(X(4.7), Y(3), 20), roof), du * U, dv * U, Y(15.5));
  });
  // Water tank on a stand
  put(new THREE.Mesh(new THREE.CylinderGeometry(X(3.5), X(3.5), Y(4), 16), tank), 40 * U, 26 * U, Y(8));
  put(new THREE.Mesh(new THREE.BoxGeometry(X(5), Y(6), X(5)), dark), 40 * U, 26 * U, Y(3));
  // Solar array (pumping)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    const p = put(new THREE.Mesh(new THREE.BoxGeometry(X(4), Y(0.3), X(2.2)), panel), (-34 + c * 5) * U, (34 + r * 4) * U, Y(1.6));
    p.rotation.x = -0.45;
  }
  // Tractor with cab
  const tr = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(X(4.2), Y(1.6), X(2)), red); body.position.y = Y(1.6); tr.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(X(1.8), Y(1.8), X(1.9)), M(0x2a3236, 0.2, 0.4)); cab.position.set(-X(0.9), Y(3.1), 0); tr.add(cab);
  [[-1.4, 1.1, 1.0], [-1.4, -1.1, 1.0], [1.4, 1.0, 0.65], [1.4, -1.0, 0.65]].forEach(([x, z, r]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(X(r), X(r), X(0.5), 14), dark);
    w.rotation.x = Math.PI / 2; w.position.set(X(x), Y(r) * 0.9, X(z)); tr.add(w);
  });
  put(tr, 18 * U, -18 * U, 0);
  return g;
}

/* ---------------- River surface ---------------- */

/**
 * A reflective water surface over the carved river bed, faded out at the banks.
 * N×N grid; heightAt(k) is the bed; mask(k) is 0..1 river presence.
 */
export function waterMesh(N, W, heightAt, mask) {
  const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 4), idx = [];
  const step = W / (N - 1);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    pos.set([-W / 2 + i * step, heightAt(k) + 0.007, -W / 2 + j * step], k * 3);
    const a = Math.min(1, Math.max(0, (mask[k] - 0.18) / 0.4));
    col.set([1, 1, 1, a * a * (3 - 2 * a)], k * 4);
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    if (Math.max(mask[a], mask[b], mask[c], mask[d]) < 0.2) continue;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: lin(0x14343f), roughness: 0.16, metalness: 0, vertexColors: true,
    transparent: true, depthWrite: false, envMapIntensity: 1.5,
  });
  // Small wind ripples: perturb the normal with world-space noise so the sky reflection breaks up.
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 wq = vWp.xz * vec2(38.0, 55.0);
        float r1 = wn(wq) - 0.5, r2 = wn(wq * 1.9 + 4.7) - 0.5;
        normal = normalize(normal + (viewMatrix * vec4(r1 * 0.07, 0.0, r2 * 0.07, 0.0)).xyz);`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = !LOW;
  mesh.renderOrder = 1;
  return mesh;
}
