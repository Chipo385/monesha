import { SITE_DEFAULTS, scoreCrops } from './suitability.js';
import { $, $$, initPage, bindForm } from './common.js';

initPage('.section__head, .split__text, .viewer, .fit, .svc__item, .pillars li, .road li, .facts li');

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
if (TOUCH) $$('[data-touch-text]').forEach((el) => { el.textContent = el.dataset.touchText; });

/* Loading placeholders clear when their 3D view draws its first frame */
document.addEventListener('twin:ready', (e) => e.target.closest('.is-loading')?.classList.remove('is-loading'));

/* Range fill (WebKit track colouring) */
function paintRange(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--fill', `${p}%`);
}
$$('input[type="range"]').forEach((el) => { paintRange(el); el.addEventListener('input', () => paintRange(el)); });

const feed = $('.feed');
if (REDUCED) feed.classList.add('is-in');
else new IntersectionObserver(([e], o) => {
  if (!e.isIntersecting) return;
  feed.classList.add('is-in');
  $$('li', feed).forEach((li, i) => { li.style.transitionDelay = `${i * 90}ms`; });
  o.disconnect();
}, { threshold: 0.3 }).observe(feed);

/* Before / after */
const ba = $('#ba');
const baRange = $('.ba__range', ba);
const setPos = (v) => { ba.style.setProperty('--pos', `${v}%`); ba.classList.toggle('is-left', v < 22); ba.classList.toggle('is-right', v > 78); };
baRange.addEventListener('input', () => { ba.dataset.touched = '1'; setPos(+baRange.value); });
/** When the comparison first comes into view, sweep the handle once so visitors see it can be dragged. */
function hintCompare() {
  if (REDUCED || ba.dataset.touched) return;
  const keys = [50, 32, 68, 50], dur = 1800, t0 = performance.now();
  const step = (t) => {
    if (ba.dataset.touched) return;
    const f = Math.min(1, (t - t0) / dur), seg = f * (keys.length - 1), i = Math.min(keys.length - 2, Math.floor(seg));
    const e = 0.5 - 0.5 * Math.cos((seg - i) * Math.PI);
    const v = keys[i] + (keys[i + 1] - keys[i]) * e;
    setPos(v); baRange.value = v;
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

new IntersectionObserver(([e], o) => {
  if (!e.isIntersecting) return;
  o.disconnect();
  $('#ba-after').decode().catch(() => {}).then(() => setTimeout(hintCompare, 300));
}, { threshold: 0.6 }).observe(ba);

/* Crop suitability */
const fitInputs = { rain: $('#f-rain'), ph: $('#f-ph'), water: $('#f-water'), drain: $('#f-drain') };
const DRAIN = ['Poor', 'Moderate', 'Free'];
fitInputs.rain.value = SITE_DEFAULTS.rain; fitInputs.ph.value = SITE_DEFAULTS.ph;
fitInputs.water.value = SITE_DEFAULTS.water; fitInputs.drain.value = SITE_DEFAULTS.drain;
const fitList = $('#fit-list');
function renderFit() {
  const site = { rain: +fitInputs.rain.value, ph: +fitInputs.ph.value, water: +fitInputs.water.value, drain: +fitInputs.drain.value };
  $('#o-rain').textContent = `${site.rain} mm`;
  $('#o-ph').textContent = site.ph.toFixed(1);
  $('#o-water').textContent = `${site.water} m³/h`;
  $('#o-drain').textContent = DRAIN[site.drain];
  const ranked = scoreCrops(site);
  // Keep DOM nodes and reorder, so bars animate rather than flicker
  ranked.forEach((r, i) => {
    let li = fitList.querySelector(`[data-crop="${r.id}"]`);
    if (!li) {
      li = document.createElement('li');
      li.className = 'fit__item'; li.dataset.crop = r.id;
      li.innerHTML = `<span class="fit__rank"></span><span class="fit__name">${r.name}<small>${r.kind}</small></span><span class="fit__score"></span><span class="fit__bar"><i></i></span><span class="fit__why"></span>`;
    }
    li.querySelector('.fit__rank').textContent = String(i + 1).padStart(2, '0');
    li.querySelector('.fit__score').textContent = r.score;
    li.querySelector('.fit__bar i').style.width = `${r.score}%`;
    li.querySelector('.fit__why').textContent = r.why;
    li.querySelector('.fit__why').hidden = i > 2;
    fitList.appendChild(li);
  });
}
Object.values(fitInputs).forEach((el) => el.addEventListener('input', renderFit));
renderFit();

/* Contact form: two short steps, with an optional map pin for the land */
const form = $('#contact-form');
const steps = $$('.form__step', form), progress = $$('.form__steps li', form);
const goStep = (n) => {
  steps.forEach((f) => { f.hidden = +f.dataset.step !== n; });
  progress.forEach((li, i) => {
    if (i === n - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    li.classList.toggle('is-done', i < n - 1);
  });
  $('input, select, textarea', steps[n - 1])?.focus({ preventScroll: true });
};
$('[data-next]', form).addEventListener('click', () => {
  const invalid = $$('input, select, textarea', steps[0]).some((el) => el.willValidate && !el.checkValidity());
  if (invalid) { form.requestSubmit(); return; } // runs validation and shows the errors
  $$('.field__err', steps[0]).forEach((n) => { n.textContent = ''; });
  $$('[aria-invalid]', steps[0]).forEach((el) => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
  $('.form__status', form).textContent = '';
  goStep(2);
});
$('[data-back]', form).addEventListener('click', () => goStep(1));

const lat = $('[name="lat"]', form), lng = $('[name="lng"]', form), pinVal = $('#pin-val');
let map = null, marker = null;
function setPin(la, ln, { pan = false } = {}) {
  lat.value = la.toFixed(5); lng.value = ln.toFixed(5);
  pinVal.textContent = `Pinned ${Math.abs(la).toFixed(4)}°${la < 0 ? 'S' : 'N'}, ${Math.abs(ln).toFixed(4)}°${ln < 0 ? 'W' : 'E'}`;
  if (map) {
    if (marker) marker.setLatLng([la, ln]);
    else marker = window.L.circleMarker([la, ln], { radius: 9, color: '#11160a', weight: 2, fillColor: '#c6f36b', fillOpacity: 1 }).addTo(map);
    if (pan) map.setView([la, ln], Math.max(map.getZoom(), 12));
  }
}
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  const load = (el) => new Promise((res, rej) => { el.onload = res; el.onerror = rej; document.head.append(el); });
  return Promise.all([
    load(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css' })),
    load(Object.assign(document.createElement('script'), { src: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js' })),
  ]);
}
$('[data-pin-map]', form).addEventListener('click', async (e) => {
  const btn = e.currentTarget, box = $('#pin-map');
  if (!box.hidden) { box.hidden = true; btn.textContent = 'Pin it on a map'; return; }
  box.hidden = false; btn.textContent = 'Hide map';
  try { await loadLeaflet(); } catch { box.textContent = 'The map could not load. Describe the location above instead.'; return; }
  if (!map) {
    const L = window.L;
    map = L.map(box, { scrollWheelZoom: false }).setView([-14.2, 28.3], 6); // Zambia's farming belt
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    map.on('click', (ev) => setPin(ev.latlng.lat, ev.latlng.lng));
    if (lat.value) setPin(+lat.value, +lng.value, { pan: true });
  }
  setTimeout(() => map.invalidateSize(), 50);
});
$('[data-pin-here]', form).addEventListener('click', () => {
  if (!navigator.geolocation) { pinVal.textContent = 'Location is not available in this browser.'; return; }
  pinVal.textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition(
    (pos) => setPin(pos.coords.latitude, pos.coords.longitude, { pan: true }),
    () => { pinVal.textContent = 'Could not get your location. Pin it on the map instead.'; },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

bindForm(form, {
  onSent: () => { goStep(1); lat.value = lng.value = ''; pinVal.textContent = ''; marker?.remove(); marker = null; },
  subject: (d) => `Site survey enquiry: ${d.get('location')}`,
  summary: (d) => [
    `Name: ${d.get('name')}`, `Phone: ${d.get('phone')}`, `Email: ${d.get('email') || '-'}`,
    `Organisation: ${d.get('org') || '-'}`, `Location: ${d.get('location')}`,
    `Map pin: ${d.get('lat') ? `${d.get('lat')}, ${d.get('lng')} (https://www.google.com/maps?q=${d.get('lat')},${d.get('lng')})` : '-'}`,
    `Hectares: ${d.get('hectares') || '-'}`, `Land: ${d.get('status')}`,
    `Interested in: ${d.getAll('interest').join(', ') || '-'}`, '', d.get('message') || '',
  ].join('\n'),
});

/* ------------------------------------------------------------------ */
/* 3D scenes                                                            */
/* Poster images show first. The live 3D loads after first paint, or    */
/* only on request in low-data mode (Data Saver, slow networks, or the  */
/* footer switch). The page works fully without WebGL.                  */
/* ------------------------------------------------------------------ */

const LITE_KEY = 'monesha-lite';
const store = {
  get() { try { return localStorage.getItem(LITE_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(LITE_KEY, v); } catch { /* private mode */ } },
};
function wantsLite() {
  const saved = store.get();
  if (saved) return saved === '1';
  const c = navigator.connection;
  return !!(c && (c.saveData || /2g/.test(c.effectiveType || '')));
}
function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

const html = document.documentElement;
const liteSwitch = $('#lite-switch');
let started = false;

function setLite(on) {
  html.classList.toggle('lite', on);
  if (liteSwitch) {
    liteSwitch.setAttribute('aria-checked', String(on));
    liteSwitch.querySelector('[data-state]').textContent = on ? 'On' : 'Off';
  }
}
liteSwitch?.addEventListener('click', () => {
  const on = !html.classList.contains('lite');
  store.set(on ? '1' : '0');
  setLite(on);
  if (!on) startScenes();
});
$$('[data-load3d]').forEach((b) => b.addEventListener('click', () => { setLite(false); startScenes(); }));

if (!webglOK()) {
  html.classList.add('no-webgl');
} else if (wantsLite()) {
  setLite(true);
} else {
  setLite(false);
  startScenes();
}

function startScenes() {
  if (started) return;
  started = true;
  import('./scenes.js').then(buildScenes).catch((err) => {
    console.error('3D scenes failed to load', err);
    html.classList.add('no-webgl');
  });
}

function buildScenes({ initHero, initSubsurface, initWatch, initEngineering, initStory, STAGES }) {
  /* Hero twin */
  const fmtHa = (v) => `${Math.round(v)} ha`;
  const hero = initHero($('#hero-canvas'), {
    onStats: (s) => {
      $('#s-ndvi').textContent = s.ndvi.toFixed(2);
      $('#s-cover').textContent = `${Math.round(s.cover * 100)}%`;
      $('#s-flood').textContent = fmtHa(s.floodHa);
      $('#s-fire').textContent = fmtHa(s.fireHa);
    },
  });
  const layerBtns = $$('.seg [data-layer]');
  const legend = $('#layer-legend');
  const selectLayer = (b) => {
    layerBtns.forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    hero.setLayer(b.dataset.layer);
    legend.dataset.layer = b.dataset.layer;
  };
  layerBtns.forEach((b) => b.addEventListener('click', () => selectLayer(b)));
  $('.seg').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = layerBtns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const n = layerBtns[(i + (e.key === 'ArrowRight' ? 1 : layerBtns.length - 1)) % layerBtns.length];
    n.click(); n.focus();
  });

  // Season: the slider, and "Play the season" which steps through it
  const stage = $('#stage'), play = $('#play'), label = $('#stage-label');
  const showStage = (s) => {
    stage.value = s;
    paintRange(stage);
    label.textContent = STAGES[s].label;
    stage.setAttribute('aria-valuetext', STAGES[s].label);
    hero.setStage(s);
  };
  let timer = 0;
  const stop = () => {
    clearInterval(timer); timer = 0;
    play.setAttribute('aria-pressed', 'false');
    play.querySelector('.hud__play-t').textContent = 'Play the season';
  };
  play.addEventListener('click', () => {
    if (timer) return stop();
    play.setAttribute('aria-pressed', 'true');
    play.querySelector('.hud__play-t').textContent = 'Pause';
    if (+stage.value >= STAGES.length - 1) showStage(0);
    timer = setInterval(() => {
      const next = +stage.value + 1;
      if (next >= STAGES.length) return stop();
      showStage(next);
    }, 2200);
  });
  stage.addEventListener('input', () => { stop(); showStage(+stage.value); });

  $$('[data-zoom]').forEach((b) => b.addEventListener('click', () => hero.zoom(b.dataset.zoom === 'in' ? 0.85 : 1.18)));
  bindInteract($('[data-interact]'), hero);

  /* Lazily build a view when it comes near the viewport */
  const whenNear = (el, fn, margin = '400px') => new IntersectionObserver(([e], o) => { if (e.isIntersecting) { o.disconnect(); fn(); } }, { rootMargin: margin }).observe(el);

  /* Method story: one twin, four chapters */
  whenNear($('#story-canvas'), () => {
    story = initStory($('#story-canvas'));
    story.go(chapter);
  });

  /* Subsurface block */
  whenNear($('#aquifer-canvas'), () => {
    const sub = initSubsurface($('#aquifer-canvas'), {
      onReadout: (r) => {
        $('#r-water').textContent = `${r.waterDepthM.toFixed(1)} m`;
        $('#r-frac').textContent = `${r.fractureDepthM.toFixed(1)} m`;
        $('#r-bdepth').textContent = `${Math.round(r.holeBDepthM)} m`;
        const b = $('#r-b');
        b.textContent = r.holeBWet ? 'Marginal' : 'Dry';
        b.className = r.holeBWet ? '' : 'bad';
      },
    });
    sub.setCutaway(true);
    $('#strata-legend').innerHTML = sub.strata.map((s) => `<li><i class="sw" style="background:${s.color}"></i>${s.name}</li>`).join('');
    let pending = 0;
    $('#season').addEventListener('input', (ev) => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => sub.setSeason(+ev.target.value));
    });
    $('[data-cut]').addEventListener('click', (ev) => {
      const on = ev.currentTarget.classList.toggle('is-on');
      ev.currentTarget.setAttribute('aria-pressed', String(on));
      sub.setCutaway(on);
    });
    $$('[data-show]').forEach((c) => c.addEventListener('click', () => {
      const on = c.classList.toggle('is-on');
      c.setAttribute('aria-pressed', String(on));
      sub.toggle(c.dataset.show, on);
    }));
    $$('[data-zoom2]').forEach((b) => b.addEventListener('click', () => sub.zoom(b.dataset.zoom2 === 'in' ? 0.85 : 1.18)));
    bindInteract($('[data-interact2]'), sub);
  }, '300px');

  /* Watch: same farm from orbit, pins linked to the alert feed */
  whenNear($('#watch-canvas'), () => {
    const sky = initWatch($('#watch-canvas'));
    $('#sky-pins').innerHTML = sky.alerts.map((a) => `<span class="pin${a.u > 0.72 ? ' pin--left' : ''}" data-k="${a.k}" style="left:${(a.u * 100).toFixed(2)}%;top:${(a.v * 100).toFixed(2)}%"><i></i><b><span>${a.label}</span></b></span>`).join('');
    $$('.pin').forEach((el) => {
      el.addEventListener('mouseenter', () => hot(el.dataset.k, true));
      el.addEventListener('mouseleave', () => hot(el.dataset.k, false));
    });
    $$('[data-sky]').forEach((c) => c.addEventListener('click', () => {
      $$('[data-sky]').forEach((x) => { x.classList.toggle('is-on', x === c); x.setAttribute('aria-pressed', String(x === c)); });
      sky.setLayer(c.dataset.sky);
    }));
  });

  /* Engineering: pivot on the real terrain */
  whenNear($('#eng-canvas'), () => {
    const eng = initEngineering($('#eng-canvas'), {
      onReadout: (r) => {
        $('#e-span').textContent = `${Math.round(r.radiusM)} m · ${r.areaHa.toFixed(1)} ha`;
        $('#e-range').textContent = `${r.rangeM.toFixed(1)} m`;
        $('#e-bar').textContent = `${r.pressureBar.toFixed(2)} bar`;
        $('#e-grade').textContent = `${r.maxGrade.toFixed(1)}%`;
      },
    });
    $$('[data-relief]').forEach((c) => c.addEventListener('click', () => {
      $$('[data-relief]').forEach((x) => { x.classList.toggle('is-on', x === c); x.setAttribute('aria-pressed', String(x === c)); });
      const on = c.dataset.relief === 'on';
      eng.setRelief(on);
      $('#relief-legend').hidden = !on;
    }));
    $$('[data-zoom3]').forEach((b) => b.addEventListener('click', () => eng.zoom(b.dataset.zoom3 === 'in' ? 0.85 : 1.18)));
    bindInteract($('[data-interact3]'), eng);
  });
}

/* Alert feed <-> map markers (feed works on its own; markers appear with the live map) */
function hot(k, on) {
  $$(`.pin[data-k="${k}"], .feed li[data-k="${k}"]`).forEach((el) => el.classList.toggle('is-hot', on));
}
const clearHot = () => $$('.is-hot').forEach((el) => el.classList.remove('is-hot'));
$$('.feed li').forEach((li) => {
  li.addEventListener('mouseenter', () => hot(li.dataset.k, true));
  li.addEventListener('mouseleave', () => hot(li.dataset.k, false));
  li.addEventListener('focus', () => { clearHot(); hot(li.dataset.k, true); });
  li.addEventListener('blur', () => hot(li.dataset.k, false));
  li.addEventListener('click', () => { const on = !li.classList.contains('is-hot'); clearHot(); hot(li.dataset.k, on); });
});

/* Method story: the step in the middle of the screen sets the chapter */
const storySteps = $$('.story__step');
const STORY_NAMES = ['01 · Survey', '02 · Model', '03 · Engineer', '04 · Watch'];
let story = null, chapter = 0;
function setChapter(i) {
  chapter = i;
  storySteps.forEach((li, n) => li.classList.toggle('is-on', n === i));
  $$('.story__still').forEach((img, n) => img.classList.toggle('is-active', n === i));
  $$('.story__dots li').forEach((d, n) => d.classList.toggle('is-on', n === i));
  $('#story-cap').textContent = STORY_NAMES[i];
  story?.go(i);
}
const storyIO = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) setChapter(+e.target.dataset.step);
}), { rootMargin: window.matchMedia('(max-width: 860px)').matches ? '-68% 0px -30% 0px' : '-48% 0px -48% 0px' }); // phones: the twin covers the top of the screen
storySteps.forEach((li) => storyIO.observe(li));

/* Phones: quick-contact bar after the hero, hidden while the contact form is on screen */
const bar = $('#actionbar');
if (bar) {
  let pastHero = false, atContact = false;
  const sync = () => bar.classList.toggle('is-on', pastHero && !atContact);
  new IntersectionObserver(([e]) => { pastHero = !e.isIntersecting; sync(); }).observe($('.hero'));
  new IntersectionObserver(([e]) => { atContact = e.isIntersecting; sync(); }, { threshold: 0.05 }).observe($('#contact'));
}

/* Hero: "Explore the twin" reveals the full controls */
const moreBtn = $('.hud__more-btn'), more = $('#hud-more');
moreBtn.addEventListener('click', () => {
  const open = moreBtn.getAttribute('aria-expanded') !== 'true';
  moreBtn.setAttribute('aria-expanded', String(open));
  more.hidden = !open;
  if (open) $$('input[type="range"]', more).forEach(paintRange);
});

function bindInteract(btn, viewer) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Done' : 'Rotate';
    viewer.setInteractive(on);
  });
}
