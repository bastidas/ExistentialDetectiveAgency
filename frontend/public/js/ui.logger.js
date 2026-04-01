(function (global) {
  "use strict";

  function isDevEnabled() {
    return !!(document.body && document.body.dataset && document.body.dataset.devMode === "true");
  }

  function isDebugLogsEnabled() {
    return !!(document.body && document.body.dataset && document.body.dataset.debugLogs === "true");
  }

  function shouldLogDebug() {
    return isDevEnabled() || isDebugLogsEnabled();
  }

  function styleFor(channel) {
    var key = String(channel || "UI").toUpperCase();
    if (key === "HTTP") return "color:#4aa3ff;font-weight:600";
    if (key === "STATE") return "color:#22c55e;font-weight:600";
    if (key === "LLM") return "color:#a78bfa;font-weight:600";
    if (key === "STORAGE") return "color:#f59e0b;font-weight:600";
    return "color:#eab308;font-weight:600";
  }

  function debug(channel, message) {
    if (!shouldLogDebug()) return;
    var args = Array.prototype.slice.call(arguments, 2);
    console.log("%c[" + String(channel || "UI").toUpperCase() + "] " + String(message || ""), styleFor(channel), ...args);
  }

  function info(channel, message) {
    var args = Array.prototype.slice.call(arguments, 2);
    console.info("%c[" + String(channel || "UI").toUpperCase() + "] " + String(message || ""), styleFor(channel), ...args);
  }

  function warn(channel, message) {
    var args = Array.prototype.slice.call(arguments, 2);
    console.warn("%c[" + String(channel || "UI").toUpperCase() + "] " + String(message || ""), styleFor(channel), ...args);
  }

  function error(channel, message) {
    var args = Array.prototype.slice.call(arguments, 2);
    console.error("%c[" + String(channel || "UI").toUpperCase() + "] " + String(message || ""), styleFor(channel), ...args);
  }

  global.EDALogger = {
    debug: debug,
    info: info,
    warn: warn,
    error: error,
    shouldLogDebug: shouldLogDebug,
  };
})(window);

