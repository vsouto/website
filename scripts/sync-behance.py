#!/usr/bin/env python3
"""
Sincroniza os projetos do Behance para o site.

A API publica v2 do Behance esta fechada (403 para novas chaves), entao a fonte
e o JSON de estado que o Behance embute na propria pagina do perfil, dentro de
<script id="beconfig-store_state">. Isso e scraping: se o Behance mudar a
estrutura, este script falha alto em vez de gravar dados vazios.

Roda em build time. O site servido e 100% estatico -- o navegador do visitante
nunca fala com o Behance (bateria em CORS de qualquer forma).

Uso:
    python3 scripts/sync-behance.py            # sincroniza tudo
    python3 scripts/sync-behance.py --check    # so relata diferencas, nao escreve
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

USERNAME = "victor-souto"
PROFILE_URL = f"https://www.behance.net/{USERNAME}"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0 Safari/537.36"
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WORK = ROOT / "assets" / "work"
INDEX = ROOT / "index.html"

COVER_PREF = ["max_808_webp", "808_webp", "original_webp", "max_808", "808"]


def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read()
    return raw if binary else raw.decode("utf-8", "replace")


def fetch_projects():
    html = get(PROFILE_URL)
    m = re.search(
        r'<script[^>]*id="beconfig-store_state"[^>]*>(.*?)</script>', html, re.S
    )
    if not m:
        sys.exit(
            "ERRO: nao achei o bloco beconfig-store_state na pagina do perfil.\n"
            "O Behance provavelmente mudou a estrutura da pagina. "
            "Abra o HTML e ajuste o seletor antes de confiar no resultado."
        )
    state = json.loads(m.group(1).strip())
    try:
        raw = state["profile"]["activeSection"]["work"]["profileProjects"]
    except KeyError:
        sys.exit("ERRO: o caminho profile.activeSection.work.profileProjects sumiu do JSON.")
    if not raw:
        sys.exit("ERRO: a lista de projetos veio vazia. Abortando para nao apagar os dados atuais.")

    out = []
    for p in raw:
        covers = {}
        for c in (p.get("covers") or {}).get("allAvailable") or []:
            # a chave do tamanho e o penultimo segmento do path: /projects/<size>/<file>
            seg = c["url"].split("/projects/")[-1].split("/")[0]
            covers[seg] = c["url"]
        out.append(
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "url": p.get("url"),
                "slug": p.get("slug"),
                "published": p.get("publishedOn"),
                "views": (p.get("stats") or {}).get("views", {}).get("all"),
                "appreciations": (p.get("stats") or {}).get("appreciations", {}).get("all"),
                "covers": covers,
            }
        )
    return out


def pick_cover(covers):
    for k in COVER_PREF:
        if k in covers:
            return covers[k], k
    return (next(iter(covers.values())), "?") if covers else (None, None)


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def render_cards(cards):
    rows = []
    for c in cards:
        rows.append(
            f"""        <a class="work-card" href="{c['url']}" target="_blank" rel="noopener noreferrer">
          <div class="work-shot">
            <img src="{c['image']}" alt="Cover of the {c['name']} project" width="808" height="632" loading="lazy" decoding="async">
          </div>
          <div class="work-meta">
            <span class="work-kicker">{c['kicker']}</span>
            <h3 class="work-title">{c['name']}</h3>
            <p class="work-blurb">{c['blurb']}</p>
          </div>
          <span class="work-go" aria-hidden="true">View on Behance</span>
        </a>"""
        )
    return "\n".join(rows)


def main():
    check = "--check" in sys.argv

    projects = fetch_projects()
    print(f"Behance: {len(projects)} projetos encontrados.")

    featured_cfg = json.loads((DATA / "featured.json").read_text(encoding="utf-8"))
    by_name = {p["name"]: p for p in projects}

    cards = []
    for f in featured_cfg["featured"]:
        p = by_name.get(f["match"])
        if not p:
            sys.exit(
                f"ERRO: projeto em destaque '{f['match']}' nao esta mais no perfil.\n"
                f"Disponiveis: {', '.join(sorted(by_name))}"
            )
        url, size = pick_cover(p["covers"])
        if not url:
            sys.exit(f"ERRO: projeto '{p['name']}' sem capa disponivel.")
        fname = f"{slugify(p['name'])}.webp"
        dest = WORK / fname
        if check:
            print(f"  [check] {p['name']}: capa {size} -> assets/work/{fname}")
        else:
            data = get(url, binary=True)
            dest.write_bytes(data)
            print(f"  {p['name']}: capa {size}, {len(data)//1024} KB -> assets/work/{fname}")
        cards.append(
            {
                "name": p["name"],
                "url": p["url"],
                "image": f"assets/work/{fname}",
                "kicker": f["kicker"],
                "blurb": f["blurb"],
            }
        )

    if check:
        print("--check: nada foi escrito.")
        return

    (DATA / "projects.json").write_text(
        json.dumps(projects, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"data/projects.json atualizado ({len(projects)} projetos).")

    html = INDEX.read_text(encoding="utf-8")
    block = render_cards(cards)
    new, n = re.subn(
        r"<!-- work:start -->.*?<!-- work:end -->",
        lambda m: "<!-- work:start -->\n" + block + "\n      <!-- work:end -->",
        html,
        flags=re.S,
    )
    if n != 1:
        sys.exit("ERRO: nao achei os marcadores <!-- work:start --> / <!-- work:end --> no index.html.")
    INDEX.write_text(new, encoding="utf-8")
    print("index.html: bloco de projetos regenerado.")


if __name__ == "__main__":
    main()
