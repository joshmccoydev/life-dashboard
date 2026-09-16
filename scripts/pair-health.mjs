import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
const root = path.resolve(import.meta.dirname, ".."),
  envPath = path.join(root, ".env.local");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
let token = env.match(/^HEALTH_SYNC_TOKEN=(.+)$/m)?.[1];
if (!token) {
  token = crypto.randomBytes(32).toString("hex");
  env += `${env.endsWith("\n") ? "" : "\n"}HEALTH_SYNC_TOKEN=${token}\n`;
  fs.writeFileSync(envPath, env, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}
const interfaces = os.networkInterfaces();
const addresses = [
  ...(interfaces.en0 || []),
  ...Object.values(interfaces).flat(),
].filter((x) => x && x.family === "IPv4" && !x.internal);
const address = addresses[0]?.address || "YOUR_MAC_LAN_IP";
const folder = path.join(root, ".lifedash");
fs.mkdirSync(folder, { recursive: true });
const file = path.join(folder, "health-pairing.txt");
fs.writeFileSync(
  file,
  `LifeDash local Health connection\n\nSet adapters.health to auto in src/config/dashboard.json, then restart LifeDash.\n\nURL: http://${address}:3000/api/health/sync\nHeader: Authorization\nValue: Bearer ${token}\n\nConnect iPhone and Mac to the same trusted Wi-Fi. This local HTTP link is not encrypted; do not use it over public networks.\n\nHealth Auto Export settings:\nREST API / JSON / Version 2\nHealth Metrics: Step Count, Sleep Analysis, Active Energy, Apple Exercise Time\nSummarize Data: ON / Time Grouping: Days / Aggregate Sleep: ON\nDate Range: Default (yesterday + today); avoid Since Last Sync\nBatch Requests: OFF / Sync: hourly (iOS may delay while locked)\nPreferred Sources: Apple Watch first\nAdd the Authorization header above. Test once with your iPhone unlocked.\n\nAlternatively, Apple Shortcuts can POST a daily JSON dictionary using the same URL and header. See README.md.\n`,
  { mode: 0o600 },
);
fs.chmodSync(file, 0o600);
console.log(
  "Pairing credentials saved to .lifedash/health-pairing.txt. Restart LifeDash after first pairing. No Health data has been sent.",
);
