(function () {
  "use strict";

  var leftContentEl = null;
  var rightContentEl = null;
  var mobileSharedContentEl = null;
  var bodyEl = null;
  var currentViewport = null;
  var viewportQueries = {
    mobile: null,
    medium: null,
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

  function initViewportNotes() {
    bodyEl = document.body;
    leftContentEl = document.getElementById("left-philosopher-content");
    rightContentEl = document.getElementById("right-philosopher-content");
    mobileSharedContentEl = document.getElementById("mobile-shared-notes-content");

    if (!bodyEl || !leftContentEl || !rightContentEl || !mobileSharedContentEl) {
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
