// This file must be loaded before everything else via --import flag
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dir = new URL(".", import.meta.url).pathname;

try {
  const env = readFileSync(resolve(__dir, "../../../.env"), "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (k) process.env[k] = v;
  }
} catch (e) {
  console.error("env load:", e.message);
}
