(function () {
  "use strict";

  (function debugOnLoad() {
    fetch("/api/debug", { credentials: "same-origin" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (d) {
        if (!d) return;
        console.log("[DEBUG] Model:", d.model);
        console.log("[DEBUG] Service tier:", d.serviceTier);
        var preview = d.promptPreview;
        var previewText =
          Array.isArray(preview) && preview.length
            ? preview.join("\n")
            : "(none – file not found or empty)";
        console.log("[DEBUG] Prompt file first 5 lines:", previewText);
        if (d.promptFilePath != null)
          console.log("[DEBUG] Prompt file path:", d.promptFilePath);
        if (d.promptPreviewFound === false)
          console.log("[DEBUG] Prompt file was not found or empty.");
        console.log(
          "[DEBUG] Your exchange count (this session):",
          (d.userExchangeCount ?? 0) + "/" + (d.maxUserExchanges ?? 5)
        );
        console.log(
          "[DEBUG] Daily usage:",
          d.dailyCount + " / " + (d.maxDailyUsage ?? 100)
        );
      })
      .catch(function () {});
  })();

  var form = document.getElementById("form");
  if (!form) return;

  if (typeof ChatConfig !== "undefined" && ChatConfig.applyChatStyle) {
    ChatConfig.applyChatStyle();
  }
  if (typeof NoteFormatConfig !== "undefined" && NoteFormatConfig.applyNoteFormatToPanels) {
    NoteFormatConfig.applyNoteFormatToPanels();
  }
  EDARules.loadRules();

  var bodyEl = document.body;
  var leftContentEl = document.getElementById("left-philosopher-content");
  var rightContentEl = document.getElementById("right-philosopher-content");
  var mobileSharedContentEl = document.getElementById("mobile-shared-notes-content");
  var currentViewport = null;
  var viewportQueries = {
    mobile: window.matchMedia ? window.matchMedia("(max-width: 768px)") : null,
    medium: window.matchMedia ? window.matchMedia("(min-width: 769px) and (max-width: 1440px)") : null,
  };

  function ensureNotesRegion(container, modifier) {
    if (!container) return null;
    var region = container.querySelector(".notes-region");
    if (region) return region;
    region = document.createElement("div");
    region.className = "notes-region" + (modifier ? " notes-region--" + modifier : "");
    container.appendChild(region);
    return region;
  }

  function moveNotesIntoSharedArea() {
    if (!mobileSharedContentEl) return;
    var sharedRegion = ensureNotesRegion(mobileSharedContentEl, "shared");
    if (!sharedRegion) return;
    [
      { panel: leftContentEl },
      { panel: rightContentEl },
    ].forEach(function (entry) {
      if (!entry.panel) return;
      var region = entry.panel.querySelector(".notes-region");
      if (!region) return;
      while (region.firstChild) {
        sharedRegion.appendChild(region.firstChild);
      }
      region.remove();
    });
  }

  function restoreNotesFromSharedArea() {
    if (!mobileSharedContentEl) return;
    var sharedRegion = mobileSharedContentEl.querySelector(".notes-region");
    if (!sharedRegion) return;
    var node = sharedRegion.firstChild;
    while (node) {
      var next = node.nextSibling;
      var side = node.dataset && node.dataset.noteSide === "right" ? "right" : "left";
      var targetPanel = side === "right" ? rightContentEl : leftContentEl;
      var targetRegion = ensureNotesRegion(targetPanel, side);
      if (targetRegion) {
        targetRegion.appendChild(node);
      }
      node = next;
    }
    sharedRegion.remove();
  }

  function handleViewportNotesMode(nextViewport) {
    if (!bodyEl) return;
    if (nextViewport === "mobile") {
      bodyEl.dataset.mobileNotesMode = "shared";
      moveNotesIntoSharedArea();
    } else {
      delete bodyEl.dataset.mobileNotesMode;
      restoreNotesFromSharedArea();
    }
  }

  function syncViewportFlag() {
    if (!bodyEl) return;
    var next = "large";
    if (viewportQueries.mobile && viewportQueries.mobile.matches) {
      next = "mobile";
    } else if (viewportQueries.medium && viewportQueries.medium.matches) {
      next = "medium";
    }
    if (bodyEl.dataset.viewport !== next) {
      bodyEl.dataset.viewport = next;
    }
    if (currentViewport !== next) {
      currentViewport = next;
      handleViewportNotesMode(next);
    }
  }

  function bindViewportListener(query) {
    if (!query) return;
    var handler = function () {
      syncViewportFlag();
    };
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
    } else if (typeof query.addListener === "function") {
      query.addListener(handler);
    }
  }

  bindViewportListener(viewportQueries.mobile);
  bindViewportListener(viewportQueries.medium);
  syncViewportFlag();

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var message = EDAChatInput && EDAChatInput.getValue ? EDAChatInput.getValue().trim() : "";
    if (!message) return;

    console.log(
      "[phil-annotations] Submit: checking message, rules count =",
      EDARules.getRulesCount()
    );
    var rewriteInfo = EDARules.applyRewriteFirst(message);

    function sendAndRunNotes(msg, html) {
      EDAChatSend.doSendMessage(msg, html);
      EDARules.runNoteActions(msg).catch(function (err) {
        console.warn("[phil-annotations] runNoteActions:", err);
      });
    }

    var html = EDAChatInput && EDAChatInput.getHtml ? EDAChatInput.getHtml() : undefined;
    if (rewriteInfo) {
      EDAChatSend.animateRewriteInInput(rewriteInfo).then(function (newMsg) {
        sendAndRunNotes(newMsg, EDAChatInput && EDAChatInput.getHtml ? EDAChatInput.getHtml() : undefined);
      });
    } else {
      sendAndRunNotes(message, html);
    }
  });
})();
