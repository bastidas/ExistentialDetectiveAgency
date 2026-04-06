"use strict";

const path = require("path");
const fs = require("fs");
const config = require("../config");

const DETECTIVE_OPENING_FILE = path.join(config.PROMPTS_DIR, "detective", "detective_opening_lines.md");

/**
 * One entry per non-empty line (file is line-oriented, not `-` bullets).
 * @returns {string[]}
 */
function loadDetectiveOpeningLines() {
  try {
    if (!fs.existsSync(DETECTIVE_OPENING_FILE)) return [];
    const raw = fs.readFileSync(DETECTIVE_OPENING_FILE, "utf8");
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * @returns {string|null}
 */
function getRandomDetectiveOpeningLine() {
  const lines = loadDetectiveOpeningLines();
  if (!lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

module.exports = {
  loadDetectiveOpeningLines,
  getRandomDetectiveOpeningLine,
};
