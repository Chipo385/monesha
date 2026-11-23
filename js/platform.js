// Watch platform demo: KPIs, farm map with alerts, vigour chart, fields, visits, reports.
// All data is simulated and deterministic, built around the same farm as the 3D twin.
import { $, $$ } from './common.js';
import { mulberry32 } from './terrain.js';

const html = document.documentElement;
const DAY = 864e5;
const today = new Date(); today.setHours(0, 0, 0, 0);
const fmtDate = (d, opt = { day: 'numeric', month: 'short' }) => d.toLocaleDateString('en-GB', opt);
/** Change vs last pass: arrow + value, neutral when it rounds to zero. */
const delta = (v) => Math.abs(v) < 0.005 ? '<span class="flat">no change</span>'
  : `<span class="${v < 0 ? 'down' : 'up'}">${v < 0 ? '▼' : '▲'} ${Math.abs(v).toFixed(2)}</span>`;
const SEASON_DAY = 80;

/* ---------------- Theme (dark / light survey sheet) ---------------- */
const themeBtn = $('#theme-btn');
function setTheme(light) {
  if (light) html.dataset.theme = 'sheet'; else delete html.dataset.theme;
  themeBtn.setAttribute('aria-pressed', String(light));
  themeBtn.textContent = light ? 'Dark' : 'Light';
  $('meta[name="theme-color"]').content = light ? '#f6f3ea' : '#0b0d0c';
  try { localStorage.setItem('monesha-theme', light ? 'sheet' : 'dark'); } catch { /* private mode */ }
  drawTrend();
}
themeBtn.addEventListener('click', () => setTheme(html.dataset.theme !== 'sheet'));

