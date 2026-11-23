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
| `formEndpoint` | A JSON form backend (e.g. Formspree). Forms then send in the page            |

With nothing set, forms copy a summary to the clipboard so no enquiry is lost while testing.
Both forms validate fields inline and carry a hidden spam trap (`_gotcha`).

## Structure

```
index.html            home page markup and copy
careers.html          careers page: values, roles, hiring process, application form
404.html              not-found page (paths assume the site lives at /monesha/)
css/styles.css        design tokens + all styles
js/config.js          contact email, WhatsApp number, form endpoint
js/common.js          shared: nav (active section, mobile menu), reveal, contact links, forms
js/main.js            home page: twin controls, sliders, crop fit, alerts, before/after
js/careers.js         careers page: role filter, apply buttons
js/scenes.js          Three.js: shared farm model + hero twin, groundwater block,
                      satellite (Watch) view, pivot engineering view, outcome renders
js/detail.js          trees, farmyard equipment, lighting, and the low-power quality tier
js/terrain.js         procedural landscape: noise, river carving, erosion, drainage, parcels
js/suitability.js     illustrative crop scoring model
assets/logo.svg       favicon (depth aperture on a dark tile)
assets/icons/         PNG app icons (generated)
assets/og.jpg         social preview card, 1200×630 (generated)
assets/logo/          logo files and concepts (open index.html to compare)
site.webmanifest, robots.txt, sitemap.xml
tools/                og.html + icon.html and build-assets.sh, which renders them to PNG/JPG
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

## Regenerating the preview image and icons

After changing the logo or the hero scene, with the local server running:

```bash
./tools/build-assets.sh
```

## Deploying (GitHub Pages)

The URLs in the `<head>` of both pages, `robots.txt`, `sitemap.xml` and `404.html` assume
`https://chipo385.github.io/monesha/`. If the site moves to its own domain, search and
replace that address, set `<base href="/">` in `404.html`, and add a `CNAME` file.

## To do before going live

- Fill in `js/config.js` (at minimum `email`).
- **Imagery**: every farm visual is rendered live from one simulated farm, so the site is
  consistent and has no stock photos. Once real projects exist, add real survey outputs
  (with client permission) alongside the simulations.
- **Problem-strip figures** come from the business plan's market research. Keep the
  sources on file.
- Analytics, if wanted (a privacy-friendly one such as Plausible needs no cookie banner).
