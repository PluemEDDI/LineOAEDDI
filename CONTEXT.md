# CONTEXT — ManualFAQ vocabulary

The project's shared language. Use these exact terms in code, docs, and PRs.
Update this file when a concept crystallizes or sharpens during work.

---

## Domain

**Manual section** — a node in the *Lecturer Manual*'s tree. Identified by a
dotted id (`1.3.1`). Has a title in English and Thai, an optional parent, zero
or more screenshots, and a feature/description body.

**Section id** — a dotted string like `1.1`, `1.3.1`. Treated as **immutable**:
when the manual renumbers a section, the registry **deletes the old id and adds
the new one**. The build gate catches orphaned translations or FAQ rows that
still point at the deleted id.

**FAQ category** — a free-text label on each row of `Lecturer_FAQ.csv`
("Home", "Live Class", …). Each category resolves to exactly one section id
via the registry's `faqCategories` list; this powers the screenshot attached
to FAQ answers.

## Pipeline

**Section registry** (`manual.config.json`) — the **single declarative source
of truth** for the section tree. Owns: `id`, `titleEn`, `titleTh`, `parent`,
`faqCategories`, expected `images`. Does **not** own: section bodies (PDF-derived)
or bodyTh (in `translations.th.json`).

**Section body** — the feature/description text inside a section. English
extracted from the PDF (→ `content.json`); Thai written by hand
(→ `translations.th.json`, keyed by id). Never stored in the registry.

**Structure-driven extractor** — the PDF→data tool that walks the document by
detecting `X.Y. Title` headings and `No. Feature Description` tables, attaching
each table and its screenshots to the nearest heading. Replaces the old
page-number hand-map.

**Override file** (`scripts/extract.overrides.json`) — per-section hints used
*only* when the heading walker is ambiguous. The thin remnant of the old page
map; expected to be small and shrink over time.

**Build gate** (`npm run build`) — the atomic pipeline that runs
extract → build_faq → richmenu → validate inside a **temp directory**, then
swaps artifacts into the repo only if every step (including validate) passed.
Half-built state never lands.

**Validation rule** — a check applied by `scripts/validate.mjs`. Each rule has
a **severity**: `fail` (build aborts non-zero, swap is skipped) or `warn`
(logged, build continues). The runtime also refuses to start on `fail`-class
inconsistencies — strict by design.

## Runtime

**UserStore** — interface for per-user state, generalized beyond language so
future per-user data (bookmarks, recently-asked questions, dismissed prompts)
can ride the same seam. Methods: `get(userId, key)`, `set(userId, key, value)`.

**FileUserStore** — adapter backed by a JSON file on disk. For VPS / persistent
disks.

**MemoryUserStore** — adapter that holds state in process memory only.
Default on ephemeral hosts; logs once at startup that state will not survive
restart. Acceptable because users can re-pick if it forgets.

**Config module** (`src/config.js`) — single source of tunable knobs (FAQ
thresholds, image limits, default language, …). Defaults in code, overridable
via env vars. Validated at startup; malformed values crash on boot rather than
silently falling back.

---

## Glossary cross-refs

For architectural vocabulary (*module, interface, depth, seam, adapter,
locality, deletion test*) see Karpathy's deepening guide; not repeated here.
