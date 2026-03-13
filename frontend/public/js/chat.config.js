/**
 * Main chat column styling. Single source of truth for colors, spacing, and typography.
 * Applied as CSS custom properties (--chat-*) so chat-paper.css can use var(--chat-*).
 */
(function (global) {
  "use strict";

  var CHAT_STYLE = {
    /* Main column */
    mainBg: "#e8e4d8",
    mainMargin: "2em",
    mainPadding: "1.5em",
    mainMaxWidth: "120em",
    mainMinWidthLg: "56em",
    mainTextColor: "#1a1a1a",
    mainBorderRadius: "0.25rem",

    /* Labels and messages */
    labelColor: "#555",
    userLabelColor: "#2c5282",
    userBubbleBg: "#d4d0c4",
    userBubbleBorder: "#bbb",
    assistantBubbleBg: "#e0dcd0",
    assistantBubbleBorder: "#999",

    /* Status */
    statusColor: "#555",
    statusErrorColor: "#c53030",

    /* Editor */
    editorFontFamily: "'Cutive Mono', 'Courier New', monospace",
    editorLineHeight: "1.5",
    placeholderColor: "#888",

    /* Cursor */
    cursorBg: "#1a1a1a",
    cursorBorder: "2px solid #1a1a1a",
    cursorShadow: "1px 1px 0 #1a1a1a, -0.5px 0 0 #1a1a1a",
    cursorMinWidth: "2px",
    cursorMinHeight: "1em",

    /* Divider line */
    lineMargin: "0.75rem 0",
    lineHeight: "2px",
    lineColor: "#1a1a1a",
    lineTransition: "width 1.5s ease-out",
  };

  /**
   * Apply CHAT_STYLE as CSS custom properties on document.documentElement.
   * Call once at app init. chat-paper.css uses var(--chat-*, fallback).
   */
  function applyChatStyle() {
    if (typeof document === "undefined" || !document.documentElement) return;
    var root = document.documentElement;
    root.style.setProperty("--chat-bg", CHAT_STYLE.mainBg);
    root.style.setProperty("--chat-margin", CHAT_STYLE.mainMargin);
    root.style.setProperty("--chat-padding", CHAT_STYLE.mainPadding);
    root.style.setProperty("--chat-max-width", CHAT_STYLE.mainMaxWidth);
    root.style.setProperty("--chat-min-width-lg", CHAT_STYLE.mainMinWidthLg);
    root.style.setProperty("--chat-text", CHAT_STYLE.mainTextColor);
    root.style.setProperty("--chat-radius", CHAT_STYLE.mainBorderRadius);
    root.style.setProperty("--chat-label", CHAT_STYLE.labelColor);
    root.style.setProperty("--chat-user-label", CHAT_STYLE.userLabelColor);
    root.style.setProperty("--chat-user-bubble-bg", CHAT_STYLE.userBubbleBg);
    root.style.setProperty("--chat-user-bubble-border", CHAT_STYLE.userBubbleBorder);
    root.style.setProperty("--chat-assistant-bubble-bg", CHAT_STYLE.assistantBubbleBg);
    root.style.setProperty("--chat-assistant-bubble-border", CHAT_STYLE.assistantBubbleBorder);
    root.style.setProperty("--chat-status", CHAT_STYLE.statusColor);
    root.style.setProperty("--chat-status-error", CHAT_STYLE.statusErrorColor);
    root.style.setProperty("--chat-editor-font", CHAT_STYLE.editorFontFamily);
    root.style.setProperty("--chat-editor-line-height", CHAT_STYLE.editorLineHeight);
    root.style.setProperty("--chat-placeholder", CHAT_STYLE.placeholderColor);
    root.style.setProperty("--chat-cursor-bg", CHAT_STYLE.cursorBg);
    root.style.setProperty("--chat-cursor-border", CHAT_STYLE.cursorBorder);
    root.style.setProperty("--chat-cursor-shadow", CHAT_STYLE.cursorShadow);
    root.style.setProperty("--chat-cursor-min-width", CHAT_STYLE.cursorMinWidth);
    root.style.setProperty("--chat-cursor-min-height", CHAT_STYLE.cursorMinHeight);
    root.style.setProperty("--chat-line-margin", CHAT_STYLE.lineMargin);
    root.style.setProperty("--chat-line-height", CHAT_STYLE.lineHeight);
    root.style.setProperty("--chat-line-color", CHAT_STYLE.lineColor);
    root.style.setProperty("--chat-line-transition", CHAT_STYLE.lineTransition);
  }

  var AGENT_CHAT_LABEL = "*** ATTACHÉ ***";

  global.EDAChatConfig = {
    CHAT_STYLE: CHAT_STYLE,
    AGENT_CHAT_LABEL: AGENT_CHAT_LABEL,
    applyChatStyle: applyChatStyle,
  };
})(typeof window !== "undefined" ? window : this);
