#!/usr/bin/env python3
"""Generate Coastal.AI app-icon / logo candidates via the Gemini image model.

Requires GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment and `google-genai`.
Writes PNG candidates to packages/desktop/brand-candidates/ (gitignored until
one is approved). These are REAL generated options for selection — not committed
placeholder art.

    GEMINI_API_KEY=... python3 packages/desktop/scripts/gen-logo-candidates.py
"""
import os
import sys
from pathlib import Path

try:
    from google import genai
except ImportError:
    sys.exit("google-genai not installed: pip install google-genai")

API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
if not API_KEY:
    sys.exit("Set GEMINI_API_KEY (https://aistudio.google.com/apikey) and re-run.")

MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
OUT = Path(__file__).resolve().parents[1] / "brand-candidates"
OUT.mkdir(parents=True, exist_ok=True)

# Brand: coastal/ocean + AI/tech. Palette: deep navy #050d1a base,
# teal #22b6a6 / aqua / mint #6ee7a8 accents. Must read as a SQUARE app icon at
# both 32px and 1024px — so: bold, simple silhouette, generous negative space,
# one clear focal mark, no fine detail or text.
BASE = (
    "A modern square app icon for an AI software platform named Coastal.AI. "
    "Deep navy background (#050d1a). Accent colors teal (#22b6a6), aqua, and mint (#6ee7a8). "
    "Bold, minimal, geometric, high contrast, centered single mark with generous negative space, "
    "legible when scaled down to 32x32 pixels. Flat vector style, subtle depth, no text, no words, "
    "no lettering, slightly rounded square icon with a soft inner glow. Concept: "
)

CONCEPTS = {
    "wave-node": "a stylized ocean wave curl whose crest dissolves into connected neural-network nodes and dots, suggesting AI emerging from the sea.",
    "current-c": "the letter C implied by a single sweeping ocean current ribbon with a small glowing node where the current ends.",
    "aperture-wave": "a circular compass/aperture ring with a clean wave curve cutting through its center, suggesting coastal navigation guided by intelligence.",
    "tide-circuit": "two layered tide lines forming a minimal horizon, with a few circuit traces and a single bright spark above the waterline.",
}


def main():
    client = genai.Client(api_key=API_KEY)
    print(f"[gen-logo] model={MODEL} -> {OUT}")
    made = 0
    for name, concept in CONCEPTS.items():
        prompt = BASE + concept
        try:
            resp = client.models.generate_content(model=MODEL, contents=[prompt])
        except Exception as e:  # surface API errors per concept, keep going
            print(f"[gen-logo] {name}: ERROR {e}")
            continue
        for part in resp.candidates[0].content.parts:
            data = getattr(part, "inline_data", None)
            if data and getattr(data, "data", None):
                path = OUT / f"{name}.png"
                path.write_bytes(data.data)
                print(f"[gen-logo] wrote {path}")
                made += 1
                break
    if made == 0:
        sys.exit("No images returned — check the model name / key / quota.")
    print(f"[gen-logo] done — {made} candidate(s) in {OUT}")


if __name__ == "__main__":
    main()
