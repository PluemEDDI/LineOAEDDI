// CLI wrapper around src/validate.js. Exits non-zero on any fail.
import { validate } from "../src/validate.js";

const { fails, warns } = validate();
for (const w of warns) console.warn("warn:", w);
for (const f of fails) console.error("fail:", f);
console.log(`\n${fails.length} fail(s), ${warns.length} warn(s)`);
process.exit(fails.length ? 1 : 0);
