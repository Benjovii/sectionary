// Lets plain Node (type stripping, no bundler) import server code that uses the
// "@/..." alias from tsconfig.json, for scripts that run it outside Next.js:
//
//   node --import ./scripts/server-alias.mjs scripts/search-acceptance.mts
//
// "@/server/db" resolves to src/server/db.ts (or .tsx, or /index.ts).
import { statSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.__SERVER_ALIAS_HOOK) {
  process.env.__SERVER_ALIAS_HOOK = "1";
  register(import.meta.url);
}

const src = fileURLToPath(new URL("../src/", import.meta.url));

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = src + specifier.slice(2);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}
