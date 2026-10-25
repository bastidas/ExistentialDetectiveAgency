(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.EDAChatMessageLimit = api;
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  /** Matches the server default (`DEFAULT_MAX_MESSAGE_CHARS` in api/usage/usageLimits.js). */
  var DEFAULT_MAX_CHARS = 2000;

  /**
   * Never allow more than this, whatever the server reports. Azure Table rejects string properties
   * over 32,768 UTF-16 characters, so this keeps a wide margin below it.
   */
  var CEILING_CHARS = 30000;

  var maxChars = DEFAULT_MAX_CHARS;

  function resolveMax(value) {
    var n = typeof value === "number" ? Math.floor(value) : NaN;
    if (!isFinite(n) || n < 1) return DEFAULT_MAX_CHARS;
    return Math.min(n, CEILING_CHARS);
  }

  /** Adopt the server's limit from `GET /api/config` (`maxMessageChars`). */
  function setMax(value) {
    maxChars = resolveMax(value);
    return maxChars;
  }

  function getMax() {
    return maxChars;
  }

  /**
   * @param {string} text
   * @param {number} [max]
   * @returns {{ ok: boolean, length: number, max: number, over: number }}
   */
  function check(text, max) {
    var limit = typeof max === "number" ? resolveMax(max) : maxChars;
    var length = String(text == null ? "" : text).trim().length;
    return { ok: length <= limit, length: length, max: limit, over: Math.max(0, length - limit) };
  }

  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function messageFor(result) {
    return (
      "That message is too long: " +
      fmt(result.length) +
      " characters, and the limit is " +
      fmt(result.max) +
      ". Please shorten it by " +
      fmt(result.over) +
      " character" +
      (result.over === 1 ? "" : "s") +
      "."
    );
  }

  return {
    DEFAULT_MAX_CHARS: DEFAULT_MAX_CHARS,
    CEILING_CHARS: CEILING_CHARS,
    resolveMax: resolveMax,
    setMax: setMax,
    getMax: getMax,
    check: check,
    messageFor: messageFor,
  };
});
