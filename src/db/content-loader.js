// Loads all content from MongoDB in a single parallel round-trip.
// Each JSON file is stored as ONE document in its own collection:
//
//   { _id: "singleton", data: <original JSON array or object> }
//
// Collections:
//   content                  ← content.json          (array)
//   faq                      ← faq.json              (array)
//   faq_th                   ← faq.th.json           (object: {items, categories})
//   intents                  ← intents.json          (object: {settings, intents[]})
//   translations_th          ← translations.th.json  (object: {id: {bodyTh}})
//   richmenu_areas           ← richmenu-areas.json   (array)
//   richmenu_sections_areas  ← richmenu-sections-areas.json (array)
import { getDb } from "./mongo.js";

const COLLECTIONS = [
  "content",
  "faq",
  "faq_th",
  "intents",
  "translations_th",
  "richmenu_areas",
  "richmenu_sections_areas",
];

/**
 * Fetch a singleton document from a collection.
 * Returns the `data` field (the original JSON payload).
 */
async function fetchOne(db, collName) {
  const doc = await db.collection(collName).findOne({ _id: "singleton" });
  if (!doc) {
    throw new Error(
      `[content-loader] Collection "${collName}" is empty. ` +
        `Run \`npm run seed\` to populate it from the local JSON files.`
    );
  }
  return doc.data;
}

/**
 * Load all 7 content collections in parallel.
 * Returns:
 * {
 *   content,             // array — equivalent to content.json
 *   faqItems,            // array — equivalent to faq.json
 *   faqTh,               // object — equivalent to faq.th.json
 *   intents,             // object — equivalent to intents.json
 *   translationsTh,      // object — equivalent to translations.th.json
 *   richmenuAreas,       // array  — equivalent to richmenu-areas.json
 *   richmenuSectionsAreas, // array — equivalent to richmenu-sections-areas.json
 * }
 */
export async function loadAllContent() {
  const db = getDb();

  const [
    content,
    faqItems,
    faqTh,
    intents,
    translationsTh,
    richmenuAreas,
    richmenuSectionsAreas,
  ] = await Promise.all(COLLECTIONS.map((c) => fetchOne(db, c)));

  console.log("[content-loader] all collections loaded from MongoDB");

  return {
    content,
    faqItems,
    faqTh,
    intents,
    translationsTh,
    richmenuAreas,
    richmenuSectionsAreas,
  };
}
