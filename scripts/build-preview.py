#!/usr/bin/env python3
"""Gera um HTML unico e auto-contido (CSS/JS inline, imagens em data URI).

Serve so para preview em ambientes que nao carregam recursos externos.
O site de verdade e o index.html com os arquivos separados.
"""
import base64, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "preview.html"
h = (ROOT / "index.html").read_text(encoding="utf-8")

h = h.replace(
    '<link rel="stylesheet" href="assets/css/site.css">',
    "<style>\n" + (ROOT / "assets/css/site.css").read_text(encoding="utf-8") + "\n</style>",
)
h = h.replace(
    '<script src="assets/js/field.js" defer></script>',
    "<script>\n" + (ROOT / "assets/js/field.js").read_text(encoding="utf-8") + "\n</script>",
)

def datauri(m):
    p = ROOT / m.group(1)
    b64 = base64.b64encode(p.read_bytes()).decode()
    return 'src="data:image/webp;base64,%s"' % b64

h = re.sub(r'src="(assets/work/[^"]+)"', datauri, h)

# o wrapper do preview injeta seu proprio esqueleto de documento
h = re.sub(r"<!doctype html>\s*|</?html[^>]*>|</?head>|</?body>", "", h, flags=re.I)
h = re.sub(r"\n{3,}", "\n\n", h).strip()

out.write_text(h, encoding="utf-8")
print(f"{out} — {len(h)//1024} KB")
