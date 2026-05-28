#!/usr/bin/env python3
"""Generate both Rich Menu images and tap-area maps.

Main menu (richmenu.png / richmenu-areas.json):
    full-width banner + 3 boxes (ManualQA / FAQs / Contact).
    The ManualQA box is a `richmenuswitch` action that flips the bottom
    bar to the sections menu below.

Sections menu (richmenu-sections.png / richmenu-sections-areas.json):
    4×2 grid: 7 top-level learner sections + a 'Back' cell that switches
    the bar back to the main menu.

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

# Aliases referenced by richmenuswitch actions. setup_richmenu.mjs creates
# the matching alias records on LINE so each button can flip the bar.
ALIAS_MAIN = "manualfaq-main"
ALIAS_SECTIONS = "manualfaq-sections"

# ── Main menu ────────────────────────────────────────────────────────────────
ROW1_H = H // 2
ROW2_H = H - ROW1_H

TOP_BANNER = {
    "th":  "เว็บไซต์",
    "en":  "Visit Website",
    "action": {"type": "uri", "uri": "https://learn.edditech.com"},
}

BOTTOM_BOXES = [
    {
        "th": "คู่มือ",
        "en": "ManualQA",
        # Switches the bar to the sections menu; the data postback also
        # lets the bot react (e.g. play an intro video) if desired.
        "action": {
            "type": "richmenuswitch",
            "richMenuAliasId": ALIAS_SECTIONS,
            "data": "menu=manual",
        },
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

# ── Sections menu ────────────────────────────────────────────────────────────
# Loaded from manual.config.json: take all parent-less (top-level) sections,
# pad with a 'Back' cell to fill a 4×2 grid.
with open(os.path.join(ROOT, "manual.config.json")) as _f:
    _REG = json.load(_f)
TOP_SECTIONS = [s for s in _REG["sections"] if s["parent"] is None]

SECTION_COLS, SECTION_ROWS = 4, 2
SECTION_CELL_W = W // SECTION_COLS
SECTION_CELL_H = H // SECTION_ROWS


def draw_cell(d, th_font, en_font, x, y, w, h, th, en):
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


def make_main():
    img = Image.new("RGB", (W, H), WHITE)
    d   = ImageDraw.Draw(img)
    th_font = ImageFont.truetype(THAI_FONT, 96)
    en_font = ImageFont.truetype(THAI_FONT, 60)
    areas = []

    draw_cell(d, th_font, en_font, x=0, y=0, w=W, h=ROW1_H,
              th=TOP_BANNER["th"], en=TOP_BANNER["en"])
    areas.append({"bounds": {"x": 0, "y": 0, "width": W, "height": ROW1_H},
                  "action": TOP_BANNER["action"]})

    n = len(BOTTOM_BOXES)
    cw = W // n
    for i, box in enumerate(BOTTOM_BOXES):
        x = i * cw
        w = cw if i < n - 1 else W - x
        draw_cell(d, th_font, en_font, x=x, y=ROW1_H, w=w, h=ROW2_H,
                  th=box["th"], en=box["en"])
        areas.append({"bounds": {"x": x, "y": ROW1_H, "width": w, "height": ROW2_H},
                      "action": box["action"]})

    img.save(os.path.join(ROOT, "richmenu.png"))
    with open(os.path.join(ROOT, "richmenu-areas.json"), "w") as f:
        json.dump(areas, f, ensure_ascii=False, indent=2)
    print(f"wrote richmenu.png + richmenu-areas.json ({len(areas)} areas)")


def make_sections():
    img = Image.new("RGB", (W, H), WHITE)
    d   = ImageDraw.Draw(img)
    th_font_lg = ImageFont.truetype(THAI_FONT, 80)
    th_font    = ImageFont.truetype(THAI_FONT, 64)
    en_font    = ImageFont.truetype(THAI_FONT, 44)
    areas = []

    # 7 sections + 1 Back cell, in row-major order.
    cells = []
    for s in TOP_SECTIONS[:7]:
        cells.append({
            "th": s["titleTh"],
            "en": f"{s['id']} {s['titleEn']}",
            "action": {
                "type": "postback",
                "data": f"section={s['id']}",
                "displayText": f"{s['id']} {s['titleEn']}",
            },
        })
    cells.append({
        "th": "ย้อนกลับ",
        "en": "Back",
        "action": {
            "type": "richmenuswitch",
            "richMenuAliasId": ALIAS_MAIN,
            "data": "menu=back",
        },
    })

    for i, cell in enumerate(cells[:SECTION_COLS * SECTION_ROWS]):
        col = i % SECTION_COLS
        row = i // SECTION_COLS
        x = col * SECTION_CELL_W
        y = row * SECTION_CELL_H
        w = SECTION_CELL_W if col < SECTION_COLS - 1 else W - x
        h = SECTION_CELL_H if row < SECTION_ROWS - 1 else H - y
        draw_cell(d, th_font_lg if cell["en"] == "Back" else th_font,
                  en_font, x=x, y=y, w=w, h=h,
                  th=cell["th"], en=cell["en"])
        areas.append({"bounds": {"x": x, "y": y, "width": w, "height": h},
                      "action": cell["action"]})

    img.save(os.path.join(ROOT, "richmenu-sections.png"))
    with open(os.path.join(ROOT, "richmenu-sections-areas.json"), "w") as f:
        json.dump(areas, f, ensure_ascii=False, indent=2)
    print(f"wrote richmenu-sections.png + richmenu-sections-areas.json ({len(areas)} areas)")


def main():
    make_main()
    make_sections()


if __name__ == "__main__":
    main()
