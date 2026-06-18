#!/usr/bin/env python3
"""Generate Coastal.AI app-icon candidates as SVG via a free-tier Gemini text
model (the raster image model requires billing). Writes <concept>.svg files +
a gallery.html to packages/desktop/brand-candidates/ for selection. These are
first-pass DIRECTIONS to pick from, then the chosen one gets refined/rasterized.

    python3 packages/desktop/scripts/gen-logo-svg.py
"""
import os
import re
import sys
from pathlib import Path

try:
    from google import genai
except ImportError:
    sys.exit("google-genai not installed: pip install google-genai")


def load_key():
    k = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if k:
        return k
    f = Path(__file__).resolve().parents[1] / ".env.local"
    if f.exists():
        for line in f.read_text().splitlines():
            if line.strip().startswith(("GEMINI_API_KEY=", "GOOGLE_API_KEY=")):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


KEY = load_key()
if not KEY:
    sys.exit("No GEMINI_API_KEY (env or packages/desktop/.env.local).")

MODEL = os.environ.get("GEMINI_TEXT_MODEL", "gemini-2.5-flash")
OUT = Path(__file__).resolve().parents[1] / "brand-candidates"
OUT.mkdir(parents=True, exist_ok=True)

SYSTEM = (
    "You are a senior brand/logo designer who writes clean, production-grade SVG by hand. "
    "Output ONLY a single complete valid <svg> document — no markdown fences, no commentary. "
    "Canvas: 512x512, viewBox='0 0 512 512'. Start with a rounded-square background "
    "<rect> (rx=112) filled #050d1a. The mark must be BOLD, GEOMETRIC, minimal, centered, "
    "high-contrast, and still legible at 32x32 — so few shapes, thick strokes, lots of "
    "negative space, NO text/letters, NO tiny detail. Use the brand accents: teal #22b6a6, "
    "aqua #3dd6c4, mint #6ee7a8, with a subtle gradient allowed. Concept: "
)

CONCEPTS = {
    "wave-node": "an ocean wave curl whose crest resolves into 3-4 connected neural-network nodes (circles joined by lines), AI rising from the sea.",
    "current-c": "a single bold sweeping current ribbon that implies the letter C, with one glowing node dot at the tip of the curl.",
    "aperture-wave": "a thick circular aperture/compass ring with one clean wave curve slicing through its middle — coastal navigation meets intelligence.",
    "tide-circuit": "two stacked tide/horizon lines, a couple of short circuit traces rising from the upper line, and one bright spark/star above.",
}


def extract_svg(text: str) -> str | None:
    text = re.sub(r"^```(?:svg|xml)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    m = re.search(r"<svg.*?</svg>", text, flags=re.DOTALL | re.IGNORECASE)
    return m.group(0) if m else None


def main():
    client = genai.Client(api_key=KEY)
    print(f"[gen-svg] model={MODEL} -> {OUT}")
    made = []
    for name, concept in CONCEPTS.items():
        try:
            resp = client.models.generate_content(model=MODEL, contents=[SYSTEM + concept])
            svg = extract_svg(resp.text or "")
        except Exception as e:
            print(f"[gen-svg] {name}: ERROR {str(e)[:120]}")
            continue
        if not svg:
            print(f"[gen-svg] {name}: no <svg> in response")
            continue
        (OUT / f"{name}.svg").write_text(svg, encoding="utf-8")
        made.append((name, concept))
        print(f"[gen-svg] wrote {name}.svg")

    if not made:
        sys.exit("No SVGs generated.")

    cards = "\n".join(
        f'''<figure>
  <div class="row">
    <div class="big">{(OUT / f"{n}.svg").read_text(encoding="utf-8")}</div>
    <div class="small">{(OUT / f"{n}.svg").read_text(encoding="utf-8")}</div>
  </div>
  <figcaption><b>{n}</b> — {c}</figcaption>
</figure>'''
        for n, c in made
    )
    gallery = f'''<!doctype html><html><head><meta charset="utf-8"><title>Coastal.AI logo candidates</title>
<style>
 body{{background:#0b1220;color:#cde3ff;font-family:system-ui;margin:0;padding:2rem}}
 h1{{font-weight:600}} .grid{{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;max-width:1100px}}
 figure{{background:#0f1830;border:1px solid #1e2c4a;border-radius:14px;padding:1rem;margin:0}}
 .row{{display:flex;align-items:center;gap:1.5rem}}
 .big svg{{width:160px;height:160px}} .small svg{{width:32px;height:32px;image-rendering:auto}}
 figcaption{{margin-top:.75rem;font-size:.85rem;color:#9fb6d6}} b{{color:#6ee7a8}}
</style></head><body>
<h1>Coastal.AI — logo candidates (pick a direction)</h1>
<p style="color:#9fb6d6">Each shown at 160px and at the real 32px app-icon size. First-pass SVG; the chosen one gets refined + rasterized.</p>
<div class="grid">{cards}</div>
</body></html>'''
    (OUT / "gallery.html").write_text(gallery, encoding="utf-8")
    print(f"[gen-svg] gallery -> {OUT / 'gallery.html'} ({len(made)} candidates)")


if __name__ == "__main__":
    main()
