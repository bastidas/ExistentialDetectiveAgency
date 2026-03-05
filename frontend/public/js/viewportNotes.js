/**
 * Viewport-based note layout: on mobile, move the single notes layer into the shared area;
 * on desktop/medium, restore the layer to app-layout. All note nodes stay in #notes-layer.
 * getPanel(side) in notePages returns the zone element (left/right content or shared content),
 * so note positions are updated via updateNotePositionsInLayer when viewport or zone changes.
 * Init order: load notePages.js before viewportNotes.js; call initViewportNotes() from app init (e.g. app.js).
 */
(function () {
  "use strict";

  var appLayoutEl = null;
  var leftContentEl = null;
  var rightContentEl = null;
  var mobileSharedContentEl = null;
  var bodyEl = null;
  var currentViewport = null;
  var viewportQueries = {
    mobile: null,
    medium: null,
  };

  function moveNotesLayerToShared() {
    var layer = document.getElementById("notes-layer");
    if (!layer || !mobileSharedContentEl) return;
    if (layer.parentNode === mobileSharedContentEl) return;
    mobileSharedContentEl.appendChild(layer);
    var notePages = typeof window !== "undefined" ? window.notePages : null;
    if (notePages && typeof notePages.updateNotePositionsInLayer === "function") {
      notePages.updateNotePositionsInLayer();
    }
  }

  function restoreNotesLayerToLayout() {
    var layer = document.getElementById("notes-layer");
    if (!layer || !appLayoutEl) return;
    if (layer.parentNode === appLayoutEl) return;
    var main = appLayoutEl.querySelector("main");
    if (main) {
      appLayoutEl.insertBefore(layer, main);
    } else {
      appLayoutEl.appendChild(layer);
    }
    var notePages = typeof window !== "undefined" ? window.notePages : null;
    if (notePages && typeof notePages.updateNotePositionsInLayer === "function") {
      notePages.updateNotePositionsInLayer();
    }
  }

  function handleViewportNotesMode(nextViewport) {
    if (!bodyEl) return;
    if (nextViewport === "mobile") {
      bodyEl.dataset.mobileNotesMode = "shared";
      moveNotesLayerToShared();
    } else {
      delete bodyEl.dataset.mobileNotesMode;
      restoreNotesLayerToLayout();
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

  function initViewportNotes() {
    bodyEl = document.body;
    appLayoutEl = document.querySelector(".app-layout");
    leftContentEl = document.getElementById("left-philosopher-content");
    rightContentEl = document.getElementById("right-philosopher-content");
    mobileSharedContentEl = document.getElementById("mobile-shared-notes-content");

    if (!bodyEl || !appLayoutEl || !leftContentEl || !rightContentEl || !mobileSharedContentEl) {
      console.warn("[viewportNotes] Required elements not found; skipping viewport/notes init.");
      return;
    }

    viewportQueries.mobile = window.matchMedia ? window.matchMedia("(max-width: 768px)") : null;
    viewportQueries.medium = window.matchMedia ? window.matchMedia("(min-width: 769px) and (max-width: 1440px)") : null;

    bindViewportListener(viewportQueries.mobile);
    bindViewportListener(viewportQueries.medium);
    syncViewportFlag();
  }

  window.initViewportNotes = initViewportNotes;
})();
