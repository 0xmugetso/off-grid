import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const envPath = ".env.local";
const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const apiKey = process.env.CIRCLE_API_KEY?.trim();
if (!apiKey) throw new Error(`CIRCLE_API_KEY is missing. Put it in ${envPath}, then rerun with --env-file=${envPath}.`);
if (/^CIRCLE_ENTITY_SECRET=.+/m.test(envText)) {
  throw new Error(`${envPath} already contains CIRCLE_ENTITY_SECRET. Do not rotate it accidentally; use the existing secret or Circle's recovery flow.`);
}

const entitySecret = randomBytes(32).toString("hex");
const recoveryDir = "recovery";
mkdirSync(recoveryDir, { recursive: true });
const response = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: recoveryDir,
});

appendFileSync(envPath, `${envText.endsWith("\n") || envText.length === 0 ? "" : "\n"}CIRCLE_ENTITY_SECRET=${entitySecret}\n`);
console.log(`Entity secret registered. CIRCLE_ENTITY_SECRET was added to ${envPath}.`);
console.log(`Save the recovery file under ${recoveryDir}/ in a separate secure location.`);
if (response.data?.recoveryFile) console.log("Circle returned a recovery file; keep it with the entity secret.");
console.log("Next: npm run circle:create-escrow-agent");

