/**
 * Note DOM lifecycle: create note DOM, attach controls, drag, keyboard delete,
 * bring-to-front, destroy. No knowledge of note state (current note, usedHeight).
 * Callbacks allow notePages to react to destroy.
 */
(function (global) {
  "use strict";

  var NOTE_ACTIVE_CLASS = "note-page--active";
  var NOTE_DRAG_CLASS = "note-page--dragging";
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
   * In-region drag only; transform-origin–based so rotated notes don't jump.
   * No overlay reparent. Optional: replace with @neodrag/vanilla (ESM) when using a bundler.
   */
  function enableNoteDragging(wrapper, side, callbacks) {
    if (!wrapper) return;
    callbacks = callbacks || {};
    var activePointerId = null;
    var dragState = null;

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

    wrapper.addEventListener("pointerdown", function (event) {
      if (event.button && event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest(".note-page__controls")) {
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
    });

    wrapper.addEventListener("pointermove", function (event) {
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
      bringNoteToFront(wrapper, side);
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
    if (pos.left != null) wrapper.style.left = pos.left + "px";
    if (pos.right != null) wrapper.style.right = pos.right + "px";
    wrapper.style.top = pos.top + "px";
    wrapper.setAttribute("role", "button");
    wrapper.setAttribute("tabindex", "0");
    wrapper.setAttribute("aria-label", "Move note");

    var paperEl = document.createElement("div");
    paperEl.className = "note-page__paper";
    paperEl.style.backgroundImage = "url(" + paperUrl + ")";
    wrapper.appendChild(paperEl);

    var contentEl = document.createElement("div");
    contentEl.className = "note-page__content";
    contentEl.setAttribute("data-side", side);
    paperEl.appendChild(contentEl);

    return { wrapper: wrapper, paperEl: paperEl, contentEl: contentEl };
  }

  global.NoteElement = {
    createNoteElement: createNoteElement,
    registerNoteInteractions: registerNoteInteractions,
    bringNoteToFront: bringNoteToFront,
    destroyNoteElement: destroyNoteElement,
    clearActiveIndicators: clearActiveIndicators,
  };
})(typeof window !== "undefined" ? window : this);
