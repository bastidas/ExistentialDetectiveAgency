"use strict";

const path = require("path");
const fs = require("fs");
const config = require("../config");

const ATTACHE_INTRO_FILE = path.join(config.PROMPTS_DIR, "attache", "attache_opening_lines.md");

/**
 * Markdown-style bullet entries: each "-" starts a block until the next "-" or EOF.
 * @returns {string[]}
 */
function loadIntroEntries() {
  try {
    if (!fs.existsSync(ATTACHE_INTRO_FILE)) return [];
    const raw = fs.readFileSync(ATTACHE_INTRO_FILE, "utf8");
    const lines = raw.split(/\r?\n/);
    const entries = [];
    let current = null;

    for (const line of lines) {
      const m = line.match(/^\s*-\s*(.*)$/);
      if (m) {
        if (current != null && current.trim()) {
          entries.push(current.trim());
        }
        current = m[1] || "";
      } else if (current != null) {
        current += "\n" + line;
      }
    }

    if (current != null && current.trim()) {
      entries.push(current.trim());
    }

    return entries;
  } catch (_) {
    return [];
  }
}

/**
 * @returns {string|null}
 */
function getRandomIntroLine() {
  const entries = loadIntroEntries();
  if (!entries.length) return null;
  return entries[Math.floor(Math.random() * entries.length)];
}

module.exports = {
  loadIntroEntries,
  getRandomIntroLine,
};
