(function () {
  "use strict";

  function initIntroSplash() {
    var body = document.body;
    if (!body) return;

    var hash = window.location.hash;
    var isMenuHash = hash === "#" || hash === "#/" || hash === "#menu";

    // If we land directly on non-intro routes like /q or /p,
    // skip the splash entirely and go straight to "menu" state.
    var path = window.location.pathname.toLowerCase();
    var isNonIntroRoute = path === "/q" || path === "/p";
    if (isNonIntroRoute) {
      body.dataset.introState = "menu";
      return;
    }

    // If we land directly on /# (or equivalent), skip the splash and show menu.
    if (isMenuHash) {
      body.dataset.introState = "menu";
      return;
    }

    // Default: play splash, then reveal menu and rewrite to /# on plain "/".
    body.dataset.introState = "splash";
    var splashDuration = 2600; // matches title crack/blur animation

    window.setTimeout(function () {
      body.dataset.introState = "menu";
      if (window.location.pathname === "/" && !window.location.hash) {
        history.replaceState({}, "", "/#");
      }
    }, splashDuration);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    initIntroSplash();
  } else {
    document.addEventListener("DOMContentLoaded", initIntroSplash);
  }

  var chatRuntimeBound = false;

  function debugOnLoad() {
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
  }

  function applyDevModeFlag() {
    fetch("/api/config", { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        if (d && document.body) {
          document.body.dataset.devMode = d.devMode ? "true" : "false";
        }
      })
      .catch(function () {});
  }

  function bootstrapChatRuntime() {
    if (chatRuntimeBound) return;
    chatRuntimeBound = true;

    applyDevModeFlag();
    debugOnLoad();

    var form = document.getElementById("form");
    if (!form) {
      console.warn("[chat] form element not found; skipping chat bootstrap.");
      return;
    }

  if (typeof ChatConfig !== "undefined" && ChatConfig.applyChatStyle) {
    ChatConfig.applyChatStyle();
  }
  if (typeof NoteFormatConfig !== "undefined" && NoteFormatConfig.applyNoteFormatToPanels) {
    NoteFormatConfig.applyNoteFormatToPanels();
  }
  EDARules.loadRules();

  if (typeof initViewportNotes === "function") {
    initViewportNotes();
  }

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
  }

  window.EDAChatBootstrap = bootstrapChatRuntime;

  /* Set dev mode flag on load so poem (and other routes) can show/hide dev-only UI */
  applyDevModeFlag();
})();
