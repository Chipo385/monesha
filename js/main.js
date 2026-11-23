import { SITE_DEFAULTS, scoreCrops } from './suitability.js';
import { $, $$, initPage, bindForm } from './common.js';

initPage('.section__head, .step, .split__text, .viewer, .fit, .svc__item, .pillars li, .road li, .facts li');

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
/** Once the renders are in, sweep the handle once so visitors see it can be dragged. */
function hintCompare() {
  ba.classList.remove('is-loading');
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

/* Contact form */
bindForm($('#contact-form'), {
  subject: 'Site survey enquiry',
  summary: (d) => [
    `Name: ${d.get('name')}`, `Organisation: ${d.get('org') || '-'}`, `Email: ${d.get('email')}`,
    `Phone: ${d.get('phone') || '-'}`, `Location: ${d.get('location')}`,
    `Hectares: ${d.get('hectares') || '-'}`, `Land: ${d.get('status')}`,
    `Interested in: ${d.getAll('interest').join(', ') || '-'}`, '', d.get('message') || '',
  ].join('\n'),
});

/* 3D scenes (loaded after first paint; page works without WebGL) */
function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

if (!webglOK()) {
  document.documentElement.classList.add('no-webgl');
} else {
  import('./scenes.js').then(({ initHero, initSubsurface, initWatch, initEngineering, renderOutcome, STAGES }) => {
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
      const btns = layerBtns;
      const i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.click(); n.focus();
    });
    const stage = $('#stage');
    stage.addEventListener('input', () => {
      const s = +stage.value;
      $('#stage-label').textContent = STAGES[s].label;
      stage.setAttribute('aria-valuetext', STAGES[s].label);
      hero.setStage(s);
    });
    $$('[data-zoom]').forEach((b) => b.addEventListener('click', () => hero.zoom(b.dataset.zoom === 'in' ? 0.85 : 1.18)));
    bindInteract($('[data-interact]'), hero);

    /* Subsurface block (built when it nears the viewport) */
    const aq = $('#aquifer-canvas');
    new IntersectionObserver(([e], o) => {
      if (!e.isIntersecting) return;
      o.disconnect();
      const sub = initSubsurface(aq, {
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
    }, { rootMargin: '300px' }).observe(aq);

    /* Lazily build a view when it comes near the viewport */
    const whenNear = (el, fn) => new IntersectionObserver(([e], o) => { if (e.isIntersecting) { o.disconnect(); fn(); } }, { rootMargin: '400px' }).observe(el);

    /* Watch: same farm from orbit, pins linked to the alert feed */
    whenNear($('#watch-canvas'), () => {
      const sky = initWatch($('#watch-canvas'));
      const pins = $('#sky-pins');
      pins.innerHTML = sky.alerts.map((a) => `<span class="pin${a.u > 0.72 ? ' pin--left' : ''}" data-k="${a.k}" style="left:${(a.u * 100).toFixed(2)}%;top:${(a.v * 100).toFixed(2)}%"><i></i><b><span>${a.label}</span></b></span>`).join('');
      const hot = (k, on) => {
        $$(`.pin[data-k="${k}"], .feed li[data-k="${k}"]`).forEach((el) => el.classList.toggle('is-hot', on));
      };
      const clear = () => $$('.is-hot').forEach((el) => el.classList.remove('is-hot'));
      $$('.pin, .feed li').forEach((el) => {
        el.addEventListener('mouseenter', () => hot(el.dataset.k, true));
        el.addEventListener('mouseleave', () => hot(el.dataset.k, false));
      });
      // Keyboard and touch: focusing or tapping an alert lights up its marker on the map
      $$('.feed li').forEach((li) => {
        li.addEventListener('focus', () => { clear(); hot(li.dataset.k, true); });
        li.addEventListener('blur', () => hot(li.dataset.k, false));
        li.addEventListener('click', () => { const on = !li.classList.contains('is-hot'); clear(); hot(li.dataset.k, on); });
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

    /* Outcome: today vs planned, rendered once from the twin */
    whenNear($('#ba'), () => {
      // Let the browser paint first; the two renders block the main thread briefly
      setTimeout(() => {
        renderOutcome($('#ba-before'), $('#ba-after'));
        $('#ba-after').decode().catch(() => {}).then(hintCompare);
      }, 60);
    });
  }).catch((err) => {
    console.error('3D scenes failed to load', err);
    document.documentElement.classList.add('no-webgl');
    ba.classList.remove('is-loading');
  });
}

function bindInteract(btn, viewer) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Done' : 'Rotate';
    viewer.setInteractive(on);
  });
}
