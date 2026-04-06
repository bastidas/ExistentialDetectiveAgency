"use strict";

/**
 * One user message listing prior turns (current turn is sent separately).
 * @param {Array<{ role?: string, content?: unknown }>|undefined} chatHistory
 * @returns {string|null}
 */
function formatConversationHistoryBlock(chatHistory) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return null;
  const lines = chatHistory
    .map((m) => {
      const role = m && typeof m.role === "string" ? m.role : "user";
      const content = m && m.content != null ? String(m.content) : "";
      return `${role}: ${content}`;
    })
    .join("\n");
  return ["Conversation history", "", lines].join("\n");
}

module.exports = {
  formatConversationHistoryBlock,
};
