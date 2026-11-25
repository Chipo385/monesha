// Illustrative crop suitability model.
// Each factor is scored with a trapezoid [min, optLow, optHigh, max] -> 0..1.
// Irrigation can offset a rainfall deficit in proportion to available water.
// Requirements are generalised agronomic ranges for Zambian conditions; a real
// engagement replaces them with lab results, long-term climate and the groundwater model.

export const SITE_DEFAULTS = { rain: 1050, ph: 5.3, water: 18, drain: 1, soil: 'acrisol', texture: 2 };

export const CROPS = [
  { id: 'soy', tex: [2, 4], grp: 'field', name: 'Soybean', kind: 'Annual · rain-fed', rain: [450, 650, 1200, 1600], ph: [4.8, 5.8, 7.0, 7.8], irr: 0.1, need: 0, drain: 1, years: 0.5 },
  { id: 'maize', tex: [2, 4], grp: 'field', name: 'Maize', kind: 'Annual · rain-fed', rain: [500, 700, 1200, 1700], ph: [4.6, 5.5, 7.0, 7.8], irr: 0.15, need: 0, drain: 1, years: 0.5 },
  { id: 'wheat', tex: [3, 5], grp: 'field', name: 'Wheat', kind: 'Annual · winter, irrigated', rain: null, ph: [5.0, 5.8, 7.5, 8.2], irr: 1, need: 35, drain: 1, years: 0.5 },
  { id: 'citrus', tex: [1, 3], grp: 'tree', name: 'Oranges', kind: 'Orchard', rain: [600, 900, 1400, 2000], ph: [4.8, 5.8, 7.5, 8.3], irr: 0.7, need: 20, drain: 2, years: 4 },
  { id: 'avocado', tex: [2, 3], grp: 'tree', name: 'Avocado', kind: 'Orchard', rain: [700, 1000, 1600, 2200], ph: [4.8, 5.5, 6.5, 7.3], irr: 0.6, need: 22, drain: 2, years: 4 },
  { id: 'mac', tex: [2, 4], grp: 'tree', name: 'Macadamia', kind: 'Orchard', rain: [700, 1000, 2000, 2800], ph: [4.3, 5.0, 6.5, 7.3], irr: 0.5, need: 15, drain: 2, years: 6 },
  { id: 'euc', tex: [1, 4], grp: 'timber', name: 'Eucalyptus', kind: 'Timber / poles', rain: [550, 800, 1500, 2400], ph: [4.0, 4.8, 6.5, 7.8], irr: 0, need: 0, drain: 0, years: 7 },
  { id: 'pine', tex: [1, 3], grp: 'timber', name: 'Pine', kind: 'Timber', rain: [700, 950, 1600, 2500], ph: [3.8, 4.5, 6.0, 7.0], irr: 0, need: 0, drain: 1, years: 14 },
];

/** Soil texture classes, coarse to fine. Crops list the range that suits them. */
export const TEXTURES = ['Sand', 'Loamy sand', 'Sandy loam', 'Sandy clay loam', 'Clay loam', 'Clay'];

/** Main soil groups on Zambian farmland, with an illustrative fit per crop group. */
export const SOILS = {
  acrisol: { name: 'Acrisol (leached, acid)', field: 0.75, tree: 0.75, timber: 0.95 },
  lixisol: { name: 'Lixisol / Luvisol (fertile red-brown)', field: 1, tree: 0.95, timber: 0.95 },
  ferralsol: { name: 'Ferralsol (deep, weathered red)', field: 0.8, tree: 0.85, timber: 1 },
  nitisol: { name: 'Nitisol (deep red clay)', field: 1, tree: 1, timber: 0.95 },
  vertisol: { name: 'Vertisol (black cracking clay)', field: 0.8, tree: 0.4, timber: 0.45 },
  arenosol: { name: 'Arenosol (deep sand)', field: 0.5, tree: 0.6, timber: 0.75 },
  gleysol: { name: 'Gleysol (dambo, seasonally wet)', field: 0.5, tree: 0.25, timber: 0.35 },
};

// Inside the optimum the score still peaks at its centre, so crops separate.
const trap = ([a, b, c, d], x) => {
  if (x <= a || x >= d) return 0.05;
  const edge = 0.82;
  if (x < b) return 0.05 + (edge - 0.05) * (x - a) / (b - a);
  if (x > c) return 0.05 + (edge - 0.05) * (d - x) / (d - c);
  const t = Math.abs(x - (b + c) / 2) / ((c - b) / 2 || 1);
  return 1 - (1 - edge) * t * t;
};

export function scoreCrops(site) {
  return CROPS.map((c) => {
    const waterRatio = c.need ? Math.min(1, site.water / c.need) : 1;
    let rain = c.rain ? trap(c.rain, site.rain) : 1;
    if (c.irr > 0) rain += (1 - rain) * waterRatio * 0.85; // irrigation offsets deficit
    const ph = trap(c.ph, site.ph);
    const water = 1 - c.irr * (1 - waterRatio);
    // drainage: crop needs class c.drain (0 tolerant .. 2 needs free drainage)
    const drain = site.drain >= c.drain ? 1 : site.drain === c.drain - 1 ? 0.6 : 0.25;
    const off = Math.max(0, c.tex[0] - site.texture, site.texture - c.tex[1]);
    const texture = [1, 0.75, 0.5, 0.3, 0.2, 0.15][off];
    const soil = SOILS[site.soil][c.grp];
    // The weakest factor limits the crop (Liebig), on top of the weighted average.
    const limit = 0.5 + 0.5 * Math.min(1, Math.min(rain, ph, water, drain, texture, soil) / 0.8);
    const score = Math.round(limit * 100 * rain ** 0.25 * ph ** 0.25 * water ** 0.2 * drain ** 0.12 * texture ** 0.1 * soil ** 0.08);

    const factors = { rainfall: rain, 'soil pH': ph, water, drainage: drain, texture, 'soil type': soil };
    const weakest = Object.entries(factors).sort((a, b) => a[1] - b[1])[0];
    let why;
    if (weakest[1] > 0.88) why = `All measured factors in range · first revenue ${c.years < 1 ? 'this season' : `in about ${c.years} years`}`;
    else if (weakest[0] === 'soil pH') why = site.ph < c.ph[1] ? 'Limited by acidity · lime before planting' : 'Limited by alkalinity';
    else if (weakest[0] === 'texture') why = site.texture < c.tex[0] ? 'Soil too sandy: low water and nutrient holding' : 'Soil too heavy: slow drainage and restricted roots';
    else if (weakest[0] === 'soil type') why = `${SOILS[site.soil].name.split(' (')[0]} limits this crop · check depth, wetness and fertility`;
    else if (weakest[0] === 'water') why = `Needs ~${c.need} m³/h for a 20 ha block · more borehole yield required`;
    else if (weakest[0] === 'drainage') why = 'Root disease risk on poorly drained soils · ridging or site selection needed';
    else why = site.rain < (c.rain?.[1] ?? 0) ? 'Rainfall below optimum · supplementary irrigation advised' : 'Rainfall above optimum · disease and leaching pressure';
    return { id: c.id, name: c.name, kind: c.kind, score, why };
  }).sort((a, b) => b.score - a.score);
}
