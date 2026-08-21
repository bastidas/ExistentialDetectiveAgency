/**
 * Note DOM lifecycle: create note DOM, attach controls, drag, keyboard delete,
 * bring-to-front, destroy. No knowledge of note state (current note, usedHeight).
 * Callbacks allow notePages to react to destroy.
 */
(function (global) {
  "use strict";

  var NOTE_ACTIVE_CLASS = "note-page--active";
  var NOTE_DRAG_CLASS = "note-page--dragging";
  var NOTE_HIT_HOVER_CLASS = "note-page--hit-hover";
  var NOTE_DESTROY_CLASS = "note-page--destroying";
  // Keep in sync with CSS animation duration in note-pages.css
  var DESTROY_ANIMATION_MS = 450;

  var noteZIndex = 0;
  /** When non-null, a drag is active; used to force-end on window blur/visibility so grab never stays stuck. */
  var activeDragRef = null;

  function clearActiveIndicators(container, active) {
    if (!container) return;
    var siblings = container.querySelectorAll(".note-page, .margin-item");
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i] !== active) {
        siblings[i].classList.remove(NOTE_ACTIVE_CLASS);
      }
    }
  }

  function bringNoteToFront(wrapper, side) {
    if (!wrapper) return;
    noteZIndex += 1;
    wrapper.style.zIndex = String(noteZIndex);
    var container = wrapper.parentNode;
    if (container && container.lastElementChild !== wrapper) {
      container.appendChild(wrapper);
    }
    clearActiveIndicators(container, wrapper);
    wrapper.classList.add(NOTE_ACTIVE_CLASS);
  }

  /**
   * @param {HTMLElement} wrapper
   * @param {string} side
   * @param {function()} [onAfterRemove] - called after wrapper is removed from DOM
   */
  function destroyNoteElement(wrapper, side, onAfterRemove) {
    if (!wrapper || wrapper.classList.contains(NOTE_DESTROY_CLASS)) return;
    bringNoteToFront(wrapper, side);
    wrapper.classList.add(NOTE_DESTROY_CLASS);
    setTimeout(function () {
      if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
      if (typeof onAfterRemove === "function") onAfterRemove();
    }, DESTROY_ANIMATION_MS);
  }

  function attachNoteControls(wrapper, side, onDestroy) {
    if (!wrapper || wrapper.querySelector(".note-page__controls")) return;
    var controls = document.createElement("div");
    controls.className = "note-page__controls";
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "note-page__close";
    closeBtn.setAttribute("aria-label", "Destroy note");
    closeBtn.textContent = "x";
    closeBtn.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });
    closeBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      if (typeof onDestroy === "function") onDestroy(wrapper, side);
    });
    controls.appendChild(closeBtn);
    wrapper.appendChild(controls);
  }

  function enableKeyboardDeletion(wrapper, side, onDestroy) {
    if (!wrapper) return;
    wrapper.addEventListener("keydown", function (event) {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (typeof onDestroy === "function") onDestroy(wrapper, side);
      }
    });
  }

  /**
   * Return true if a viewport-space point (clientX, clientY) lies inside the
   * logical bounding box for this note, accounting for rotation.
   * Falls back to true (no gating) if bounding metadata is missing.
   */
  function isPointInBoundingBox(wrapper, clientX, clientY) {
    if (!wrapper || !wrapper.dataset) return true;
    var bw = wrapper.dataset.boundingWidth != null ? parseFloat(wrapper.dataset.boundingWidth) : NaN;
    var bh = wrapper.dataset.boundingHeight != null ? parseFloat(wrapper.dataset.boundingHeight) : NaN;
    var boX = wrapper.dataset.boundingOffsetX != null ? parseFloat(wrapper.dataset.boundingOffsetX) : NaN;
    var boY = wrapper.dataset.boundingOffsetY != null ? parseFloat(wrapper.dataset.boundingOffsetY) : NaN;
    if (!isFinite(bw) || !isFinite(bh) || !isFinite(boX) || !isFinite(boY)) {
      return true;
    }

    var angleDeg = wrapper.dataset.rotationDeg != null ? parseFloat(wrapper.dataset.rotationDeg) : 0;
    if (!isFinite(angleDeg)) angleDeg = 0;
    var angleRad = angleDeg * Math.PI / 180;
    var cos = Math.cos(angleRad);
    var sin = Math.sin(angleRad);

    var layer = wrapper.parentNode;
    if (!layer || !layer.getBoundingClientRect) return true;
    var layerRect = layer.getBoundingClientRect();
    var originX = layerRect.left + wrapper.offsetLeft;
    var originY = layerRect.top + wrapper.offsetTop;
    if (wrapper.offsetParent !== layer) {
      var noteRect = wrapper.getBoundingClientRect();
      originX = noteRect.left;
      originY = noteRect.top;
    }

    var dx = clientX - originX;
    var dy = clientY - originY;
    // Invert rotation: map from screen space back to the note's unrotated local
    // coordinates (top-left origin).
    var localX = dx * cos + dy * sin;
    var localY = -dx * sin + dy * cos;

    return (
      localX >= boX && localX <= boX + bw &&
      localY >= boY && localY <= boY + bh
    );
  }

  /**
   * In-region drag only; transform-origin–based so rotated notes don't jump.
   * No overlay reparent. Optional: replace with @neodrag/vanilla (ESM) when using a bundler.
   */
  function enableNoteDragging(wrapper, side, callbacks) {
    if (!wrapper) return;
    callbacks = callbacks || {};
    var activePointerId = null;
    var dragState = null;

    function updateHoverState(event) {
      if (!event || !wrapper) return;
      if (event.pointerType && event.pointerType !== "mouse") {
        wrapper.classList.remove(NOTE_HIT_HOVER_CLASS);
        return;
      }
      if (activePointerId != null && event.pointerId === activePointerId && dragState) {
        wrapper.classList.remove(NOTE_HIT_HOVER_CLASS);
        return;
      }
      if (!isPointInBoundingBox(wrapper, event.clientX, event.clientY)) {
        wrapper.classList.remove(NOTE_HIT_HOVER_CLASS);
      } else {
        wrapper.classList.add(NOTE_HIT_HOVER_CLASS);
      }
    }

    function endDrag(event) {
      if (activePointerId == null || event.pointerId !== activePointerId) return;
      if (activeDragRef && activeDragRef.wrapper === wrapper) activeDragRef = null;
      if (wrapper.releasePointerCapture) {
        wrapper.releasePointerCapture(activePointerId);
      }
      activePointerId = null;
      dragState = null;
      wrapper.classList.remove(NOTE_DRAG_CLASS);
      if (typeof callbacks.onDragEnd === "function") callbacks.onDragEnd(wrapper, side);
    }

    var captureOpt = { passive: false };

    wrapper.addEventListener("pointerdown", function (event) {
      if (event.button && event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest(".note-page__controls")) {
        return;
      }
      if (!isPointInBoundingBox(wrapper, event.clientX, event.clientY)) {
        return;
      }
      if (activeDragRef && activeDragRef.wrapper !== wrapper) {
        cancelActiveDragIfAny();
      }
      if (event.preventDefault) event.preventDefault();
      var layer = wrapper.parentNode;
      if (!layer) return;
      // Use transform-origin position (not AABB) so rotated notes don't jump.
      var originX = layer.getBoundingClientRect().left + wrapper.offsetLeft;
      var originY = layer.getBoundingClientRect().top + wrapper.offsetTop;
      if (wrapper.offsetParent !== layer) {
        var noteRect = wrapper.getBoundingClientRect();
        originX = noteRect.left;
        originY = noteRect.top;
      }
      activePointerId = event.pointerId;
      dragState = {
        pointerOffsetX: event.clientX - originX,
        pointerOffsetY: event.clientY - originY,
      };
      activeDragRef = { wrapper: wrapper, pointerId: event.pointerId };
      if (wrapper.setPointerCapture) {
        wrapper.setPointerCapture(activePointerId);
      }
      wrapper.classList.add(NOTE_DRAG_CLASS);
      bringNoteToFront(wrapper, side);
    }, captureOpt);

    wrapper.addEventListener("pointermove", function (event) {
      updateHoverState(event);
      if (activePointerId == null || event.pointerId !== activePointerId || !dragState) return;
      if (event.preventDefault) event.preventDefault();
      var layer = wrapper.parentNode;
      if (!layer) return;
      var layerRect = layer.getBoundingClientRect();
      var nextLeft = event.clientX - layerRect.left - dragState.pointerOffsetX;
      var nextTop = event.clientY - layerRect.top - dragState.pointerOffsetY;
      wrapper.style.left = nextLeft + "px";
      wrapper.style.right = "";
      wrapper.style.top = nextTop + "px";
    }, captureOpt);

    wrapper.addEventListener("pointerleave", function () {
      wrapper.classList.remove(NOTE_HIT_HOVER_CLASS);
    });

    wrapper.addEventListener("pointerup", endDrag);
    wrapper.addEventListener("pointercancel", endDrag);
    wrapper.addEventListener("lostpointercapture", function () {
      if (activeDragRef && activeDragRef.wrapper === wrapper) activeDragRef = null;
      activePointerId = null;
      dragState = null;
      wrapper.classList.remove(NOTE_DRAG_CLASS);
      /* onDragEnd only from pointerup/pointercancel to avoid double persist */
    });
  }

  function cancelActiveDragIfAny() {
    if (!activeDragRef) return;
    var ref = activeDragRef;
    activeDragRef = null;
    if (!ref.wrapper.isConnected) return;
    ref.wrapper.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      cancelable: true,
      pointerId: ref.pointerId,
      pointerType: "mouse",
      isPrimary: true,
    }));
  }

  if (typeof window !== "undefined") {
    window.addEventListener("blur", cancelActiveDragIfAny);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") cancelActiveDragIfAny();
    });
  }

  /**
   * @param {HTMLElement} wrapper
   * @param {string} side
   * @param {{ onDestroy: function(HTMLElement, string) }} callbacks
   */
  function registerNoteInteractions(wrapper, side, callbacks) {
    if (!wrapper) return;
    wrapper.dataset.noteSide = side;
    callbacks = callbacks || {};
    var onDestroy = typeof callbacks.onDestroy === "function" ? callbacks.onDestroy : function () {};
    attachNoteControls(wrapper, side, onDestroy);
    enableKeyboardDeletion(wrapper, side, onDestroy);
    enableNoteDragging(wrapper, side, callbacks);
    wrapper.addEventListener("focus", function () {
      bringNoteToFront(wrapper, side);
    });
    wrapper.addEventListener("pointerdown", function (event) {
      if (event.button && event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest(".note-page__controls")) {
        return;
      }

      var layer = wrapper.parentNode;
      if (!layer || !layer.querySelectorAll) return;

      var clientX = event.clientX;
      var clientY = event.clientY;
      var nodes = layer.querySelectorAll(".note-page");
      var chosen = null;
      var bestZ = -Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var w = nodes[i];
        if (!isPointInBoundingBox(w, clientX, clientY)) continue;
        var z = parseFloat(w.style.zIndex || "0");
        if (!isFinite(z)) z = 0;
        if (z >= bestZ) {
          bestZ = z;
          chosen = w;
        }
      }
      if (!chosen) return;
      var chosenSide = chosen.dataset && chosen.dataset.noteSide ? chosen.dataset.noteSide : side;
      bringNoteToFront(chosen, chosenSide);
    });
  }

  /**
   * Create note DOM structure. Does not append to region or register interactions.
   * @param {string} side - "left" | "right"
   * @param {string} paperUrl
   * @param {{ left?: number, right?: number, top: number }} pos
   * @param {number} rotationDeg
   * @param {{ width: number, height: number }} size
   * @param {object} [options]
   * @returns {{ wrapper: HTMLElement, paperEl: HTMLElement, contentEl: HTMLElement }}
   */
  function createNoteElement(side, paperUrl, pos, rotationDeg, size, options) {
    options = options || {};
    noteZIndex += 1;
    var wrapper = document.createElement("div");
    wrapper.className = "note-page note-page--" + side;
    wrapper.dataset.paperUrl = paperUrl;
    wrapper.style.zIndex = String(noteZIndex);
    wrapper.style.transformOrigin = "top left";
    wrapper.style.setProperty("--note-rotation", rotationDeg + "deg");
    wrapper.style.transform = "rotate(" + rotationDeg + "deg)";
    wrapper.dataset.rotationDeg = String(rotationDeg);
    if (pos.left != null) wrapper.style.left = pos.left + "px";
    if (pos.right != null) wrapper.style.right = pos.right + "px";
    wrapper.style.top = pos.top + "px";
    wrapper.setAttribute("role", "button");
    wrapper.setAttribute("tabindex", "0");
    wrapper.setAttribute("aria-label", "Move note");

    var paperEl = document.createElement("div");
    paperEl.className = "note-page__paper";
    // paperUrl is the canonical ID (e.g. "paper4.webp"); map it to
    // the actual asset path under public/assets/imgs/paper.
    var paperPathBase = "assets/imgs/paper";
    var paperSrc = paperUrl;
    if (paperSrc && paperSrc.indexOf("/") === -1) {
      paperSrc = paperPathBase + "/" + paperSrc;
    }
    paperEl.style.backgroundImage = "url(" + paperSrc + ")";
    wrapper.appendChild(paperEl);

    // Dedicated hit area used for selection/drag hit-testing; sized/positioned by notePages.
    var hitEl = document.createElement("div");
    hitEl.className = "note-page__hit-area";
    hitEl.setAttribute("aria-hidden", "true");
    paperEl.appendChild(hitEl);

    var contentEl = document.createElement("div");
    contentEl.className = "note-page__content";
    contentEl.setAttribute("data-side", side);
    paperEl.appendChild(contentEl);

    return { wrapper: wrapper, paperEl: paperEl, contentEl: contentEl };
  }

  global.EDANoteElement = {
    createNoteElement: createNoteElement,
    registerNoteInteractions: registerNoteInteractions,
    bringNoteToFront: bringNoteToFront,
    destroyNoteElement: destroyNoteElement,
    clearActiveIndicators: clearActiveIndicators,
  };
})(typeof window !== "undefined" ? window : this);
