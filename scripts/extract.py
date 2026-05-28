#!/usr/bin/env python3
"""Structure-driven PDF extractor.

Walks the PDF detecting "X.Y. Title" headings and "No. Feature Description"
tables in reading order. Each table is attached to the right section by:

  - counting headings (H) and tables (T) on each page
  - if T >= H: the first (T-H) tables on the page pop the oldest sections from
    a pending FIFO queue (their tables landed late); the remaining H tables
    pair 1-to-1 with this page's headings
  - if T <  H: the first T headings pair with the tables; remaining headings
    go to the queue for later pages
  - a heading with intro text on its page (no table) resolves with that intro

Section list comes from manual.config.json (registry).
Per-page exceptions live in scripts/extract.overrides.json — small by design.

Run: python3 scripts/extract.py "/path/to/Lecturer Manual.pdf"
"""
import io
import json
import os
import re
import sys

import pypdf
from PIL import Image

PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Downloads/Lecturer Manual.pdf")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "img")
PREVIEW_DIR = os.path.join(ROOT, "preview")
PREVIEW_MAX_W = 1024

with open(os.path.join(ROOT, "manual.config.json")) as _f:
    REG = json.load(_f)
SECTIONS = [(s["id"], s["titleEn"]) for s in REG["sections"]]
SECTION_IDS = {sid for sid, _ in SECTIONS}

try:
    with open(os.path.join(ROOT, "scripts", "extract.overrides.json")) as _f:
        OVERRIDES = json.load(_f)
except FileNotFoundError:
    OVERRIDES = {"bodyOverrides": {}, "imageOverrides": {}}

# The font maps ff/tt ligatures to private-use codepoints; fi/fl/ffi/ffl come
# through as Unicode ligature chars. Map all back to ASCII. (Use escape
# codes so the PUA chars survive file rewrites.)
LIG = {"": "ff", "": "tt",
       "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl",
       "ﬃ": "ffi", "ﬄ": "ffl"}
WORDS = {"Bakeout": "Breakout"}  # genuine source typo in a heading
INTRO = ("Introduction This manual will walk you through the key features and "
         "functions of the platform step by step. It is intended for both new "
         "and experienced users, offering clear instructions, practical tips, "
         "and best practices to help you maximize the benefits of the system.")

# "1.3" or "1.3.1" + period + space + Capital letter (start of title)
HEADING_RE = re.compile(r"\b(\d+\.\d+(?:\.\d+)?)\.\s+(?=[A-Z])")
TABLE_HDR = re.compile(r"No\.\s*Feature\s*Description")

# titleEn-anchored end-of-heading: after the heading number, the title words
# follow ("Course Plan"). We advance the heading's `end` past the title so
# the walker doesn't mistake the title for intro text. Built from registry.
TITLE_BY_ID = {sid: title for sid, title in SECTIONS}


def decode(t):
    """Fix ligatures + whitespace. Preserves heading numbers ("1.3.1.")
    so the walker can locate headings."""
    for k, v in LIG.items():
        t = t.replace(k, v)
    t = re.sub(r"[ \t]+", " ", t)
    t = " ".join(ln.strip() for ln in t.splitlines() if ln.strip())
    for k, v in WORDS.items():
        t = re.sub(r"\b" + re.escape(k) + r"\b", v, t)
    return t.strip()


def dedigit(t):
    """Strip "1." / "2." / "1.3.1." row-number markers from stored body
    text. Applied AFTER walker attribution so it doesn't munch headings."""
    return re.sub(r"\b\d+(?:\.\d+){0,2}\.\s*", "", t).strip()


def body_of(text):
    """Drop heading words preceding the first table marker, if any."""
    m = TABLE_HDR.search(text)
    return text[m.start():].strip() if m else text


