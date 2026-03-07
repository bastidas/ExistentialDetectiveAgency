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
  var layoutBreakpoints = null;

  function initLayoutBreakpoints() {
    var bp = typeof window !== "undefined" ? window.EDABreakpoints : null;
    var layout = bp && bp.LAYOUT;
    if (layout && typeof layout.MOBILE_MAX === "number" && typeof layout.MEDIUM_MIN === "number" && typeof layout.MEDIUM_MAX === "number") {
      layoutBreakpoints = {
        mobileMax: layout.MOBILE_MAX,
        mediumMin: layout.MEDIUM_MIN,
        mediumMax: layout.MEDIUM_MAX,
      };
    } else {
      // Fallback to previous hardcoded values if central config is unavailable.
      layoutBreakpoints = {
        mobileMax: 768,
        mediumMin: 769,
        mediumMax: 1440,
      };
    }
  }

  function resolveWidthBand(width) {
    var bp = typeof window !== "undefined" ? window.EDABreakpoints : null;
    var bands = bp && bp.RESPONSIVE_BANDS;
    if (bands && bands.length) {
      if (typeof width !== "number" || !isFinite(width) || width <= 0) {
        // Fallback to desktop-base if present, otherwise first band.
        for (var j = 0; j < bands.length; j++) {
          if (bands[j].mode === "desktop-base") return bands[j].mode;
        }
        return bands[0].mode;
      }
      for (var i = 0; i < bands.length; i++) {
        var band = bands[i];
        var minOk = typeof band.min === "number" ? width >= band.min : true;
        var maxOk = typeof band.max === "number" && isFinite(band.max) ? width <= band.max : true;
        if (minOk && maxOk) return band.mode;
      }
      for (var k = 0; k < bands.length; k++) {
        if (bands[k].mode === "desktop-base") return bands[k].mode;
      }
      return bands[0].mode;
    }
    return null;
  }

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
    if (!layoutBreakpoints) initLayoutBreakpoints();

    var next = "large";
    if (viewportQueries.mobile && viewportQueries.mobile.matches) {
      next = "mobile";
    } else if (viewportQueries.medium && viewportQueries.medium.matches) {
      next = "medium";
    }
    if (bodyEl.dataset.viewport !== next) {
      bodyEl.dataset.viewport = next;
    }

    var width = typeof window !== "undefined" ? window.innerWidth : null;
    var band = resolveWidthBand(width);
    if (band) {
      bodyEl.dataset.widthBand = band;
    } else {
      delete bodyEl.dataset.widthBand;
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

    if (!layoutBreakpoints) initLayoutBreakpoints();

    var mqMobile = "(max-width: " + layoutBreakpoints.mobileMax + "px)";
    var mqMedium = "(min-width: " + layoutBreakpoints.mediumMin + "px) and (max-width: " + layoutBreakpoints.mediumMax + "px)";

    viewportQueries.mobile = window.matchMedia ? window.matchMedia(mqMobile) : null;
    viewportQueries.medium = window.matchMedia ? window.matchMedia(mqMedium) : null;

    bindViewportListener(viewportQueries.mobile);
    bindViewportListener(viewportQueries.medium);
    syncViewportFlag();
  }

  window.initViewportNotes = initViewportNotes;
})();
