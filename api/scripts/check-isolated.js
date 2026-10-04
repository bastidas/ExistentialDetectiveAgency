"use strict";

/**
 * Azure Static Web Apps deploys only `api_location` (this folder). Copy it alone to a temp directory
 * and make sure the Functions entry loads, so a `require()` that reaches outside `api/` fails here
 * and not in production.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const apiDir = path.resolve(__dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eda-api-isolated-"));
const target = path.join(tmpRoot, "api");

function copy(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (["node_modules", ".env", ".git"].includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copy(from, to);
    else fs.copyFileSync(from, to);
  }
}

let code = 1;
try {
  copy(apiDir, target);
  fs.symlinkSync(path.join(apiDir, "node_modules"), path.join(target, "node_modules"), "junction");
  const res = spawnSync(process.execPath, ["-e", 'require("./index.js"); console.log("api loads in isolation")'], {
    cwd: target,
    env: { ...process.env, OFFLINE: "1" },
    encoding: "utf8",
  });
  process.stdout.write(res.stdout || "");
  process.stderr.write(res.stderr || "");
  code = res.status === 0 ? 0 : 1;
  if (code !== 0) console.error(`check-isolated: failed (exit ${res.status}) from ${target}`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
process.exit(code);
