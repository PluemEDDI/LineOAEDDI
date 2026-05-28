# ManualFAQ — LINE Manual Bot (no AI)

A LINE Official Account bot that serves the **Lecturer Manual** by menu
navigation. No AI: every answer is a deterministic lookup. Tapping a Rich Menu
button drills into the manual's section tree and replies with the matching
screenshot(s) + the feature/description text.

**Mobile vs PC.** Rich Menu and Quick Reply buttons are mobile-only (iOS /
Android). On LINE for PC/Mac they don't render, so every reply also lists its
options as **typeable numbers** — PC users type a section number (e.g. `1.3`
or `1.3.1`) or `menu` to navigate. Same content, no AI either way.

**Language (Thai / English).** Each user picks a language; the choice is stored
per `userId` in `data/userlang.json` (survives restarts) and defaults to Thai.
Switch via the **ภาษา / Language** Rich-Menu button, the language button in any
quick-reply bar, or by typing `lang` / `ภาษา` (then `th` / `en`). UI text comes
from `src/content.js`; translated manual content lives in `translations.th.json`
(keyed by section id — kept separate so re-running `extract.py` never wipes it).
The Thai content is a build-time draft — have a Thai speaker review it.

## Project layout

```
content.json          21 sections: { id, titleEn, body, images }
img/                  full-size screenshots
preview/              downscaled previews (<=1MB, for LINE previewContentUrl)
richmenu.png          generated Rich Menu image (2500x1686)
richmenu-areas.json   tap-area map matching richmenu.png
src/
  content.js          loads content.json, section tree, text formatter
  messages.js         builds [image, text] + Quick Reply drill-down
  server.js           Express webhook (LINE signature verified)
scripts/
  extract.py          PDF -> content.json + img/ + preview/
  make_richmenu_image.py   -> richmenu.png + richmenu-areas.json
  setup_richmenu.mjs       uploads + sets the default Rich Menu
test/local-test.mjs   8 checks on the message builders (no creds needed)
```

## Ask-a-question (semantic FAQ search, $0, no LLM)

Users can type a question in Thai or English and get the matching answer from
`Lecturer_FAQ.csv` — no menu tapping required. It uses a **local** multilingual
embedding model (`transformers.js`), so there is **no API key and no per-query
cost**; it only ever returns the pre-written CSV answers (never generated text).

- `scripts/build_faq.mjs` parses the CSV into `faq.json` and embeds every
  question once into `faq-index.json` (run `npm run build:faq`).
- At runtime `src/faq.js` embeds the user's question, ranks FAQs by cosine
  similarity, and `classify()` decides: **answer** (confident + clear winner),
  **did-you-mean** (ambiguous → show top matches as buttons), or fall back to the
  **menu** (nothing relevant — so it won't confidently give a wrong answer).
- The model loads once at startup (`warmup()`, ~7s) so the first user is fast.
- Each FAQ maps to a manual section via its `Category`, so answers can include
  the relevant screenshot and an "open full section" button.

Note: FAQ **answers are English** (from the CSV). The bot's UI is bilingual and
Thai questions match correctly (cross-lingual), but to show Thai *answers* you'd
add a Thai answer column — same approach as `translations.th.json`.

## 1. Get LINE credentials

1. Create a **LINE Official Account**, then in the
   [LINE Developers console](https://developers.line.biz/) add a
   **Messaging API** channel for it.
2. Copy these into a `.env` file (see `.env.example`):
   - `CHANNEL_SECRET` (Basic settings)
   - `CHANNEL_ACCESS_TOKEN` (Messaging API → issue a long-lived token)
3. In the Messaging API tab: **disable** "Auto-reply messages" and "Greeting
   messages" (the bot handles replies itself), and **enable** "Use webhook".

## 2. Install & test locally

```bash
npm install
npm test            # 8 builder checks, no creds required
```

## 3. Run with a public HTTPS URL

LINE only calls HTTPS webhooks. For local testing use ngrok:

```bash
# .env: set BASE_URL to the ngrok URL (no trailing slash), then:
npm start                       # starts on PORT (default 3000)
ngrok http 3000                 # in another terminal
```

Set the **Webhook URL** in the console to `https://<your-host>/webhook` and
press **Verify**. `BASE_URL` must match that host so image URLs resolve.

## 4. Install the Rich Menu (one-time)

```bash
python3 scripts/make_richmenu_image.py   # regenerate art if labels change
npm run setup:richmenu                   # upload + set as default
```

Add the OA as a friend and the 7-button menu appears at the bottom of the chat.

## Regenerating content from the PDF

```bash
python3 scripts/extract.py "/path/to/Lecturer Manual.pdf"
```

Rewrites `content.json`, `img/`, and `preview/`. Section→page mapping is
explicit in `extract.py` (the PDF places tables one page after their heading),
so re-check that map if the source PDF changes.

## Deploying for production

Any Node host works (Render, Railway, Fly, Cloud Run). Set `CHANNEL_SECRET`,
`CHANNEL_ACCESS_TOKEN`, and `BASE_URL` (your public HTTPS URL) as env vars,
run `npm start`, and point the webhook URL at `https://<host>/webhook`.

The embedding model (~100–400MB) downloads on first boot to a local cache, so
the host needs outbound internet the first time (or pre-warm the cache in your
build step). `faq.json` / `faq-index.json` are committed, so the CSV isn't
needed at runtime — only re-run `npm run build:faq` when the FAQ changes.
```
