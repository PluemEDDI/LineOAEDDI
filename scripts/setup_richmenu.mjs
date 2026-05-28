// One-time setup: create both Rich Menus (main + sections), register their
// aliases so the richmenuswitch actions work, upload images, set main as the
// default. Idempotent — re-running cleans up the previously-named menus and
// aliases first.
//   node --env-file=.env scripts/setup_richmenu.mjs
import { readFileSync } from "node:fs";
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
    image: "richmenu.png",
    areasFile: "richmenu-areas.json",
    isDefault: true,
  },
  {
    name: "ManualFAQ sections",
    chatBarText: "หัวข้อ Topics",
    aliasId: ALIAS_SECTIONS,
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

async function createMenu(spec) {
  const areas = JSON.parse(readFileSync(join(ROOT, spec.areasFile), "utf8"));
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
