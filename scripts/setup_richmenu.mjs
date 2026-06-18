// One-time setup: create both Rich Menus (main + sections), register their
// aliases so the richmenuswitch actions work, upload images, set main as the
// default. Idempotent — re-running cleans up the previously-named menus and
// aliases first.
//   node --env-file=.env scripts/setup_richmenu.mjs
//
// Area data source:
//   CONTENT_BACKEND=mongo → fetches richmenu_areas + richmenu_sections_areas
//                           from MongoDB so you can update areas without a
//                           file change (no code redeploy needed).
//   CONTENT_BACKEND=file  (default) → reads from the local JSON files as before.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { messagingApi } from "@line/bot-sdk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const channelAccessToken = process.env.CHANNEL_ACCESS_TOKEN;
if (!channelAccessToken) {
  console.error("Missing CHANNEL_ACCESS_TOKEN. Run with --env-file=.env");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });
const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

// Must match scripts/make_richmenu_image.py — that file references these in
// the richmenuswitch actions baked into each menu's areas.
const ALIAS_MAIN = "manualfaq-main";
const ALIAS_SECTIONS = "manualfaq-sections";

const MENUS = [
  {
    name: "ManualFAQ main",
    chatBarText: "เมนู Menu",
    aliasId: ALIAS_MAIN,
    colName: "richmenu_areas",
    image: "richmenu.png",
    areasFile: "richmenu-areas.json",
    isDefault: true,
  },
  {
    name: "ManualFAQ sections",
    chatBarText: "หัวข้อ Topics",
    aliasId: ALIAS_SECTIONS,
    colName: "richmenu_sections_areas",
    image: "richmenu-sections.png",
    areasFile: "richmenu-sections-areas.json",
    isDefault: false,
  },
];

async function cleanupExisting() {
  // Aliases first — they're FK'd to the menus.
  let aliases = { aliases: [] };
  try { aliases = await client.getRichMenuAliasList(); } catch {}
  for (const a of aliases.aliases || []) {
    if (a.richMenuAliasId === ALIAS_MAIN || a.richMenuAliasId === ALIAS_SECTIONS) {
      await client.deleteRichMenuAlias(a.richMenuAliasId);
    }
  }
  const list = await client.getRichMenuList();
  for (const m of list.richmenus || []) {
    if (m.name === "ManualFAQ menu" || MENUS.some((x) => x.name === m.name)) {
      await client.deleteRichMenu(m.richMenuId);
    }
  }
}

// Load area definitions — from Mongo when CONTENT_BACKEND=mongo, else from disk.
async function loadAreas(colName, filePath) {
  const backend = process.env.CONTENT_BACKEND || "file";
  if (backend === "mongo") {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.warn(`  ⚠  MONGODB_URI not set, falling back to file: ${filePath}`);
    } else {
      const { MongoClient } = await import("mongodb");
      const mc = new MongoClient(mongoUri);
      await mc.connect();
      const dbName = new URL(mongoUri).pathname.replace(/^\//, "") || "manualfaq";
      const doc = await mc.db(dbName).collection(colName).findOne({ _id: "singleton" });
      await mc.close();
      if (doc?.data) {
        console.log(`  [mongo] loaded ${colName}`);
        return doc.data;
      }
      console.warn(`  ⚠  ${colName} not found in Mongo, falling back to file: ${filePath}`);
    }
  }
  // File fallback.
  return JSON.parse(readFileSync(join(ROOT, filePath), "utf8"));
}

async function createMenu(spec) {
  const areas = await loadAreas(spec.colName, spec.areasFile);
  const { richMenuId } = await client.createRichMenu({
    size: { width: 2500, height: 1686 },
    selected: spec.isDefault,
    name: spec.name,
    chatBarText: spec.chatBarText,
    areas,
  });
  const png = readFileSync(join(ROOT, spec.image));
  await blob.setRichMenuImage(
    richMenuId,
    new Blob([png], { type: "image/png" })
  );
  await client.createRichMenuAlias({
    richMenuAliasId: spec.aliasId,
    richMenuId,
  });
  console.log(`  ${spec.name}: ${richMenuId}  (alias=${spec.aliasId})`);
  return richMenuId;
}

async function main() {
  console.log("cleaning up existing menus + aliases…");
  await cleanupExisting();

  console.log("creating menus…");
  const ids = {};
  for (const spec of MENUS) {
    ids[spec.aliasId] = await createMenu(spec);
  }

  await client.setDefaultRichMenu(ids[ALIAS_MAIN]);
  console.log(`set ${ALIAS_MAIN} as default rich menu — done.`);
}

main().catch((err) => {
  console.error("setup failed:", err?.body || err);
  process.exit(1);
});
