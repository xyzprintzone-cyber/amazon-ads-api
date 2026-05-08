import { readFileSync } from "fs";
import { resolve } from "path";

const __dir = new URL(".", import.meta.url).pathname;

// Cerca .env prima nella cartella del progetto, poi risale
const candidates = [
  resolve(__dir, ".env"),
  resolve(__dir, "../.env"),
  resolve(__dir, "../../.env"),
];

for (const path of candidates) {
  try {
    const env = readFileSync(path, "utf8");
    for (const line of env.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (k) process.env[k] = v;
    }
    console.log(`[env] loaded from ${path}`);
    break;
  } catch {}
}
