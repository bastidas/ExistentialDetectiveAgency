"use strict";

const { sliceNativeHistory } = require("../../prompting/userChannel");

/**
 * OpenAI `messages`: frozen `system` → native history roles → this-turn user channel.
 *
 * @param {object} input
 * @param {string} input.systemContent
 * @param {Array<{ role?: string, content?: unknown }>} [input.chatHistory]
 * @param {string} [input.userChannelContent] — packet JSON + QUERENT + raw text
 * @param {string} [input.userMessage] — fallback when `userChannelContent` is omitted
 * @returns {Array<{ role: string, content: string }>}
 */
function buildChatCompletionMessages({
  systemContent,
  chatHistory,
  userChannelContent,
  userMessage,
}) {
  const messages = [{ role: "system", content: String(systemContent ?? "") }];
  messages.push(...sliceNativeHistory(chatHistory));
  const last =
    userChannelContent != null ? String(userChannelContent) : String(userMessage ?? "");
  messages.push({ role: "user", content: last });
  return messages;
}

module.exports = {
  buildChatCompletionMessages,
};
