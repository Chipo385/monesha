// Shared behaviour for every page: nav, footer year, scroll reveal, contact links, forms.
import { CONFIG } from './config.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function initPage(revealSelector) {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  initNav();
  initContactLinks();

  if (revealSelector && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$(revealSelector).forEach((el) => { el.classList.add('reveal'); io.observe(el); });
  }
}

function initNav() {
  const nav = $('.nav'), toggle = $('.nav__toggle'), menu = $('#mobile-menu');

  // Shadow once the page has scrolled
  const onScroll = () => nav?.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile menu: toggle, close on link, Escape or a click outside
  if (toggle && menu) {
    const set = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.hidden = !open;
    };
    toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) { set(false); toggle.focus(); }
    });
    document.addEventListener('click', (e) => { if (!menu.hidden && !nav.contains(e.target)) set(false); });
    window.matchMedia('(min-width: 961px)').addEventListener('change', (e) => { if (e.matches) set(false); });
  }

  // Highlight the section in view
  const links = $$('.nav__links a[href^="#"], .nav__mobile a[href^="#"]');
  const sections = [...new Set(links.map((a) => a.getAttribute('href')))]
    .map((h) => document.getElementById(h.slice(1))).filter(Boolean);
  if (!sections.length || !('IntersectionObserver' in window)) return;
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
    let best = null, ratio = 0;
    visible.forEach((r, id) => { if (r > ratio) { ratio = r; best = id; } });
    links.forEach((a) => {
      if (best && a.getAttribute('href') === `#${best}`) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }, { rootMargin: '-35% 0px -55% 0px', threshold: [0, 0.01, 0.5, 1] });
  sections.forEach((s) => io.observe(s));
}

/** Fill any [data-contact] slots from CONFIG; hide the ones that are not configured. */
function initContactLinks() {
  $$('[data-contact]').forEach((el) => {
    const kind = el.dataset.contact;
    if (kind === 'email' && CONFIG.email) {
      el.href = `mailto:${CONFIG.email}`;
      el.querySelector('[data-value]')?.replaceChildren(CONFIG.email);
      el.hidden = false;
    } else if (kind === 'whatsapp' && CONFIG.whatsapp) {
      el.href = `https://wa.me/${CONFIG.whatsapp.replace(/\D/g, '')}`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  });
  $$('[data-contact-group]').forEach((g) => { g.hidden = !$$('[data-contact]', g).some((a) => !a.hidden); });
}

/**
 * Validate and send a form.
 * With CONFIG.formEndpoint: POST as JSON in the page.
 * With CONFIG.email: open the visitor's mail app with the summary.
 * With neither: copy the summary to the clipboard and show it.
 */
export function bindForm(form, { subject, summary }) {
  if (!form) return;
  const status = $('.form__status', form);
  const button = $('button[type="submit"]', form);

  const fieldError = (el) => {
    if (el.validity.valueMissing) return 'Required';
    if (el.validity.typeMismatch && el.type === 'email') return 'Enter a valid email address';
    if (el.validity.typeMismatch && el.type === 'url') return 'Enter a full link, starting https://';
    return '';
  };
  const showError = (el) => {
    const msg = fieldError(el);
    let note = el.parentElement.querySelector('.field__err');
    if (msg && !note) {
      note = document.createElement('span');
      note.className = 'field__err';
      note.id = `${form.id}-${el.name}-err`;
      el.insertAdjacentElement('afterend', note);
    }
    if (note) note.textContent = msg;
    el.setAttribute('aria-invalid', String(!!msg));
    if (msg) el.setAttribute('aria-describedby', note.id); else el.removeAttribute('aria-describedby');
    return !msg;
  };
  // Re-check a field as soon as the visitor fixes it
  form.addEventListener('input', (e) => { if (e.target.getAttribute('aria-invalid') === 'true') showError(e.target); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = $$('input, select, textarea', form).filter((el) => el.willValidate && el.name !== '_gotcha');
    const bad = fields.filter((el) => !showError(el));
    if (bad.length) {
      status.dataset.tone = 'error';
      status.textContent = bad.length === 1 ? 'One field needs attention.' : `${bad.length} fields need attention.`;
      bad[0].focus();
      return;
    }
    const d = new FormData(form);
    if (d.get('_gotcha')) return; // spam trap was filled in
    d.delete('_gotcha');
    const body = summary(d);
    const subj = typeof subject === 'function' ? subject(d) : subject;
    status.dataset.tone = '';

    if (CONFIG.formEndpoint) {
      button.disabled = true;
      button.dataset.label ??= button.textContent;
      button.textContent = 'Sending…';
      try {
        const data = Object.fromEntries([...new Set(d.keys())].map((k) => [k, d.getAll(k).join(', ')]));
        const res = await fetch(CONFIG.formEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ...data, _subject: subj }),
        });
        if (!res.ok) throw new Error(String(res.status));
        form.reset();
        status.dataset.tone = 'ok';
        status.textContent = 'Thank you. We have your message and will reply within two working days.';
      } catch {
        status.dataset.tone = 'error';
        status.textContent = CONFIG.email
          ? `That did not send. Please email us at ${CONFIG.email}.`
          : 'That did not send. Please try again in a moment.';
      } finally {
        button.disabled = false;
        button.textContent = button.dataset.label;
      }
    } else if (CONFIG.email) {
      location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
      status.dataset.tone = 'ok';
      status.textContent = 'Your email app should open with this ready to send.';
    } else {
      navigator.clipboard?.writeText(body).catch(() => {});
      status.dataset.tone = 'ok';
      status.textContent = 'Thank you. Your summary has been copied:\n\n' + body;
    }
  });
}
