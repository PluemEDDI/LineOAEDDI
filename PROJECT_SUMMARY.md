# ManualFAQ — Project Summary

A **no-LLM LINE Official Account chatbot** that answers questions about the
*Lecturer Manual* (Learning Platform, Instructor role). It serves the manual two
ways: **menu navigation** (tap/type through the section tree) and **semantic FAQ
search** (type a question in Thai or English, get the matching answer). Bilingual
(Thai/English), and runs at ~**$0** ongoing cost.

> **Note on "Time usage":** these are *estimated developer-effort* figures for
> each piece (for planning/reporting), not tracked wall-clock time.

---

## Overview table

| # | Work | Impact | Est. effort |
|---|------|--------|-------------|
| 1 | PDF → structured content + screenshots | Foundation; turns an 88-page PDF into reliable bot data | 4–5 h |
| 2 | Express webhook (menu navigation) | Core bot: deterministic answers, zero wrong replies | 3–4 h |
| 3 | Local test suite | Confidence to change code safely | 1–2 h |
| 4 | Rich Menu (Thai/English) | One-tap navigation on mobile | 2 h |
| 5 | PC text-command fallback | Bot usable on LINE PC (buttons are mobile-only) | 1–2 h |
| 6 | Language selection + Thai translations | Full Thai/English experience | 4–5 h |
| 7 | Semantic FAQ search (local, $0) | Natural "ask a question" without an LLM | 5–6 h |
| 8 | Bug fixes & go-live support | Unblocked deployment | 1–2 h |
| | **Total** | | **~21–28 h** |

---

## 1. PDF → structured content + screenshots

**What:** Extracted the manual into machine-usable data: `content.json`
(21 sections with text), `img/` (34 screenshots) and `preview/` (downscaled
copies). Scripted in `scripts/extract.py`.

**Detail:**
- Parsed the table of contents into a clean section tree (1.1 … 1.7 + subsections).
- Solved a font bug where ligatures (ff/tt) were dropped — they map to private-use
  codepoints (``, ``); mapped them back to ASCII so text reads correctly.
- Handled the layout quirk where description tables lag one page behind their
  heading (explicit page→section map) and split two pages that pack two tables each.
- Extracted real screenshots (filtered out 1px divider images), generated <1MB
  previews for LINE's preview-image limit.

**Impact:** Reliable, verifiable data foundation — every later feature reads from
this. Re-runnable when the PDF changes.

**Est. effort:** 4–5 h (most of it diagnosing the ligature/layout quirks).

---

## 2. Express webhook — menu navigation (the core bot)

**What:** A Node/Express LINE webhook (`src/server.js`, `src/messages.js`,
`src/content.js`) that replies to user taps with the matching screenshot + text
and drill-down buttons.

**Detail:**
- Verifies the LINE signature; serves `/img` and `/preview` statically.
- Builds `[image, text]` replies with Quick-Reply drill-down (sub-sections, Back,
  Main menu), respecting LINE's 5-message / 5000-char limits.
- Fully deterministic — no AI, so it can never invent a wrong answer.

**Impact:** A working, safe chatbot that maps 1:1 to the manual's structure.

**Est. effort:** 3–4 h.

---

## 3. Local test suite

**What:** `test/local-test.mjs` — fast, offline checks of the message builders
and routing.

**Detail:** Asserts correct image+text per section, drill-down, language
rendering, FAQ routing, message/char limits, label lengths, no broken glyphs.
Grew to 14 checks; runs with `npm test` (no credentials/network).

**Impact:** Every later change was verified in seconds, preventing regressions.

**Est. effort:** 1–2 h.

---

## 4. Rich Menu (Thai/English)

**What:** Generated the persistent bottom-of-chat menu image
(`scripts/make_richmenu_image.py`) and an uploader (`scripts/setup_richmenu.mjs`).

**Detail:** A 4×2 grid (7 sections + a Language button) rendered with a Thai font,
plus a tap-area map kept in sync with the image. One command uploads it and sets
it as the default menu.

**Impact:** One-tap navigation for mobile users; on-brand look.

**Est. effort:** 2 h.

---

## 5. PC text-command fallback

**What:** Made the bot usable on LINE for PC/Mac, where Rich Menu and Quick-Reply
buttons don't render (mobile-only).

**Detail:** Every reply also lists options as typeable numbers; users type a
section number (`1.3`, `1.3.1`), `menu`, or a FAQ number. Verified against LINE's
docs that buttons are mobile-only.

**Impact:** Full functionality on desktop, not just mobile.

**Est. effort:** 1–2 h.

---

## 6. Language selection + Thai translations

**What:** Per-user Thai/English choice; UI and manual content both switch.

**Detail:**
- `translations.th.json`: Thai titles + bodies for all sections (kept separate so
  re-extraction never overwrites them).
- Per-user language stored in `data/userlang.json` (survives restarts).
- Switch via the Rich-Menu **ภาษา/Language** button, the in-reply button, typing
  `lang`/`ภาษา`, or a first-contact prompt.

**Impact:** A genuinely bilingual experience for Thai/mixed users.

**Est. effort:** 4–5 h (mostly authoring/checking the Thai content).

---

## 7. Semantic FAQ search (local embeddings, $0, no LLM)

**What:** Users type a free-form question and get the matching pre-written answer
from `Lecturer_FAQ.csv` — no menu needed.

**Detail:**
- `scripts/build_faq.mjs` parses 50 Q&A pairs and embeds each question once
  (`faq-index.json`) using a local multilingual model via `transformers.js`.
- `src/faq.js` embeds the user's question, ranks by cosine similarity, and
  `classify()` chooses **answer** / **did-you-mean** / **menu fallback**.
- Cross-lingual: Thai questions match the English FAQ. Off-topic questions are
  rejected (no confident wrong answers).
- No API key, no per-query cost; only returns existing answers (never generated).

**Impact:** "Ask a question" UX at zero inference cost, with safety thresholds.

**Est. effort:** 5–6 h (incl. model verification and threshold tuning).

---

## 8. Bug fixes & go-live support

**What:** Resolved real deployment errors as they came up.

**Detail:**
- `previewImageUrl` field name (LINE rejected `previewContentUrl`).
- Webhook URL pointing at `/` instead of `/webhook` (404s).
- `BASE_URL` must be HTTPS or LINE rejects image URLs (added a startup warning).
- The "this account cannot reply" message = LINE auto-reply still on: set response
  mode to **Bot**, turn **Auto-response off**, **Webhook on**.

**Impact:** Cleared the blockers between "code works" and "live on LINE."

**Est. effort:** 1–2 h.

---

## Cost & limits (why it stays ~$0)

- The bot only uses **Reply API** messages, which are **free and unlimited** on
  LINE — the 300-messages/month quota counts only push/broadcast, which we don't use.
- FAQ search runs a **local** model: no LLM, no API key, no per-query cost.
- Only cost is **hosting** (a small Node server, often free-tier).

## Known follow-ups (not yet done)

- FAQ **answers are English** (questions match cross-lingually); add a Thai answer
  column for Thai answers.
- Threshold tuning (`HIGH`/`LOW`/`GAP` in `src/faq.js`) is empirical — adjust as
  real questions come in.
- Thai translations are a build-time draft — have a native speaker review.
- Auto-processing a *new* manual needs a structure-driven extractor (current
  page-map is hand-tuned to this PDF).
