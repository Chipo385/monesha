// Site assistant: answers common questions from the fixed text below.
// It runs entirely in the browser: no AI service, no cost, nothing sent or stored.
import { CONFIG } from './config.js';

const KB = [
  { k: 'service services offer do help what', a: 'We offer 3D land mapping, crop monitoring, groundwater survey, farm design and engineering, and Watch monitoring. Precision spraying is coming soon.', l: [['See services', 'index.html#services']] },
  { k: 'decide decision invest investment buy buying purchase why hire benefit lender bank loan', a: 'We help you decide before you spend. You see what the land can grow, where the water is and what a farm would need, with the evidence behind it, so you can go ahead, change the plan or walk away.', l: [['About us', 'index.html#about']] },
  { k: 'map mapping 3d terrain topography survey contour drone flight photo picture', a: 'A drone flies planned lines over the land and takes overlapping pictures. From those we build a 3D model with contours, slopes, drainage, boundaries and areas.', l: [['How it works', 'index.html#method']] },
  { k: 'crop monitoring health pest disease vigour ndvi stress yield fertiliser', a: 'Crop monitoring shows how each part of a field is growing: vigour maps, early signs of water stress, pests and disease, stand counts and gaps, and maps of where to put fertiliser. Findings are checked on the ground.', l: [['Crop monitoring', 'index.html#svc-crop'], ['Dashboard demo', 'platform.html']] },
  { k: 'water borehole groundwater drill dry aquifer yield', a: 'We study the terrain and the rock below to find where groundwater moves, then mark where to drill and how deep. No survey can guarantee water, but it reduces the guesswork.', l: [['Groundwater demo', 'explore.html#water']] },
  { k: 'irrigation pivot drip pump pipe sprinkler design engineer layout', a: 'Farm design covers the whole irrigation set-up: source, pump, storage, filtration, mainline, and pivot, drip or sprinkler, sized for your terrain and water.', l: [['Irrigation design', 'explore.html#engineering']] },
  { k: 'soil ph texture rainfall suitable suitability grow plant which fit maize soy soybean orange citrus avocado macadamia timber', a: 'Crop fit compares crops using soil type, texture, pH, drainage, rainfall and available water. You can try the illustrative tool; a real project uses your own measurements.', l: [['Try crop fit', 'explore.html#suitability']] },
  { k: 'spray spraying chemical', a: 'Precision spraying treats only the patches that need it. It is coming soon; tell us if you are interested.', l: [['Contact us', 'index.html#contact']] },
  { k: 'price cost charge quote much pay fee', a: 'It depends on the size of the land and the service, so we quote each job after a first conversation.', l: [['Ask for a quote', 'index.html#contact']] },
  { k: 'where area district zambia lusaka province near based', a: 'We are based in Lusaka and work in Zambia. Send us the location of your land and we will tell you how we can help.', l: [['Send a location', 'index.html#contact']] },
  { k: 'location pin gps coordinates maps link send', a: 'Easiest ways to send a location: press “Use my location” while on the land, paste a Google Maps link or coordinates, or search and tap the map.', l: [['Open the form', 'index.html#contact']] },
  { k: 'job jobs career careers intern hiring vacancy', a: 'Roles and the application form are on the careers page.', l: [['Careers', 'careers.html']] },
  { k: 'monesha mean meaning name', a: 'Monesha means “look deeply” in Bemba.', l: [['About us', 'index.html#about']] },
  { k: 'contact phone whatsapp email call talk human person book', a: 'Use the enquiry form and the team will get back to you.', l: [['Contact form', 'index.html#contact']], contact: true },
];
const HINTS = ['What do you offer?', 'How do you find water?', 'What can my land grow?', 'How do I send my location?'];
const GENERIC = new Set(['what', 'do', 'help', 'where', 'send', 'service', 'offer']);
const words = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
const stem = (w) => w.replace(/(ing|es|s)$/, '');

export function answer(q) {
  const ws = words(q).map(stem);
  let best = null, score = 0;
  for (const e of KB) {
    const ks = e.k.split(' ').map(stem);
    const n = ws.reduce((t, w) => t + (ks.includes(w) ? (GENERIC.has(w) ? 0.4 : 1) : 0), 0);
    if (n > score) { score = n; best = e; }
  }
  return best || { a: 'I don’t have an answer to that. Please ask the team through the enquiry form.', l: [['Contact form', 'index.html#contact']], contact: true };
}

export function initAssistant() {
  const root = document.createElement('aside');
  root.className = 'assist';
  root.setAttribute('aria-label', 'Site assistant');
  root.innerHTML = `
    <button class="assist__open" type="button" aria-expanded="false" aria-controls="assist-panel" aria-label="Ask a question"><span class="assist__t">Ask a question</span><span class="assist__q" aria-hidden="true">?</span></button>
    <div class="assist__panel" id="assist-panel" hidden>
      <div class="assist__head"><div><b>Site assistant</b><span>Automatic answers, not a person</span></div><button type="button" class="assist__x" aria-label="Close assistant">×</button></div>
      <div class="assist__log" role="log" aria-live="polite" tabindex="0" aria-label="Conversation"></div>
      <div class="assist__hints"></div>
      <form><input aria-label="Your question" placeholder="Ask about our services" autocomplete="off" maxlength="200"><button class="btn btn--primary btn--sm">Ask</button></form>
    </div>`;
  document.body.append(root);
  const q = (s) => root.querySelector(s);
  const open = q('.assist__open'), panel = q('.assist__panel'), log = q('.assist__log'), input = q('input');
  const say = (text, who, links = []) => {
    const d = document.createElement('div');
    d.className = `assist__msg assist__msg--${who}`;
    d.textContent = text;
    links.forEach(([t, h]) => d.append(Object.assign(document.createElement('a'), { textContent: t, href: h })));
    log.append(d); log.scrollTop = log.scrollHeight;
  };
  const ask = (text) => {
    say(text, 'me');
    const r = answer(text), links = [...r.l];
    if (r.contact && CONFIG.whatsapp) links.push(['WhatsApp', `https://wa.me/${CONFIG.whatsapp.replace(/\D/g, '')}`]);
    say(r.a, 'bot', links);
  };
  const set = (on) => { panel.hidden = !on; open.setAttribute('aria-expanded', String(on)); if (on) input.focus(); else open.focus(); };
  open.addEventListener('click', () => set(panel.hidden));
  q('.assist__x').addEventListener('click', () => set(false));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  log.addEventListener('click', (e) => { if (e.target.closest('a')) { panel.hidden = true; open.setAttribute('aria-expanded', 'false'); } });
  HINTS.forEach((h) => { const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip', textContent: h }); b.addEventListener('click', () => ask(h)); q('.assist__hints').append(b); });
  q('form').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { ask(v); input.value = ''; } });
  say('Hello. What would you like to know about your land or our services?', 'bot');
}
