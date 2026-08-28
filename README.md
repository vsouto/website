# vsouto.com

Personal site for Victor Vieira Souto. Static: no build step, no framework,
no runtime dependencies. Open `index.html` and it works.

```
index.html              the whole page
assets/css/site.css     tokens + layout
assets/js/field.js      the hero canvas, and the scroll reveals
assets/work/*.webp      project covers, synced from Behance
data/projects.json      full Behance project list (generated)
data/featured.json      which projects appear on the home page (hand-edited)
scripts/sync-behance.py refreshes the two above
```

## Running it locally

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Open the file directly with `file://` and it renders too, though the canvas
and fonts behave better over HTTP.

## Refreshing the Behance projects

Behance's public API v2 is closed — requests to `/v2/users/...` return 403 and
Adobe stopped issuing keys. So the data comes from the JSON that Behance embeds
in the profile page, in `<script id="beconfig-store_state">`.

That is scraping, with the usual consequence: **it will break when Behance
changes their page**. The script is written to fail loudly and leave the
existing data alone rather than write an empty file.

It runs at build time, never in the visitor's browser — a browser request to
Behance would be blocked by CORS regardless.

```bash
python3 scripts/sync-behance.py            # fetch, download covers, rewrite the cards
python3 scripts/sync-behance.py --check    # report what would change, write nothing
```

The script rewrites everything between `<!-- work:start -->` and
`<!-- work:end -->` in `index.html`. Don't hand-edit inside those markers.

## Changing which projects are featured

`data/featured.json` drives the cards. Two kinds of entry:

**From Behance** — `match` has to equal the project name on Behance exactly.
The cover comes from Behance already at the card's proportion.

```json
{ "match": "Philips Tasy", "kicker": "Healthcare", "blurb": "..." }
```

**Your own project** — no Behance entry, so give it an image and a link.
The image is downloaded and cropped to 808x632.

```json
{
  "title": "Kondomino",
  "link": "https://kondomino.com.br/",
  "cta": "kondomino.com.br",
  "image_url": "https://kondomino.com.br/img/hero-identity.webp",
  "image_anchor": "left",
  "kicker": "Proptech",
  "blurb": "..."
}
```

`image_anchor` is `center` (default), `left`, `right`, `top` or `bottom`. Use it
when the source image has text against one edge — Kondomino's headline sits on
the left, and a centred crop cuts it in half.

`title`, `link` and `cta` also work on a Behance entry, to override what the
gallery says. That is how Editora.ai points at its own site instead of Behance
while still using the Behance cover.

Cropping needs Pillow (`sudo apt install python3-pil`). Without it, entries that
have `image_url` keep whatever cover is already in `assets/work/`, and the
script says so rather than failing.

If a `match` no longer exists on the profile the script aborts and lists the
names it did find.

## Deploying

Cloudflare Workers with static assets. There is no server code — without a
`main` entry the Worker just serves what is in `assets`. `.assetsignore` keeps
the source, the build data and this file off the CDN.

```bash
npx wrangler login      # once
npx wrangler deploy
```

That publishes to `vsouto-website.<subdomain>.workers.dev`. The custom domain
`vsouto.com` is attached in the dashboard, under
**Workers & Pages → vsouto-website → Settings → Domains & Routes**. The domain
is registered with Cloudflare Registrar and already uses Cloudflare
nameservers, so the DNS record is created automatically — nothing to configure
at a registrar.

For deploys on every push instead of by hand, connect the repo under
**Settings → Build** (Workers Builds). Leave the build command empty; there is
no build step.

## Notes

- Light and dark themes both defined; follows the OS setting.
- `prefers-reduced-motion` is honoured — the canvas paints one static frame
  and all transitions collapse.
- The canvas stops rendering when the tab is hidden or the hero scrolls away.
