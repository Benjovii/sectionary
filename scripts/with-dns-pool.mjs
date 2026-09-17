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
const tsx = path.join("node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const child = spawn(tsx, [entry, ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "64" },
});
child.on("exit", (code) => process.exit(code ?? 1));