def walk(reader):
    bodies = {sid: [] for sid, _ in SECTIONS}
    images_for_page = {}  # page_no (1-based) -> section id
    queue = []        # FIFO of sections awaiting a table body
    last_attached = None
    last_heading = None  # most recent heading id (for image attribution)

    body_ovr = OVERRIDES.get("bodyOverrides", {})
    img_ovr = OVERRIDES.get("imageOverrides", {})

    # Page 1 is the table of contents — its "Home ... 2" lines look like
    # headings to the regex. Skip it.
    for pidx in range(1, len(reader.pages)):
        page_no = pidx + 1
        text = decode(reader.pages[pidx].extract_text() or "")

        # Tokens on this page in reading order.
        tokens = []
        for m in HEADING_RE.finditer(text):
            sid = m.group(1)
            if sid not in SECTION_IDS:
                continue
            # Advance heading end past the title words (anchored to titleEn
            # from the registry) so the title itself doesn't get treated as
            # intro text for sections that have no table on their page.
            end = m.end()
            # Title-match is whitespace-flexible so the registry's
            # "Add Linkage Tools / Individual or Group Assignment" matches
            # the PDF's "Add Linkage Tools/Individual or Group Assignment".
            title = TITLE_BY_ID[sid]
            title_pat = re.escape(title).replace(r"\ ", r"\s*")
            tm = re.match(title_pat, text[end:end + 200], re.IGNORECASE)
            if tm:
                end += tm.end()
            tokens.append({"k": "h", "s": m.start(), "e": end, "id": sid})
        for m in TABLE_HDR.finditer(text):
            tokens.append({"k": "t", "s": m.start(), "e": m.end()})
        tokens.sort(key=lambda x: x["s"])
        headings = [t for t in tokens if t["k"] == "h"]
        tables = [t for t in tokens if t["k"] == "t"]

        # Update most-recent-heading tracker (used for image attribution).
        if headings:
            last_heading = headings[-1]["id"]

        # Image attribution: override > most recent heading at/before this page.
        img_sec = img_ovr.get(str(page_no), last_heading)
        if img_sec:
            images_for_page[page_no] = img_sec

        # --- BODY ATTRIBUTION ------------------------------------------------

        # Body override forces the entire page's body text to one section.
        if str(page_no) in body_ovr:
            sid = body_ovr[str(page_no)]
            raw = body_of(text) if TABLE_HDR.search(text) else text
            bodies[sid].append(dedigit(raw))
            last_attached = sid
            queue = [q for q in queue if q != sid]
            # Headings on this page still need their own tables later.
            for h in headings:
                if h["id"] != sid and h["id"] not in queue:
                    queue.append(h["id"])
            continue

        # Manual front matter: page 2 carries the document Introduction + "1.1"
        # heading at the bottom. The Introduction is 1.1's intro body.
        if page_no == 2 and any(h["id"] == "1.1" for h in headings):
            bodies["1.1"].append(INTRO)
            last_attached = "1.1"
            for h in headings:
                if h["id"] != "1.1" and h["id"] not in queue:
                    queue.append(h["id"])
            continue

        # No tokens at all -> page text is continuation of the last section.
        if not tokens:
            if text and last_attached:
                bodies[last_attached].append(dedigit(text))
            continue

        # Decide table -> section attributions for this page.
        H, T = len(headings), len(tables)
        attributions = [None] * T
        excess = max(0, T - H)
        # First (T-H) tables: pop oldest queued sections (their tables arrived
        # on a later page than their headings).
        for i in range(excess):
            attributions[i] = queue.pop(0) if queue else (last_attached or SECTIONS[0][0])
        # Remaining tables pair 1-to-1 with this page's headings in order.
        for i in range(min(H, T - excess)):
            attributions[excess + i] = headings[i]["id"]

        paired_heading_idx = set(range(min(H, T - excess)))

        # Attach each table's content slice.
        for ti, tbl in enumerate(tables):
            # chunk runs from this table's marker to the next token's start
            next_pos = next((tok["s"] for tok in tokens if tok["s"] > tbl["s"]), len(text))
            chunk = text[tbl["s"]:next_pos].strip()
            sid = attributions[ti]
            if sid and chunk:
                bodies[sid].append(dedigit(chunk))
                last_attached = sid

        # Headings that didn't pair with a table on this page: if there's intro
        # text immediately following the heading (e.g. top-level intro sections
        # like 1.4), resolve with that text; otherwise queue for later.
        for hi, h in enumerate(headings):
            if hi in paired_heading_idx:
                continue
            # text from this heading's end to the next token's start (or end)
            next_pos = next((tok["s"] for tok in tokens if tok["s"] > h["s"]), len(text))
            seg = text[h["e"]:next_pos].strip()
            if seg:
                bodies[h["id"]].append(dedigit(seg))
                last_attached = h["id"]
            else:
                queue.append(h["id"])

    return bodies, images_for_page


def main():
    r = pypdf.PdfReader(PDF)

    # Clean output dirs.
    for d in (IMG_DIR, PREVIEW_DIR):
        for fn in os.listdir(d) if os.path.isdir(d) else []:
            os.remove(os.path.join(d, fn))
        os.makedirs(d, exist_ok=True)

    bodies, images_for_page = walk(r)
    images = {sid: [] for sid, _ in SECTIONS}

    # Extract real screenshots from each page, attributing by images_for_page.
    for pidx, page in enumerate(r.pages):
        page_no = pidx + 1
        isec = images_for_page.get(page_no)
        if not isec:
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
            fn = f"{isec}_{page_no}_{k}.png"
            with open(os.path.join(IMG_DIR, fn), "wb") as f:
                f.write(im.data)
            pv = Image.open(io.BytesIO(im.data)).convert("RGB")
            if pv.width > PREVIEW_MAX_W:
                r2 = PREVIEW_MAX_W / pv.width
                pv = pv.resize((PREVIEW_MAX_W, round(pv.height * r2)))
            pv.save(os.path.join(PREVIEW_DIR, fn), optimize=True)
            images[isec].append(fn)

    out, flags = [], []
    for sid, title in SECTIONS:
        body = "\n".join(bodies[sid]).strip()
        out.append({"id": sid, "titleEn": title, "body": body,
                    "images": images[sid]})
        if not body:
            flags.append(f"{sid} {title}: EMPTY body")
        if not images[sid]:
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
