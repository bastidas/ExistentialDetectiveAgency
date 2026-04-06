"use strict";

/**
 * Extract the `# TURN INSTRUCTIONS` block from a composed system prompt (dev lab / diagnostics).
 *
 * **Must** match the real section heading only: a line whose trimmed text is exactly `# TURN INSTRUCTIONS`.
 * (Prompts may mention `"# TURN INSTRUCTIONS"` inside prose earlier — `indexOf` on the substring would start
 * in the wrong place and diverge from what the full system message shows under the true heading.)
 *
 * Stops at the next top-level Markdown H1: a line matching `# ` where the second character is not `#`
 * (so `##` / `###` section headings do not terminate the block).
 *
 * @param {string|null|undefined} content
 * @returns {string}
 */
function extractTurnInstructionsFromSystemPrompt(content) {
  const s = String(content == null ? "" : content);
  const lines = s.split(/\r?\n/);
  let startLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === "# TURN INSTRUCTIONS") {
      startLine = i;
      break;
    }
  }
  if (startLine < 0) return "";

  const out = [];
  for (let k = startLine; k < lines.length; k += 1) {
    const line = lines[k];
    if (k > startLine && /^#[^#]/.test(line)) {
      break;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

module.exports = {
  extractTurnInstructionsFromSystemPrompt,
};