/* ---------------- Simulated season data ---------------- */
const rand = mulberry32(7);
const WEEKS = 12;
const passes = Array.from({ length: WEEKS }, (_, i) => new Date(today - DAY - (WEEKS - 1 - i) * 7 * DAY));
function curve({ peak, start = 0.18, mid = 4.5, k = 0.9, dip = null, flat = false }) {
  return passes.map((_, w) => {
    let v = flat ? peak + (rand() - 0.5) * 0.03 : start + (peak - start) / (1 + Math.exp(-k * (w - mid)));
    if (dip && w >= dip.from) v -= dip.by * (w - dip.from + 1) / (WEEKS - dip.from);
    return Math.round((v + (rand() - 0.5) * 0.02) * 100) / 100;
  });
}
const FIELDS = [
  { id: 'p1', name: 'Pivot 1', crop: 'Maize, irrigated', ha: 10.2, ndvi: curve({ peak: 0.84, mid: 4 }), chart: true },
  { id: 'p2', name: 'Pivot 2', crop: 'Soybean, irrigated', ha: 10.2, ndvi: curve({ peak: 0.8, mid: 4.4, dip: { from: 9, by: 0.14 } }), chart: true,
    note: 'Canopy thinning in the north-east quarter; pattern consistent with fall armyworm.' },
  { id: 'b7', name: 'Block 7', crop: 'Maize, rain-fed lowland', ha: 18.0, ndvi: curve({ peak: 0.72, mid: 5.5, k: 0.7, dip: { from: 10, by: 0.06 } }), chart: true,
    note: 'Waterlogging risk: 62 mm forecast in 48 h, drain D2 near capacity.' },
  { id: 'oa', name: 'Orchard A', crop: 'Citrus, year 4', ha: 19.7, ndvi: curve({ peak: 0.7, flat: true, dip: { from: 9, by: 0.05 } }),
    note: 'Red-edge index down 11% in 9 days, rows 14–19.' },
  { id: 'pc', name: 'Plantation C', crop: 'Eucalyptus, year 3', ha: 18.4, ndvi: curve({ peak: 0.76, flat: true }) },
  { id: 'b4', name: 'Block 4', crop: 'Soybean, rain-fed', ha: 22.1, ndvi: curve({ peak: 0.74, mid: 5, k: 0.8 }) },
];
FIELDS.forEach((f) => {
  const n = f.ndvi.length, last = f.ndvi[n - 1], prev = f.ndvi[n - 2];
  f.now = last; f.delta = last - prev;
  f.status = f.id === 'p2' ? 'serious' : (f.note ? 'warning' : 'good');
});
const STATUS = {
  good: { label: 'On track', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  warning: { label: 'Watch', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2z" fill="currentColor"/><path d="M8 6.5v3.2M8 11.6v.1" stroke="#000" stroke-opacity=".75" stroke-width="1.6" stroke-linecap="round"/></svg>' },
  serious: { label: 'Act now', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" transform="rotate(45 8 8)" fill="currentColor"/><path d="M8 5.5v3.4M8 10.7v.1" stroke="#000" stroke-opacity=".75" stroke-width="1.6" stroke-linecap="round"/></svg>' },
};
const statusChip = (s) => `<span class="status status--${s}">${STATUS[s].icon}${STATUS[s].label}</span>`;

/* ---------------- KPIs ---------------- */
const totalHa = FIELDS.reduce((a, f) => a + f.ha, 0);
const wMean = (key) => FIELDS.reduce((a, f) => a + f[key] * f.ha, 0) / totalHa;
const meanNow = wMean('now'), meanDelta = wMean('delta');
$('#k-ndvi').textContent = meanNow.toFixed(2);
$('#k-ndvi-d').innerHTML = `${delta(meanDelta)} vs last week, ${FIELDS.length} fields`;
const flagged = FIELDS.filter((f) => f.status !== 'good');
$('#k-flag').textContent = flagged.reduce((a, f) => a + f.ha, 0).toFixed(1);
$('#k-flag-d').textContent = `${flagged.length} fields: ${flagged.map((f) => f.name).join(', ')}`;
$('#k-rain').textContent = '34';
$('#k-rain-d').textContent = '62 mm forecast in the next 48 h';
const nextVisit = new Date(+today + 5 * DAY);
$('#k-visit').textContent = fmtDate(nextVisit, { weekday: 'short', day: 'numeric', month: 'short' });
$('#k-visit-d').textContent = 'Agronomist and engineer, Pivot 2 first';
$('#season-day').textContent = `Day ${SEASON_DAY} of the season`;

/* ---------------- Alerts ---------------- */
const ALERTS = [
  { k: 'flood', title: 'Flood', where: 'Block 7 (lowland)', text: '62 mm forecast in 48 h; drain D2 near capacity. Clear D2 outlet before Thursday.', when: '06:10', sev: 'serious' },
  { k: 'pest', title: 'Pest', where: 'Pivot 2', text: 'Canopy pattern consistent with fall armyworm. Scout within 24 h.', when: '05:55', sev: 'serious' },
  { k: 'fire', title: 'Fire', where: 'North-east ridge', text: 'Grass fully cured, NE wind 24 km/h. Open firebreak 3.', when: '05:42', sev: 'warning' },
  { k: 'disease', title: 'Disease', where: 'Orchard A, rows 14–19', text: 'Red-edge index down 11% in 9 days.', when: 'Yesterday', sev: 'warning' },
  { k: 'wind', title: 'Wind', where: 'Ridge fields', text: 'Gusts to 70 km/h forecast; lodging risk on tall maize.', when: 'Mon', sev: 'warning' },
  { k: 'change', title: 'Change', where: 'East boundary', text: '1.8 ha of new clearing detected outside the farm.', when: 'Mon', sev: 'good' },
];
const acked = new Set();
function renderAlerts() {
  const open = ALERTS.filter((a) => !acked.has(a.k));
  $('#alert-count').textContent = open.length || '';
  $('#alerts-meta').textContent = `${open.length} open · ${acked.size} acknowledged`;
  $('#alert-list').innerHTML = ALERTS.map((a) => `
    <li class="alert${acked.has(a.k) ? ' is-acked' : ''}" data-k="${a.k}" tabindex="0">
      <div class="alert__top"><b class="alert__k">${a.title}</b>${a.sev === 'good' ? '<span class="status status--info">For information</span>' : statusChip(a.sev)}<time>${a.when}</time></div>
      <p><strong>${a.where}.</strong> ${a.text}</p>
      <button class="alert__ack" type="button" data-ack="${a.k}">${acked.has(a.k) ? 'Reopen' : 'Acknowledge'}</button>
    </li>`).join('');
}
renderAlerts();
$('#alert-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ack]');
  if (b) { const k = b.dataset.ack; acked.has(k) ? acked.delete(k) : acked.add(k); renderAlerts(); $(`[data-ack="${k}"]`)?.focus(); }
});
const hot = (k, on) => $$(`.pin[data-k="${k}"], .alert[data-k="${k}"]`).forEach((el) => el.classList.toggle('is-hot', on));
['mouseover', 'focusin'].forEach((ev) => $('#alert-list').addEventListener(ev, (e) => { const li = e.target.closest('.alert'); if (li) hot(li.dataset.k, true); }));
['mouseout', 'focusout'].forEach((ev) => $('#alert-list').addEventListener(ev, (e) => { const li = e.target.closest('.alert'); if (li) hot(li.dataset.k, false); }));

/* ---------------- Fields table with sparklines ---------------- */
function spark(vals) {
  const w = 96, h = 26, p = 3, lo = Math.min(...vals) - 0.02, hi = Math.max(...vals) + 0.02;
  const x = (i) => p + (i / (vals.length - 1)) * (w - 2 * p), y = (v) => h - p - ((v - lo) / (hi - lo)) * (h - 2 * p);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = vals.length - 1, dir = vals[last] < vals[0] - 0.01 ? 'falling' : vals[last] > vals[0] + 0.01 ? 'rising' : 'steady';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${dir}, ${vals[0].toFixed(2)} to ${vals[last].toFixed(2)}"><path d="${d}"/><circle cx="${x(last)}" cy="${y(vals[last])}" r="2.6"/></svg>`;
}
$('#fields-meta').textContent = `${totalHa.toFixed(1)} ha monitored`;
$('#field-rows').innerHTML = FIELDS.map((f) => `
  <tr>
    <th scope="row">${f.name}${f.note ? `<small>${f.note}</small>` : ''}</th>
    <td>${f.crop}</td>
    <td class="num">${f.ha.toFixed(1)} ha</td>
    <td class="num">${f.now.toFixed(2)} ${delta(f.delta)}</td>
    <td>${spark(f.ndvi.slice(-6))}</td>
    <td>${statusChip(f.status)}</td>
  </tr>`).join('');

/* ---------------- Vigour chart: 3 fields, one axis, crosshair tooltip ---------------- */
const SERIES = FIELDS.filter((f) => f.chart);
const chartEl = $('#trend-chart'), tip = $('#tip');
let hoverIdx = null;
function drawTrend() {
  const W = chartEl.clientWidth || 640, H = Math.max(220, Math.min(320, W * 0.42));
  const m = { t: 14, r: W < 520 ? 16 : 96, b: 30, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const x = (i) => m.l + (i / (WEEKS - 1)) * iw, y = (v) => m.t + (1 - v) * ih;
  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const grid = yTicks.map((t) => `<line class="grid" x1="${m.l}" x2="${m.l + iw}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t.toFixed(1)}</text>`).join('');
  const xTicks = passes.map((d, i) => (i % 2 === (WEEKS - 1) % 2) ? `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDate(d)}</text>` : '').join('');
  const lines = SERIES.map((s, si) => {
    const d = s.ndvi.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const lx = x(WEEKS - 1), ly = y(s.ndvi[WEEKS - 1]);
    return `<path class="line s${si + 1}" d="${d}"/><circle class="end s${si + 1}" cx="${lx}" cy="${ly}" r="4"/>`;
  }).join('');
  // Direct labels at line ends, nudged apart so they never collide
  const ends = SERIES.map((s, si) => ({ si, y: y(s.ndvi[WEEKS - 1]) + 4, name: s.name })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  const labels = W < 520 ? '' : ends.map((e) => `<text class="dlabel" x="${x(WEEKS - 1) + 10}" y="${e.y}">${e.name}</text>`).join('');
  const cross = hoverIdx == null ? '' : `<line class="cross" x1="${x(hoverIdx)}" x2="${x(hoverIdx)}" y1="${m.t}" y2="${m.t + ih}"/>` +
    SERIES.map((s, si) => `<circle class="dot s${si + 1}" cx="${x(hoverIdx)}" cy="${y(s.ndvi[hoverIdx])}" r="4.5"/>`).join('');
  chartEl.innerHTML = `
    <ul class="chart__legend">${SERIES.map((s, si) => `<li><i class="s${si + 1}"></i>${s.name}</li>`).join('')}</ul>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Line chart of mean NDVI by week for ${SERIES.map((s) => s.name).join(', ')}. Pivot 2 has fallen over the last three weeks." tabindex="0">
      <text class="axis-t" x="${m.l}" y="${m.t - 2}" dy="-2">NDVI</text>
      ${grid}${xTicks}${lines}${labels}${cross}
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>
    </svg>`;
  const svg = $('svg', chartEl);
  const toIdx = (ev) => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
    return Math.max(0, Math.min(WEEKS - 1, Math.round(((px - m.l) / iw) * (WEEKS - 1))));
  };
  const show = (i, ev) => {
    hoverIdx = i; drawTrend();
    const r = chartEl.getBoundingClientRect(), sx = r.left + (x(i) / W) * r.width;
    tip.innerHTML = `<b>${fmtDate(passes[i], { day: 'numeric', month: 'long' })}</b>` +
      SERIES.map((s, si) => `<span><i class="s${si + 1}"></i>${s.name}<em>${s.ndvi[i].toFixed(2)}</em></span>`).join('');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, sx + (sx + tw + 24 > r.right ? -tw - 16 : 16)))}px`;
    tip.style.top = `${(ev?.clientY ?? r.top + r.height / 2) - 30 + window.scrollY}px`;
  };
  const hide = () => { hoverIdx = null; tip.hidden = true; drawTrend(); };
  $('.hit', svg).addEventListener('pointermove', (ev) => { const i = toIdx(ev); if (i !== hoverIdx) show(i, ev); });
  $('.hit', svg).addEventListener('pointerleave', hide);
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      show(Math.max(0, Math.min(WEEKS - 1, (hoverIdx ?? WEEKS) + (ev.key === 'ArrowRight' ? 1 : -1))));
      $('svg', chartEl).focus();
    } else if (ev.key === 'Escape') hide();
  });
  svg.addEventListener('blur', () => { if (hoverIdx != null) setTimeout(() => { if (!chartEl.contains(document.activeElement)) hide(); }); });
}
new ResizeObserver(() => drawTrend()).observe(chartEl);

// Table view of the same data
$('#trend-table').innerHTML = `<table class="fields"><thead><tr><th scope="col">Pass</th>${SERIES.map((s) => `<th scope="col" class="num">${s.name}</th>`).join('')}</tr></thead><tbody>${
  passes.map((d, i) => `<tr><th scope="row">${fmtDate(d)}</th>${SERIES.map((s) => `<td class="num">${s.ndvi[i].toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
$('#trend-table-btn').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  e.currentTarget.classList.toggle('is-on', on);
  e.currentTarget.textContent = on ? 'Show as chart' : 'Show as table';
  $('#trend-table').hidden = !on;
  chartEl.hidden = on;
});

/* ---------------- Visits and reports ---------------- */
const visits = [
  { d: new Date(+today + 5 * DAY), t: 'Field assessment', who: 'Agronomist and engineer', what: 'Pivot 2 scouting, Orchard A rows 14–19, drain D2' },
  { d: new Date(+today + 19 * DAY), t: 'Field assessment', who: 'Agronomist', what: 'Mid-season check, all blocks' },
  { d: new Date(+today - 9 * DAY), t: 'Borehole yield check', who: 'Hydrogeologist', what: 'BH-A pump test: 14.5 m³/h sustained', done: true },
];
$('#visit-list').innerHTML = visits.map((v) => `
  <li class="${v.done ? 'is-done' : ''}">
    <time datetime="${v.d.toISOString().slice(0, 10)}"><b>${fmtDate(v.d, { day: 'numeric' })}</b>${fmtDate(v.d, { month: 'short' })}</time>
    <div><strong>${v.t}</strong>${v.done ? ' <span class="status status--good">' + STATUS.good.icon + 'Done</span>' : ''}<p>${v.who} · ${v.what}</p></div>
  </li>`).join('');
const reports = [
  { t: `Crop vigour report, week ${WEEKS}`, d: passes[WEEKS - 1], k: 'Weekly' },
  { t: 'Field assessment notes', d: new Date(+today - 9 * DAY), k: 'Visit' },
  { t: 'Borehole BH-A yield test', d: new Date(+today - 9 * DAY), k: 'Groundwater' },
  { t: 'Site baseline & development plan', d: new Date(+today - 140 * DAY), k: 'Survey' },
];
$('#report-list').innerHTML = reports.map((r) => `
  <li><div><strong>${r.t}</strong><span>${r.k} · ${fmtDate(r.d, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
  <button class="chip" type="button" disabled title="Not available in the demo">PDF</button></li>`).join('');

/* ---------------- Map (live 3D view of the farm from above; poster if no WebGL) ---------------- */
const LEGENDS = {
  terrain: '<li class="mono">Markers match the alerts list</li>',
  ndvi: '<li>Stressed <i class="ramp" style="--g:linear-gradient(90deg,#efe3a6,#c8cd78,#8db35a,#4f8a3f,#235f30)"></i> Vigorous</li>',
  water: '<li>Dry <i class="ramp" style="--g:linear-gradient(90deg,#e3d3a4,#a9bcae,#6a9cc6,#3471b3,#1b4685)"></i> Wet</li>',
};
$('#map-legend').innerHTML = LEGENDS.terrain;
const canWebGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
if (canWebGL) {
  document.addEventListener('twin:ready', (e) => e.target.closest('.is-loading')?.classList.remove('is-loading'));
  import('./scenes.js').then(({ initWatch }) => {
    const sky = initWatch($('#watch-canvas'), { stage: 3 });
    $('#sky-pins').innerHTML = sky.alerts.map((a) => `<span class="pin${a.u > 0.72 ? ' pin--left' : ''}" data-k="${a.k}" style="left:${(a.u * 100).toFixed(2)}%;top:${(a.v * 100).toFixed(2)}%"><i></i><b><span>${a.label}</span></b></span>`).join('');
    $$('[data-sky]').forEach((c) => c.addEventListener('click', () => {
      $$('[data-sky]').forEach((x) => { x.classList.toggle('is-on', x === c); x.setAttribute('aria-pressed', String(x === c)); });
      sky.setLayer(c.dataset.sky);
      $('#map-legend').innerHTML = LEGENDS[c.dataset.sky];
    }));
  }).catch(() => html.classList.add('no-webgl'));
} else {
  html.classList.add('no-webgl');
  $$('[data-sky]').forEach((c) => { c.disabled = true; });
}

/* ---------------- Section nav highlight ---------------- */
const navLinks = $$('.app__nav a');
const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (!e.isIntersecting) return;
  navLinks.forEach((a) => { if (a.getAttribute('href') === `#${e.target.id}`) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
}), { rootMargin: '-40% 0px -55% 0px' });
['overview', 'map', 'alerts', 'fields', 'visits'].forEach((id) => io.observe(document.getElementById(id)));

let saved = null;
try { saved = localStorage.getItem('monesha-theme'); } catch { /* private mode */ }
setTheme(saved === 'sheet');
