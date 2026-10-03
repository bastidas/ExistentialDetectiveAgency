"use strict";

/**
 * Azure Static Web Apps deploys only `frontend/api` (see workflows: `api_location`).
 * Copy that folder alone to a temp directory and load the Functions entry point there,
 * so any require that reaches outside `frontend/api` fails here instead of in production.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const apiDir = path.resolve(__dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eda-api-isolated-"));
const target = path.join(tmpRoot, "api");

const SKIP = new Set(["node_modules", ".env", ".git"]);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

function main() {
  copyDir(apiDir, target);
  const modules = path.join(apiDir, "node_modules");
  if (!fs.existsSync(modules)) {
    throw new Error("node_modules missing: run `npm ci` in frontend/api first");
  }
  fs.symlinkSync(modules, path.join(target, "node_modules"), "dir");

  const result = spawnSync(
    process.execPath,
    ["-e", 'require("./src/index.js"); console.log("isolated api load: ok");'],
    {
      cwd: target,
      env: { ...process.env, OFFLINE: "1", NODE_ENV: "test" },
      encoding: "utf8",
    }
  );
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return result.status === 0 ? 0 : 1;
}

let code = 1;
try {
  code = main();
} catch (err) {
  console.error(err && err.message ? err.message : err);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
process.exit(code);
