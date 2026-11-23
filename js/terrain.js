// Procedural landscape model used by both 3D scenes.
// Produces an asymmetric heightfield with a meandering river, eroded slopes,
// real drainage (D8 flow accumulation), irregular field parcels and pivot sites.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export function makeNoise(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), mod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; mod12[i] = perm[i] % 12; }

  function corner(gi, x, y) {
    let t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    t *= t;
    const g = GRAD[gi];
    return t * t * (g[0] * x + g[1] * y);
  }

  return function noise2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    return 70 * (
      corner(mod12[ii + perm[jj]], x0, y0) +
      corner(mod12[ii + i1 + perm[jj + j1]], x1, y1) +
      corner(mod12[ii + 1 + perm[jj + 1]], x2, y2)
    );
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {object} o
 * @param {number} o.size     grid resolution (vertices per side)
 * @param {number} o.seed
 * @param {number} [o.erosion] thermal erosion iterations
 */
export function generateLandscape({ size = 192, seed = 7, erosion = 24 } = {}) {
  const N = size;
  const n1 = makeNoise(seed), n2 = makeNoise(seed + 101), n3 = makeNoise(seed + 202);
  const rand = mulberry32(seed + 9);

  const fbm = (x, y, oct, noise = n1) => {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) { s += a * noise(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; }
    return s / norm;
  };
  const ridged = (x, y, oct) => {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) { const r = 1 - Math.abs(n2(x * f, y * f)); s += a * r * r; norm += a; a *= 0.5; f *= 2.1; }
    return s / norm;
  };

  // Meandering river centreline (v as a function of u), with a tributary.
  const phase = rand() * 6.28;
  const riverV = (u) => 0.58 + 0.13 * Math.sin(u * 5.2 + phase) + 0.06 * Math.sin(u * 11.7 + phase * 1.7) + 0.05 * n3(u * 2.5, 3.1);
  const tribU = (v) => 0.3 + 0.06 * Math.sin(v * 7 + phase) + 0.03 * n3(4.2, v * 3);

  const h = new Float32Array(N * N);
  const riverMask = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), v = j / (N - 1);
      // Domain warp for organic, non-repeating forms
      const wx = fbm(u * 1.7 + 3.1, v * 1.7 - 1.3, 3, n3);
      const wy = fbm(u * 1.7 - 7.2, v * 1.7 + 2.9, 3, n3);
      const base = fbm(u * 1.9 + 0.45 * wx, v * 1.9 + 0.45 * wy, 5);
      // Kopje / ridge belt concentrated toward one corner (breaks symmetry)
      const ridgeMask = smooth(0.15, 0.85, 0.6 * (1 - v) + 0.4 * u + 0.25 * n3(u * 1.3, v * 1.3));
      const rid = ridged(u * 2.4 + wx, v * 2.4 + wy, 4);
      // Regional tilt toward the river valley
      const tilt = 0.18 * (1 - v) + 0.06 * u;
      let z = 0.42 + 0.32 * base + 0.3 * rid * ridgeMask * ridgeMask + tilt;

      // Carve main river + floodplain
      const dv = Math.abs(v - riverV(u));
      const channel = Math.exp(-((dv / 0.018) ** 2));
      const plain = Math.exp(-((dv / 0.09) ** 2));
      // Tributary joins from the north-west
      let trib = 0;
      if (v < riverV(tribU(v))) {
        const du = Math.abs(u - tribU(v));
        trib = Math.exp(-((du / 0.012) ** 2)) * smooth(0.0, 0.25, v);
      }
      const floodLevel = 0.36 + 0.05 * (1 - u);
      z = z * (1 - 0.65 * plain) + floodLevel * 0.65 * plain;
      z -= 0.07 * channel + 0.045 * trib;
      h[j * N + i] = z;
      riverMask[j * N + i] = Math.max(channel, trib * 0.8);
    }
  }

  // Thermal erosion: material slumps where slope exceeds the talus angle.
  const talus = 1.6 / N;
  const tmp = new Float32Array(N * N);
  for (let it = 0; it < erosion; it++) {
    tmp.set(h);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      const nb = [k - 1, k + 1, k - N, k + N];
      for (const m of nb) {
        const d = h[k] - h[m];
        if (d > talus) { const mv = 0.25 * (d - talus); tmp[k] -= mv; tmp[m] += mv; }
      }
    }
    h.set(tmp);
  }

  // Normalise to 0..1
  let lo = Infinity, hi = -Infinity;
  for (const z of h) { if (z < lo) lo = z; if (z > hi) hi = z; }
  for (let k = 0; k < h.length; k++) h[k] = (h[k] - lo) / (hi - lo);

  // Slope
  const slope = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const l = h[j * N + Math.max(0, i - 1)], r = h[j * N + Math.min(N - 1, i + 1)];
    const d = h[Math.max(0, j - 1) * N + i], u = h[Math.min(N - 1, j + 1) * N + i];
    slope[j * N + i] = Math.hypot(r - l, u - d) * N * 0.5;
  }
  // Normalise slope to 0..1 against the 95th percentile so thresholds are scale-free
  const sorted = Float32Array.from(slope).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  for (let k = 0; k < slope.length; k++) slope[k] = Math.min(1, slope[k] / p95);

  // D8 flow accumulation: drainage lines emerge from the terrain itself.
  const order = Array.from({ length: N * N }, (_, k) => k).sort((a, b) => h[b] - h[a]);
  const acc = new Float32Array(N * N).fill(1);
  for (const k of order) {
    const i = k % N, j = (k / N) | 0;
    let best = -1, drop = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const m = jj * N + ii;
      const dd = (h[k] - h[m]) / Math.hypot(di, dj);
      if (dd > drop) { drop = dd; best = m; }
    }
    if (best >= 0) acc[best] += acc[k];
  }
  const moisture = new Float32Array(N * N);
  const maxLog = Math.log(N * N);
  for (let k = 0; k < N * N; k++) {
    const flow = Math.log(acc[k]) / maxLog;
    moisture[k] = Math.min(1, 0.55 * flow + 0.45 * (1 - h[k]) ** 1.6 + 0.6 * riverMask[k]);
  }

  // Irregular field parcels: Voronoi cells on workable ground.
  const seeds = [];
  for (let s = 0; s < 34; s++) seeds.push([rand(), rand(), rand()]);
  const field = new Int16Array(N * N).fill(-1);
  const cropOf = seeds.map(() => rand());
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, u = i / (N - 1), v = j / (N - 1);
    if (slope[k] > 0.62 || riverMask[k] > 0.15 || h[k] > 0.82) continue;
    const dv = Math.abs(v - riverV(u));
    if (dv < 0.035) continue; // riparian buffer stays natural
    let best = 0, bd = Infinity;
    // Wobble the distance so boundaries follow contours rather than straight lines
    const wob = 0.02 * n3(u * 9, v * 9);
    for (let s = 0; s < seeds.length; s++) {
      const d = (u - seeds[s][0]) ** 2 + (v - seeds[s][1]) ** 2 + wob;
      if (d < bd) { bd = d; best = s; }
    }
    if (seeds[best][2] < 0.78) field[k] = best;
  }

  // Centre-pivot sites: flattest moist ground away from the river.
  const pivots = [];
  const R = 0.075;
  for (let attempt = 0; attempt < 400 && pivots.length < 2; attempt++) {
    const cu = 0.15 + rand() * 0.7, cv = 0.12 + rand() * 0.76;
    if (Math.abs(cv - riverV(cu)) < R + 0.06) continue;
    if (pivots.some((p) => Math.hypot(p.u - cu, p.v - cv) < 2.3 * R)) continue;
    let sMax = 0, hAvg = 0, n = 0;
    for (let a = 0; a < 24; a++) for (const rr of [0.3, 0.7, 1]) {
      const pu = cu + Math.cos(a / 24 * 6.283) * R * rr, pv = cv + Math.sin(a / 24 * 6.283) * R * rr;
      const k = Math.round(pv * (N - 1)) * N + Math.round(pu * (N - 1));
      if (k < 0 || k >= N * N) { sMax = 9; break; }
      sMax += slope[k]; hAvg += h[k]; n++;
    }
    if (sMax / n < 0.4 && hAvg / n < 0.75) pivots.push({ u: cu, v: cv, r: R });
  }

  return { N, h, slope, moisture, riverMask, field, cropOf, pivots, riverV };
}

/** Bilinear sample of a grid at normalised (u, v). */
export function sample(grid, N, u, v) {
  const x = Math.min(N - 1.001, Math.max(0, u * (N - 1))), y = Math.min(N - 1.001, Math.max(0, v * (N - 1)));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const a = grid[j * N + i], b = grid[j * N + i + 1], c = grid[(j + 1) * N + i], d = grid[(j + 1) * N + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
