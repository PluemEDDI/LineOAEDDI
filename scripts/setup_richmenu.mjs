// One-time setup: create the Rich Menu, upload its image, set it as default.
// Run after generating richmenu.png + richmenu-areas.json:
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

const areas = JSON.parse(
  readFileSync(join(ROOT, "richmenu-areas.json"), "utf8")
);

async function main() {
  // Remove any previously-created menus so re-running stays idempotent.
  const existing = await client.getRichMenuList();
  for (const m of existing.richmenus || []) {
    if (m.name === "ManualFAQ menu") await client.deleteRichMenu(m.richMenuId);
  }

  const { richMenuId } = await client.createRichMenu({
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "ManualFAQ menu",
    chatBarText: "เมนู Menu",
    areas,
  });
  console.log("created rich menu:", richMenuId);

  const png = readFileSync(join(ROOT, "richmenu.png"));
  await blob.setRichMenuImage(
    richMenuId,
    new Blob([png], { type: "image/png" })
  );
  console.log("uploaded image");

  await client.setDefaultRichMenu(richMenuId);
  console.log("set as default rich menu — done.");
}

main().catch((err) => {
  console.error("setup failed:", err?.body || err);
  process.exit(1);
});
