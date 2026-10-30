// Cross-platform dev runner: starts the API (port 3000) and the Vite dev server (port 5173).
import { spawn } from "node:child_process";

const procs = [
  ["api", ["run", "dev", "--workspace", "server"]],
  ["web", ["run", "dev", "--workspace", "web"]],
].map(([name, args]) => {
  const child = spawn("npm", args, { stdio: ["inherit", "pipe", "pipe"], shell: process.platform === "win32" });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => `[${name}] ${l}`)
      .join("\n") + "\n";
  child.stdout.on("data", (c) => process.stdout.write(prefix(c)));
  child.stderr.on("data", (c) => process.stderr.write(prefix(c)));
  child.on("exit", (code) => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
