// Runs a TypeScript entry point under tsx with a larger libuv thread pool.
//
// Node resolves host names on a pool of 4 threads. A crawler that meets a few
// dead domains (each lookup hanging for ~10 s) blocks that pool, and every
// other request then times out looking like "robots unreachable". The pool
// size can only be set before the process starts, hence this launcher.
//   node scripts/with-dns-pool.mjs src/validate.ts --target 1000
import { spawn } from "node:child_process";
import path from "node:path";

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error("usage: node scripts/with-dns-pool.mjs <script.ts> [args]");
  process.exit(1);
}
// tsx's own entry point, started with this same node: no shell in between, so
// arguments arrive untouched and there is one process fewer to stop.
const tsx = path.join("node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(process.execPath, [tsx, entry, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "64",
    // node:sqlite (the crawl queue) still prints an "experimental" notice on every start.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --disable-warning=ExperimentalWarning`.trim(),
  },
});
// Ctrl+C reaches the child by itself (same console). Stay alive until it has
// shut down cleanly, so the prompt does not come back over its last lines.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 1));
