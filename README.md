# Monesha Precision Tech — website

Landing site for Monesha Precision Tech: agricultural spatial intelligence for Zambian
cultivation, orchards and agroforestry. Survey → Model → Engineer → Watch.

Plain HTML, CSS and JavaScript modules. No build step.

## Run locally

```bash
cd /Volumes/KINGSTON/Projects/Monesha
python3 -m http.server 5173
```

Open http://localhost:5173. (It must be served over HTTP; opening `index.html` directly
from the disk blocks the JavaScript modules.)

## Settings

All contact details live in **`js/config.js`**:

| Setting        | What it does                                                                 |
| -------------- | ---------------------------------------------------------------------------- |
| `email`        | Shown on the contact sections and footer; forms open the visitor's mail app  |
| `whatsapp`     | Digits in international format; adds a "Message us on WhatsApp" link         |
| `social`       | Facebook, X, Instagram and LinkedIn page links; icons show when set           |
| `formEndpoint` | A JSON form backend (e.g. Formspree). Forms then send in the page            |

With nothing set, forms copy a summary to the clipboard so no enquiry is lost while testing.
Both forms validate fields inline and carry a hidden spam trap (`_gotcha`).

## Structure

```
index.html            home page markup and copy
explore.html          working demos: twin controls, groundwater, crop fit, irrigation, watch, outcome
careers.html          careers page: values, roles, hiring process, application form
platform.html         Watch platform demo: KPIs, farm map, alerts, vigour chart, fields, visits
404.html              not-found page (paths assume the site lives at /monesha/)
css/styles.css        design tokens (dark + light "survey sheet" theme) and site styles
css/platform.css      platform demo styles
js/config.js          contact email, WhatsApp number, form endpoint
js/common.js          shared: nav (active section, mobile menu), reveal, contact links, forms
js/main.js            home page: twin controls, sliders, crop fit, alerts, before/after
js/careers.js         careers page: role filter, apply buttons
js/platform.js        platform demo: simulated season data, chart, tables, map
js/scenes.js          Three.js: shared farm model + hero twin, method story (one twin,
                      four camera stops), groundwater block,
                      satellite (Watch) view, pivot engineering view, outcome renders
js/drone.js           generic drone, survey flight with photo frames, irrigation layout
js/assistant.js       site assistant: fixed answers in the browser, no AI service or cost
js/detail.js          trees, farmyard equipment, lighting, and the low-power quality tier
js/terrain.js         procedural landscape: noise, river carving, erosion, drainage, parcels
js/suitability.js     illustrative crop scoring model
assets/logo.svg       favicon (depth aperture on a dark tile)
assets/icons/         PNG app icons (generated)
assets/og.jpg         social preview card, 1200×630 (generated)
assets/renders/       WebP stills of each 3D view, story chapter and before/after (generated)
assets/logo/          logo files and concepts (open index.html to compare)
site.webmanifest, robots.txt, sitemap.xml
tools/                og.html, icon.html, render.html and build-assets.sh, which renders them
docs/BRIEF.md         brand, content and confidentiality rules
docs/BUSINESS.md      business plan (internal: on this drive only, ignored by git)
reference/            old Stitch export and AI renders (local only, not in git)
```

Three.js 0.160.0 is loaded from jsDelivr through the import map in `index.html`.
Fonts come from Google Fonts.

## Performance

The 3D views build only when they come near the screen and stop rendering when scrolled
away. Phones, small screens and machines with ≤4 cores or ≤4 GB memory get a lighter tier
(`LOW` in `js/detail.js`): pixel ratio capped at 1.5, low-poly tree crowns, half the
scattered woodland with wider crowns, and smaller outcome renders — about a quarter of
the desktop triangle count. Every view also lowers its resolution on its own if frames
stay slow.

## Low-data mode

Poster stills (`assets/renders/`) show instantly in every 3D view. The live 3D (about 1 MB)
loads after first paint, unless the visitor has Data Saver on, is on a 2G connection,
or has switched on "Low-data mode" in the footer. Then the stills stay and each view has a
"Load 3D" button. The before/after comparison always uses the stills.

## Design system notes

- **Data colours** read by lightness, not hue, so they work with colour-blindness:
  crop vigour runs light straw → deep green, moisture sand → deep blue. Chart series use
  three validated hues (blue, orange, aqua), always with a legend and direct labels.
- **Status** (on track / watch / act now) always pairs an icon and a word with the colour.
- **Type**: Inter Tight for text and labels; JetBrains Mono only for data and figures;
  Instrument Serif italic for one emphasised phrase per heading.
- **Earth palette** (`--laterite`, `--miombo`, `--river`, `--grass`) for illustration and
  print, never for encoding data. **Light theme**: add `data-theme="sheet"` (used for the
  report sample and the platform's Light switch).

## Regenerating the preview image, icons and posters

After changing the logo or any 3D scene, with the local server running:

```bash
./tools/build-assets.sh
```

## Deploying (GitHub Pages)

The URLs in the `<head>` of both pages, `robots.txt`, `sitemap.xml` and `404.html` assume
`https://chipo385.github.io/monesha/`. If the site moves to its own domain, search and
replace that address, set `<base href="/">` in `404.html`, and add a `CNAME` file.

## To do before going live

- Fill in `js/config.js` (at minimum `email`, ideally `whatsapp` too).
- Team photos and credentials for the About section (real people build trust when there are no testimonials yet).
- Real photographs for the service cards: replace the matching file in `assets/renders/` and remove that card's "Simulated" caption.
- **Imagery**: every farm visual is rendered live from one simulated farm, so the site is
  consistent and has no stock photos. Once real projects exist, add real survey outputs
  (with client permission) alongside the simulations.
- **Problem-strip figures** come from the business plan's market research. Keep the
  sources on file.
- Analytics, if wanted (a privacy-friendly one such as Plausible needs no cookie banner).
