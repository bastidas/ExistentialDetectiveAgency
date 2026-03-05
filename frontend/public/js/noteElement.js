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
  var DESTROY_ANIMATION_MS = 2000;

  var noteZIndex = 0;

  function clearActiveIndicators(region, active) {
    if (!region) return;
    var siblings = region.querySelectorAll(".note-page");
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
    var region = wrapper.parentNode;
    if (region && region.lastElementChild !== wrapper) {
      region.appendChild(wrapper);
    }
    clearActiveIndicators(region, wrapper);
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

  function enableNoteDragging(wrapper, side) {
    if (!wrapper) return;
    var activePointerId = null;
    var dragState = null;

    function endDrag(event) {
      if (activePointerId == null || event.pointerId !== activePointerId) return;
      if (wrapper.releasePointerCapture) {
        wrapper.releasePointerCapture(activePointerId);
      }
      activePointerId = null;
      dragState = null;
      wrapper.classList.remove(NOTE_DRAG_CLASS);
    }

    wrapper.addEventListener("pointerdown", function (event) {
      if (event.button && event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest(".note-page__controls")) {
        return;
      }
      var region = wrapper.parentNode;
      if (!region) return;
      var regionRect = region.getBoundingClientRect();
      var noteRect = wrapper.getBoundingClientRect();
      activePointerId = event.pointerId;
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: noteRect.left - regionRect.left,
        startTop: noteRect.top - regionRect.top,
        regionLeft: regionRect.left,
        regionTop: regionRect.top,
      };
      if (wrapper.setPointerCapture) {
        wrapper.setPointerCapture(activePointerId);
      }
      wrapper.classList.add(NOTE_DRAG_CLASS);
      bringNoteToFront(wrapper, side);
    });

    wrapper.addEventListener("pointermove", function (event) {
      if (activePointerId == null || event.pointerId !== activePointerId || !dragState) return;
      var dx = event.clientX - dragState.startX;
      var dy = event.clientY - dragState.startY;
      var nextLeft = dragState.startLeft + dx;
      var nextTop = dragState.startTop + dy;
      wrapper.style.left = nextLeft + "px";
      wrapper.style.right = "";
      wrapper.style.top = nextTop + "px";
    });

    wrapper.addEventListener("pointerup", endDrag);
    wrapper.addEventListener("pointercancel", endDrag);
    wrapper.addEventListener("lostpointercapture", function () {
      activePointerId = null;
      dragState = null;
      wrapper.classList.remove(NOTE_DRAG_CLASS);
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
    var onDestroy = callbacks && typeof callbacks.onDestroy === "function" ? callbacks.onDestroy : function () {};
    attachNoteControls(wrapper, side, onDestroy);
    enableKeyboardDeletion(wrapper, side, onDestroy);
    enableNoteDragging(wrapper, side);
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
