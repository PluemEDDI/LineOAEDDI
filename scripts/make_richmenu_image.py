#!/usr/bin/env python3
"""Generate the Rich Menu image (richmenu.png) and tap-area map
(richmenu-areas.json). Layout: 1 full-width top banner + 3 equal boxes.

Run: python3 scripts/make_richmenu_image.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 2500, 1686
NAVY  = (31,  42,  68)
INK   = (31,  42,  68)
BORDER = (226, 230, 238)
ORANGE = (249, 115,  22)
WHITE  = (255, 255, 255)
THAI_FONT = "/System/Library/Fonts/Supplemental/Ayuthaya.ttf"

# ── Layout heights ────────────────────────────────────────────────────────────
ROW1_H = H // 2          # top banner height  (843 px)
ROW2_H = H - ROW1_H     # bottom row height  (843 px)

# ── Top banner — links to website ────────────────────────────────────────────
TOP_BANNER = {
    "th":  "เว็บไซต์",
    "en":  "Visit Website",
    "action": {"type": "uri", "uri": "https://learn.edditech.com"},  # ← change URL here
}

# ── Bottom 3 boxes ───────────────────────────────────────────────────────────
BOTTOM_BOXES = [
    {
        "th": "คู่มือ",
        "en": "ManualQA",
        "action": {"type": "postback", "data": "menu=manual",  "displayText": "คู่มือ ManualQA"},
    },
    {
        "th": "คำถามเจอบ่อย",
        "en": "FAQs",
        "action": {"type": "postback", "data": "menu=faq",     "displayText": "คำถามเจอบ่อย FAQs"},
    },
    {
        "th": "ติดต่อเรา",
        "en": "Contact Admin",
        "action": {"type": "postback", "data": "menu=contact", "displayText": "ติดต่อเรา Contact Admin"},
    },
]


def draw_cell(d, th_font, en_font, x, y, w, h, th, en):
    """Draw one cell: border, orange accent bar, and bilingual label."""
    d.rectangle([x, y, x + w - 1, y + h - 1], outline=BORDER, width=4)
    d.rectangle([x, y, x + w - 1, y + 16],    fill=ORANGE)

    for text, font, dy, color in (
        (th, th_font, -70, INK),
        (en, en_font,  60, NAVY),
    ):
        tb = d.textbbox((0, 0), text, font=font)
        tw, ht = tb[2] - tb[0], tb[3] - tb[1]
        d.text(
            (x + (w - tw) / 2 - tb[0], y + (h - ht) / 2 + dy - tb[1]),
            text, font=font, fill=color,
        )


def main():
    img = Image.new("RGB", (W, H), WHITE)
    d   = ImageDraw.Draw(img)
    th_font = ImageFont.truetype(THAI_FONT, 96)
    en_font = ImageFont.truetype(THAI_FONT, 60)

    areas = []

    # ── Row 1: full-width top banner ─────────────────────────────────────────
    draw_cell(d, th_font, en_font,
              x=0, y=0, w=W, h=ROW1_H,
              th=TOP_BANNER["th"], en=TOP_BANNER["en"])
    areas.append({
        "bounds": {"x": 0, "y": 0, "width": W, "height": ROW1_H},
        "action": TOP_BANNER["action"],
    })

    # ── Row 2: three equal boxes ─────────────────────────────────────────────
    n   = len(BOTTOM_BOXES)
    cw  = W // n
    y2  = ROW1_H

    for i, box in enumerate(BOTTOM_BOXES):
        x = i * cw
        w = cw if i < n - 1 else W - x   # last cell absorbs rounding
        draw_cell(d, th_font, en_font,
                  x=x, y=y2, w=w, h=ROW2_H,
                  th=box["th"], en=box["en"])
        areas.append({
            "bounds": {"x": x, "y": y2, "width": w, "height": ROW2_H},
            "action": box["action"],
        })

    # ── Save outputs ──────────────────────────────────────────────────────────
    img.save(os.path.join(ROOT, "richmenu.png"))
    with open(os.path.join(ROOT, "richmenu-areas.json"), "w") as f:
        json.dump(areas, f, ensure_ascii=False, indent=2)
    print(f"wrote richmenu.png ({W}x{H}) and richmenu-areas.json ({len(areas)} areas)")


if __name__ == "__main__":
    main()
