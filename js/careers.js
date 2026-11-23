import { $, $$, initPage, bindForm } from './common.js';

initPage('.section__head, .values li, .role, .step, .split__text, .form');

/* Role filter */
const roles = $$('.role');
const empty = $('.roles__empty');
$$('.role-filter [data-filter]').forEach((btn) => btn.addEventListener('click', () => {
  $$('.role-filter [data-filter]').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const f = btn.dataset.filter;
  let shown = 0;
  roles.forEach((r) => {
    const match = f === 'all' || r.dataset.tags.split(' ').includes(f);
    r.hidden = !match;
    if (match) shown++;
  });
  empty.hidden = shown > 0;
}));

/* "Apply for this role" pre-selects the role in the form */
const roleSelect = $('#apply-role');
$$('[data-apply]').forEach((a) => a.addEventListener('click', () => { roleSelect.value = a.dataset.apply; }));

/* Open a role directly from a link such as careers.html#role-data */
if (location.hash.startsWith('#role-')) {
  const el = document.querySelector(location.hash);
  if (el?.tagName === 'DETAILS') el.open = true;
}

bindForm($('#apply-form'), {
  subject: (d) => `Application: ${d.get('role')}`,
  summary: (d) => [
    `Role: ${d.get('role')}`, `Name: ${d.get('name')}`, `Email: ${d.get('email')}`,
    `Phone: ${d.get('phone') || '-'}`, `Based in: ${d.get('location') || '-'}`,
    `Link: ${d.get('link') || '-'}`, '', d.get('message') || '',
  ].join('\n'),
});
