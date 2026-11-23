// Scene detail for the farm twin: trees, orchards, plantation, farmyard, lighting.
// Kept separate from scenes.js; everything is placed from data computed in getFarm().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './terrain.js';

const LIGHT_DIR = new THREE.Vector3(-0.5, 0.9, 0.35).normalize();

/** Low-power tier: touch devices, small screens, few cores or little memory. */
export const LOW = (() => {
  const mq = (q) => window.matchMedia(q).matches;
  const cores = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
  return mq('(pointer: coarse)') || Math.min(screen.width, screen.height) < 700 || cores <= 4 || mem <= 4;
})();

/** Lights + fog matched to the terrain shader so meshes and ground agree. */
export function addLights(scene, fog = null) {
  scene.add(new THREE.HemisphereLight(0xe6eef8, 0x5a4a34, 2.3));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.position.copy(LIGHT_DIR).multiplyScalar(20);
  scene.add(sun);
  if (fog) scene.fog = new THREE.Fog(0x0b0d0c, fog[0], fog[1]);
}

function colorize(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getY(i));
    col.set(c, i * 3);
  }
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

/** Unit-height tree geometries (scaled per instance). Canopy is white so instance colour tints it. */
const TREE_GEO = {};
function treeGeometry(kind) {
  if (TREE_GEO[kind]) return TREE_GEO[kind];
  const D = LOW ? 0 : 1; // canopy subdivision: 20 faces on the low tier, 80 otherwise
  const bark = [0.32, 0.24, 0.17];
  const shade = (ny) => { const v = 0.55 + 0.45 * Math.max(0, ny); return [v, v, v]; };
  let trunk, canopy;
  if (kind === 'euc') { // tall, narrow crown
    trunk = new THREE.CylinderGeometry(0.035, 0.06, 0.7, 5, 1, true).translate(0, 0.35, 0);
    canopy = lumpy(new THREE.IcosahedronGeometry(0.5, D), 3, 0.18).scale(0.38, 0.75, 0.38).translate(0, 0.72, 0);
  } else if (kind === 'citrus') { // dense round crown, short trunk
    trunk = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 5, 1, true).translate(0, 0.15, 0);
    canopy = lumpy(new THREE.IcosahedronGeometry(0.5, D), 7, 0.12).scale(1, 0.9, 1).translate(0, 0.58, 0);
  } else { // miombo: flat umbrella crown
    trunk = new THREE.CylinderGeometry(0.05, 0.09, 0.62, 5, 1, true).translate(0, 0.31, 0);
    canopy = lumpy(new THREE.IcosahedronGeometry(0.5, D), 11, 0.22).scale(1, 0.5, 1).translate(0, 0.76, 0);
  }
  const t = colorize(trunk, () => bark);
  const c = colorize(canopy, (x, y, z, ny) => shade(ny));
  return (TREE_GEO[kind] = mergeGeometries([t, c]));
}

/** InstancedMesh of trees from a list of {x, y, z, w, h, c:[r,g,b], rot}. */
export function treeMesh(list, kind, { thin = false } = {}) {
  // On the low tier, scattered woodland keeps every other tree with slightly wider crowns,
  // so canopy cover looks the same with half the geometry. Planted rows are never thinned.
  if (LOW && thin) list = list.filter((_, i) => i % 2 === 0).map((t) => ({ ...t, w: t.w * 1.3 }));
  const geo = treeGeometry(kind);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  list.forEach((t, i) => {
    q.setFromAxisAngle(up, t.rot);
    m.compose(p.set(t.x, t.y, t.z), q, s.set(t.w, t.h, t.w));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.setRGB(t.c[0], t.c[1], t.c[2]));
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Farmyard: sheds, silos, tank, solar array and a tractor, sitting on the ground. */
export function yardGroup(farm) {
  const { yard, groundY, W } = farm;
  const g = new THREE.Group();
  const L = (c) => new THREE.MeshLambertMaterial({ color: c });
  const wall = L(0xd9d3c4), roof = L(0xaeb4b8), steel = L(0xc7cbcf), dark = L(0x1a1d1f), panel = L(0x1d2c4c), red = L(0xb34a2c);
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
    g.add(mesh);
    return mesh;
  };
  const U = 1 / 2400; // 1 metre in uv units (site is 2.4 km)
  const Y = (m) => (m / 240) * 1.6; // metres to world height, mildly exaggerated
  const X = (m) => (m / 240) * 1.1; // metres to world horizontal, slightly enlarged for legibility

  // Sheds with pitched roofs
  [[0, 0, 34, 16], [0, 26, 28, 14], [-30, 8, 20, 12]].forEach(([du, dv, len, wid]) => {
    put(new THREE.Mesh(new THREE.BoxGeometry(X(len), Y(6), X(wid)), wall), du * U, dv * U, Y(3));
    const r = new THREE.Mesh(new THREE.CylinderGeometry(X(wid) * 0.62, X(wid) * 0.62, X(len) * 1.02, 3, 1), roof);
    r.geometry.rotateZ(Math.PI / 2);
    r.geometry.scale(1, 0.45, 1);
    put(r, du * U, dv * U, Y(6) + X(wid) * 0.12);
  });
  // Grain silos
  [[34, -6], [44, -6], [54, -6]].forEach(([du, dv]) => {
    put(new THREE.Mesh(new THREE.CylinderGeometry(X(4.5), X(4.5), Y(14), 14), steel), du * U, dv * U, Y(7));
    put(new THREE.Mesh(new THREE.ConeGeometry(X(4.7), Y(3), 14), roof), du * U, dv * U, Y(15.5));
  });
  // Water tank on a stand
  put(new THREE.Mesh(new THREE.CylinderGeometry(X(3.5), X(3.5), Y(4), 12), L(0x8f9a9f)), 40 * U, 26 * U, Y(8));
  put(new THREE.Mesh(new THREE.BoxGeometry(X(5), Y(6), X(5)), dark), 40 * U, 26 * U, Y(3)).scale.set(1, 1, 1);
  // Solar array (pumping)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    const p = put(new THREE.Mesh(new THREE.BoxGeometry(X(4), Y(0.3), X(2.2)), panel), (-34 + c * 5) * U, (34 + r * 4) * U, Y(1.6));
    p.rotation.x = -0.45;
  }
  // Tractor with cab
  const tr = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(X(4.2), Y(1.6), X(2)), red); body.position.y = Y(1.6); tr.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(X(1.8), Y(1.8), X(1.9)), L(0x2a3236)); cab.position.set(-X(0.9), Y(3.1), 0); tr.add(cab);
  [[-1.4, 1.1, 1.0], [-1.4, -1.1, 1.0], [1.4, 1.0, 0.65], [1.4, -1.0, 0.65]].forEach(([x, z, r]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(X(r), X(r), X(0.5), 10), dark);
    w.rotation.x = Math.PI / 2; w.position.set(X(x), Y(r) * 0.9, X(z)); tr.add(w);
  });
  put(tr, 18 * U, -18 * U, 0);
  return g;
}
