#!/usr/bin/env python3
"""Learner Manual extractor.

The Learner PDF is small (26 pages) with a near-1:1 page→section mapping,
so attribution is an explicit table rather than the heuristic walker the
Lecturer version needed. Output: content.json, img/, preview/.

Run: python3 scripts/extract.py "/path/to/Learner Manual.pdf"
"""
import io
import json
import os
import re
import sys

import pypdf
from PIL import Image

PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "Learner Manual.pdf")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "img")
PREVIEW_DIR = os.path.join(ROOT, "preview")
PREVIEW_MAX_W = 1024

with open(os.path.join(ROOT, "manual.config.json")) as _f:
    REG = json.load(_f)
SECTIONS = [(s["id"], s["titleEn"]) for s in REG["sections"]]

# Section id -> 1-indexed PDF pages that carry its body / images.
# Derived once by reading the PDF; keep here for clarity and easy editing.
PAGES = {
    "1.0":   [3],
    "1.1":   [4],
    "1.1.1": [5],
    "1.1.2": [6],
    "1.1.3": [7],
    "1.2":   [8],
    "1.2.1": [9],
    "1.2.2": [10],
    "1.2.3": [11],
    "1.3":   [12],
    "1.3.1": [13],
    "1.3.2": [14],
    "1.3.3": [15],
    "1.3.4": [16],
    "1.3.5": [17],
    "1.3.6": [18],
    "1.3.7": [19, 20],
    "1.3.8": [21, 22, 23],
    "1.5":   [24],
    "1.6":   [25],
    "1.7":   [26],
}

INTRO_TH = ("คู่มือนี้จะแนะนำฟีเจอร์และการใช้งานหลักของแพลตฟอร์มให้นักศึกษาทีละขั้นตอน "
            "เหมาะสำหรับทั้งผู้ใช้ใหม่และผู้ใช้ที่มีประสบการณ์ โดยมีคำแนะนำที่ชัดเจน "
            "เทคนิคที่นำไปใช้ได้จริง และแนวทางการใช้งานที่ดีที่สุด "
            "เพื่อช่วยให้นักศึกษาใช้ประโยชน์จากระบบได้อย่างเต็มที่")

HEADING_LINE = re.compile(r"^\d+(?:\.\d+){1,2}\.\s")
TABLE_HDR = re.compile(r"No\.\s*Feature\s*Description")

# Thai range covers most syllables; sara/yamakkan included.
THAI_CHAR = r"[฀-๿]"


def clean_thai(text: str) -> str:
    """The PDF emits each Thai syllable on its own text run, so naive
    extraction yields 'นัก ศึกษา' instead of 'นักศึกษา'. Glue adjacent
    Thai chars back together while keeping spaces around Latin/digits."""
    # Collapse runs of whitespace first.
    text = re.sub(r"\s+", " ", text).strip()
    # Iteratively remove spaces between two Thai chars (one pass is not
    # enough because re.sub doesn't reuse the boundary char).
    pat = re.compile(f"({THAI_CHAR})\\s+(?={THAI_CHAR})")
    prev = None
    while prev != text:
        prev = text
        text = pat.sub(r"\1", text)
    # Tighten common token boundaries the PDF splits ("ค ลิ ก", "เม นู").
    return text.strip()


def page_text(reader, page_no: int) -> str:
    return reader.pages[page_no - 1].extract_text() or ""


def section_body(reader, sid: str) -> str:
    """Keep table rows only; strip the heading and the 'No. Feature
    Description' table header. Return cleaned Thai text."""
    body = clean_thai("\n".join(page_text(reader, pno) for pno in PAGES[sid]))
    # Drop everything up to and including 'No. Feature Description' so the
    # heading and the literal column headers don't bleed into the body.
    m = TABLE_HDR.search(body)
    if m:
        body = body[m.end():].strip()
    else:
        # No table on this page — strip leading heading token "X.Y." or
        # "X.Y.Z." and the section title that follows.
        body = re.sub(r"^\d+(?:\.\d+){1,2}\.\s*\S+(?:\s+\S+)*?\s+", "", body, count=1)
    # Collapse row markers "1." / "2." into bullet separators for readability.
    body = re.sub(r"\s(\d+)\.\s", r"\n\1. ", body)
    return body.strip()


def extract_images(reader):
    """Save large embedded images per page, named by attributed section."""
    page_to_sec = {p: sid for sid, pages in PAGES.items() for p in pages}
    out = {sid: [] for sid in PAGES}
    for pidx, page in enumerate(reader.pages):
        pno = pidx + 1
        sid = page_to_sec.get(pno)
        if not sid:
            continue
        k = 0
        for im in page.images:
            try:
                w, h = im.image.size
            except Exception:
                continue
            if h < 200:
                continue
            k += 1
            fn = f"{sid}_{pno}_{k}.png"
            with open(os.path.join(IMG_DIR, fn), "wb") as f:
                f.write(im.data)
            pv = Image.open(io.BytesIO(im.data)).convert("RGB")
            if pv.width > PREVIEW_MAX_W:
                ratio = PREVIEW_MAX_W / pv.width
                pv = pv.resize((PREVIEW_MAX_W, round(pv.height * ratio)))
            pv.save(os.path.join(PREVIEW_DIR, fn), optimize=True)
            out[sid].append(fn)
    return out


def main():
    reader = pypdf.PdfReader(PDF)
    for d in (IMG_DIR, PREVIEW_DIR):
        for fn in os.listdir(d) if os.path.isdir(d) else []:
            os.remove(os.path.join(d, fn))
        os.makedirs(d, exist_ok=True)

    images = extract_images(reader)

    out, flags = [], []
    for sid, title in SECTIONS:
        body = section_body(reader, sid)
        if sid == "1.1" and not body:
            body = INTRO_TH
        out.append({"id": sid, "titleEn": title, "body": body,
                    "images": images.get(sid, [])})
        if not body:
            flags.append(f"{sid} {title}: EMPTY body")
        if not images.get(sid):
            flags.append(f"{sid} {title}: NO image")

    with open(os.path.join(ROOT, "content.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"wrote content.json ({len(out)} sections)")
    print(f"wrote {len(os.listdir(IMG_DIR))} images to img/")
    print("\n--- REVIEW FLAGS ---")
    for fl in flags or ["(none)"]:
        print(" *", fl)


if __name__ == "__main__":
    main()
