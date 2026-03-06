/**
 * Closing stamps: when the user hits their chat limit, show 1–3 rubber-stamp overlays
 * on the chat area. Content and styling from data/closing_stamps.json.
 */
(function (global) {
  "use strict";

  var STAMP_TYPES = ["stashed", "tracked", "anomaly"];
  var STAMP_FORMATS = {
    stashed: { line1Suffix: "REGISTERED", line2Prefix: "NOMINAL -- " },
    tracked: { line1Suffix: "VIABLE", line2Prefix: "OSINT -- " },
    anomaly: { line1Suffix: "ANOMALIES", line2Prefix: "RITUAL -- " },
  };

  var configCache = null;
  var finalExchangeCount = 0;
  var atLimit = false;

  function formatTimestamp(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    var h = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return y + "-" + m + "-" + d + " " + h + ":" + min;
  }

  function loadConfig() {
    if (configCache) return Promise.resolve(configCache);
    return fetch("data/closing_stamps.json", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("closing_stamps.json " + res.status);
        return res.json();
      })
      .then(function (data) {
        configCache = data;
        return data;
      });
  }

  function getLocale(config) {
    var override = (global.ChatConfig && global.ChatConfig.stampLocale) || null;
    if (override && typeof override === "string") return override;
    if (config.defaultLocale) return config.defaultLocale;
    var types = ["stashed", "tracked", "anomaly"];
    for (var i = 0; i < types.length; i++) {
      var t = config[types[i]];
      if (t && t.phrases && typeof t.phrases === "object") {
        var keys = Object.keys(t.phrases);
        if (keys.length) return keys[0];
      }
    }
    return "en";
  }

  function pickPhrase(phrasesByLocale, locale) {
    var arr = phrasesByLocale[locale] || phrasesByLocale.en;
    if (!Array.isArray(arr) || arr.length === 0) return "";
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function shuffle(array) {
    var out = array.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function isDebugMode() {
    return typeof document !== "undefined" && document.body && document.body.dataset.devMode === "true";
  }

  /**
   * Call when a "final exchange" occurs: limitReached (200 with closer), noReply (204 when already at limit), or debug in dev when at limit.
   * Stamps only when user exchange count is at or above max. Shows one stamp per exchange: 1st = stashed, 2nd = tracked, 3rd = anomaly, 4th = none, 5th+ = anomaly 33%.
   */
  function maybeShowStamps(options) {
    var limitReached = options && options.limitReached;
    var noReply = options && options.noReply;
    var debug = options && options.debug;

    if (limitReached) atLimit = true;
    if (noReply) atLimit = true; /* 204 only happens when at limit */
    if (noReply && !atLimit) return;
    if (debug && !atLimit) return; /* only allow debug path when already at limit */

    if (limitReached || noReply || debug) finalExchangeCount += 1;
    else return;

    var n = finalExchangeCount;
    var typeToShow = null;
    if (n === 1) typeToShow = "stashed";
    else if (n === 2) typeToShow = "tracked";
    else if (n === 3) typeToShow = "anomaly";
    else if (n >= 5 && Math.random() < 0.2) typeToShow = "anomaly";
    if (!typeToShow) return;

    renderOneStamp(typeToShow, debug);
  }

  /** Last .message in #messages (user or assistant). Stamp appears after the last message. Returns null when there are no messages. */
  function getStampAnchor(messages) {
    var all = messages.querySelectorAll(".message");
    return all.length > 0 ? all[all.length - 1] : null;
  }

  function renderOneStamp(typeKey, debug) {
    var messages = document.getElementById("messages");
    if (!messages) return;
    var anchor = getStampAnchor(messages);
    if (!anchor || !anchor.classList.contains("message")) return;

    loadConfig()
      .then(function (config) {
        var typeConfig = config[typeKey];
        if (!typeConfig || !typeConfig.phrases) return;

        var locale = getLocale(config);
        var phrase = pickPhrase(typeConfig.phrases, locale);
        var displayText;
        if (typeKey === "anomaly") {
          displayText = phrase;
        } else {
          var fmt = STAMP_FORMATS[typeKey];
          if (!fmt) return;
          var now = new Date();
          now.setFullYear(now.getFullYear() - 13);
          now.setMinutes(now.getMinutes() + 15);
          var timestamp = formatTimestamp(now);
          displayText = timestamp + " " + fmt.line1Suffix + " " + fmt.line2Prefix + phrase;
        }

        var block = document.createElement("div");
        block.className = "chat-closing-stamp-block";
        block.setAttribute("aria-hidden", "true");

        var stamp = document.createElement("div");
        stamp.className = "chat-closing-stamp chat-closing-stamp--" + typeKey;
        stamp.textContent = displayText;

        var rotationRange = typeof typeConfig.rotation_range === "number" ? typeConfig.rotation_range : 20;
        var deg = (Math.random() * 2 - 1) * rotationRange;
        var offsetPx = (Math.random() * 2 - 1) * 48;
        var anchorHeight = anchor.getBoundingClientRect().height;
        var overlapPx = Math.min(Math.max(anchorHeight * 0.4, 24), 72);
        var topPx = -overlapPx + (Math.random() * 12);
        stamp.style.top = topPx + "px";
        stamp.style.left = "50%";
        stamp.style.transform = "translateX(calc(-50% + " + offsetPx + "px)) rotate(" + deg + "deg)";

        block.appendChild(stamp);
        var next = anchor.nextElementSibling;
        if (next) messages.insertBefore(block, next);
        else messages.appendChild(block);
      })
      .catch(function (err) {
        console.warn("[ClosingStamps] Could not load or render stamps:", err.message);
      });
  }

  function showStamps() {
    if (global.EDAClosingStamps && typeof global.EDAClosingStamps.maybeShowStamps === "function") {
      global.EDAClosingStamps.maybeShowStamps({ debug: true });
    }
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  global.EDAClosingStamps = {
    showStamps: showStamps,
    maybeShowStamps: maybeShowStamps,
  };
})(typeof window !== "undefined" ? window : this);
