"use strict";

const { formatConversationHistoryBlock } = require("./formatConversationHistoryBlock");

/**
 * Build OpenAI `messages` in the order used by detective / attaché / philosopher calls:
 * `system` (persona + instructions + catalog + custom + JSON schema appendix from `composeAgentPrompt`)
 * → optional history `user` → final `user` (this turn).
 * Dev preview order matches this via `./llmPayloadPreview.js` (`buildNonSystemMessagesPreview`).
 *
 * @param {object} input
 * @param {string} input.systemContent — exact string for `role: "system"`
 * @param {Array<{ role?: string, content?: unknown }>} [input.chatHistory]
 * @param {string} [input.userMessage] — current turn user text
 * @returns {Array<{ role: string, content: string }>}
 */
function buildChatCompletionMessages({ systemContent, chatHistory, userMessage }) {
  const messages = [{ role: "system", content: String(systemContent ?? "") }];
  const historyBlock = formatConversationHistoryBlock(
    Array.isArray(chatHistory) ? chatHistory : []
  );
  if (historyBlock) {
    messages.push({ role: "user", content: historyBlock });
  }
  messages.push({ role: "user", content: String(userMessage ?? "") });
  return messages;
}

module.exports = {
  buildChatCompletionMessages,
};
