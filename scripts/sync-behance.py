#!/usr/bin/env python3
"""
Sincroniza os projetos do Behance para o site.

A API publica v2 do Behance esta fechada (403 para novas chaves), entao a fonte
e o JSON de estado que o Behance embute na propria pagina do perfil, dentro de
<script id="beconfig-store_state">. Isso e scraping: se o Behance mudar a
estrutura, este script falha alto em vez de gravar dados vazios.

Cards que nao vem do Behance (projetos proprios) tem 'image_url' em vez de
'match': a imagem e baixada e recortada para a proporcao do card. Esse recorte
precisa de Pillow; sem ele o script mantem a capa que ja esta no repo e avisa.

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

CARD_W, CARD_H = 808, 632


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


def fit_cover(raw, dest, anchor):
    """Recorta para a proporcao do card e grava webp. Anchor evita decapitar
    texto que esteja encostado numa das bordas."""
    try:
        from PIL import Image
    except ImportError:
        if dest.exists():
            print(f"  ! Pillow ausente: mantendo {dest.name} como esta.")
            return False
        sys.exit(
            f"ERRO: {dest.name} precisa ser recortada e o Pillow nao esta instalado.\n"
            "  pip install Pillow   (ou: sudo apt install python3-pil)"
        )
    import io

    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    target = CARD_W / CARD_H
    if w / h > target:                       # sobra largura: corta na horizontal
        cw = int(round(h * target))
        left = {"left": 0, "right": w - cw}.get(anchor, (w - cw) // 2)
        im = im.crop((left, 0, left + cw, h))
    else:                                    # sobra altura: corta na vertical
        ch = int(round(w / target))
        top = {"top": 0, "bottom": h - ch}.get(anchor, (h - ch) // 2)
        im = im.crop((0, top, w, top + ch))
    im.resize((CARD_W, CARD_H), Image.LANCZOS).save(dest, "WEBP", quality=86, method=6)
    return True


def render_cards(cards):
    rows = []
    for c in cards:
        rows.append(
            f"""        <a class="work-card" href="{c['link']}" target="_blank" rel="noopener noreferrer">
          <div class="work-shot">
            <img src="{c['image']}" alt="Cover of the {c['name']} project" width="808" height="632" loading="lazy" decoding="async">
          </div>
          <div class="work-meta">
            <span class="work-kicker">{c['kicker']}</span>
            <h3 class="work-title">{c['name']}</h3>
            <p class="work-blurb">{c['blurb']}</p>
          </div>
          <span class="work-go" aria-hidden="true">{c['cta']}</span>
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
        from_behance = "match" in f

        if from_behance:
            p = by_name.get(f["match"])
            if not p:
                sys.exit(
                    f"ERRO: projeto em destaque '{f['match']}' nao esta mais no perfil.\n"
                    f"Disponiveis: {', '.join(sorted(by_name))}"
                )
            name = f.get("title") or p["name"]
            link = f.get("link") or p["url"]
            cta = f.get("cta") or "View on Behance"
            src, size = pick_cover(p["covers"])
            if not src:
                sys.exit(f"ERRO: projeto '{p['name']}' sem capa disponivel no Behance.")
        else:
            if not f.get("title") or not f.get("link") or not f.get("image_url"):
                sys.exit(
                    "ERRO: entrada sem 'match' precisa de 'title', 'link' e 'image_url'. "
                    f"Problema em: {f}"
                )
            name, link = f["title"], f["link"]
            cta = f.get("cta") or "Visit site"
            src, size = f["image_url"], "origem"

        fname = slugify(name) + ".webp"
        dest = WORK / fname

        if check:
            print(f"  [check] {name}: capa {size} -> assets/work/{fname}")
        else:
            raw = get(src, binary=True)
            if from_behance:
                # o Behance ja entrega na proporcao do card
                dest.write_bytes(raw)
                print(f"  {name}: capa {size}, {len(raw)//1024} KB -> assets/work/{fname}")
            elif fit_cover(raw, dest, f.get("image_anchor", "center")):
                print(
                    f"  {name}: recortada de {len(raw)//1024} KB "
                    f"(anchor={f.get('image_anchor','center')}) -> "
                    f"assets/work/{fname} ({dest.stat().st_size//1024} KB)"
                )

        cards.append(
            {
                "name": name,
                "link": link,
                "cta": cta,
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
