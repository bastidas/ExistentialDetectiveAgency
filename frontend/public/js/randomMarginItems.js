(function (global) {
  "use strict";

  // Chance to drop a random margin object after each user input.
  var RANDOM_OBJECT_CHANCE = 0.5;

  // Wide random rotation range (degrees) around 0.
  // With 300, this yields approximately -150deg to +150deg.
  var ROTATION_RANGE_DEG = 300;

  // Approximate size (px) used for layout and rotation calculations.
  var ITEM_WIDTH_PX = 140;
  var ITEM_HEIGHT_PX = 140;

  // One-time objects to drop in the margins this session.
  var remainingItems = [
    "imgs/chess_piece.webp",
    "imgs/napkin.webp",
  ];

  var NoteLayout = global.NoteLayout;
  var NoteElement = global.NoteElement;

  function hasRemainingItems() {
    return remainingItems.length > 0;
  }

  function consumeRandomItem() {
    if (!remainingItems.length) return null;
    var index = Math.floor(Math.random() * remainingItems.length);
    var item = remainingItems[index];
    remainingItems.splice(index, 1);
    return item;
  }

  function pickSide(hint) {
    if (hint === "left" || hint === "right") return hint;
    return Math.random() < 0.5 ? "left" : "right";
  }

  function randomRotationDegWide() {
    return (Math.random() * ROTATION_RANGE_DEG) - ROTATION_RANGE_DEG / 2;
  }

  function createMarginItemElement(side, imageUrl, pos, rotationDeg) {
    var wrapper = document.createElement("div");
    wrapper.className = "margin-item margin-item--" + side;
    wrapper.dataset.noteSide = side;
    wrapper.style.position = "absolute";
    wrapper.style.transformOrigin = "top left";
    wrapper.style.setProperty("--note-rotation", rotationDeg + "deg");
    wrapper.style.transform = "rotate(" + rotationDeg + "deg)";
    if (pos.left != null) wrapper.style.left = pos.left + "px";
    if (pos.right != null) wrapper.style.right = pos.right + "px";
    wrapper.style.top = pos.top + "px";
    wrapper.style.width = ITEM_WIDTH_PX + "px";
    wrapper.style.height = ITEM_HEIGHT_PX + "px";

    var img = document.createElement("img");
    img.className = "margin-item__image";
    img.src = imageUrl;
    img.alt = "";
    img.loading = "lazy";
    img.draggable = false;
    wrapper.appendChild(img);

    return wrapper;
  }

  function maybeDropRandomItemForUserInput(options) {
    if (typeof document === "undefined") return;

    var opts = options || {};

    if (!hasRemainingItems()) return;
    if (Math.random() >= RANDOM_OBJECT_CHANCE) return;

    var notePages = global.notePages;
    if (!notePages || !NoteLayout) return;
    if (typeof notePages.getOrCreateNotesLayer !== "function") return;

    var side = pickSide(opts.side);
    var layer = notePages.getOrCreateNotesLayer();
    var zoneBounds = notePages.getZoneBoundsInLayer && notePages.getZoneBoundsInLayer(side);
    if (!layer || !zoneBounds) return;

    var imageUrl = consumeRandomItem();
    if (!imageUrl) return;

    var rotationDeg = randomRotationDegWide();

    var index = layer.querySelectorAll('.note-page[data-note-side="' + side + '"], .margin-item[data-note-side="' + side + '"]').length;
    var zoneEl = notePages.getPanel(side);
    var pos = typeof NoteLayout.stackedPositionInRegion === "function" && zoneEl
      ? NoteLayout.stackedPositionInRegion(zoneEl, side, rotationDeg, ITEM_WIDTH_PX, ITEM_HEIGHT_PX, index)
      : { left: side === "left" ? 0 : undefined, right: side === "right" ? 0 : undefined, top: 0 };

    var wrapper = createMarginItemElement(side, imageUrl, pos, rotationDeg);
    var zoneOffsetLeft = pos.left != null ? pos.left : (zoneBounds.width - pos.right - ITEM_WIDTH_PX);
    var zoneOffsetTop = pos.top;
    wrapper.style.left = (zoneBounds.left + zoneOffsetLeft) + "px";
    wrapper.style.right = "";
    wrapper.style.top = (zoneBounds.top + zoneOffsetTop) + "px";
    wrapper.dataset.zoneOffsetLeft = String(zoneOffsetLeft);
    wrapper.dataset.zoneOffsetTop = String(zoneOffsetTop);

    layer.appendChild(wrapper);
    if (notePages && typeof notePages.addEntranceAnimation === "function") {
      notePages.addEntranceAnimation(wrapper);
    }

    if (NoteElement && typeof NoteElement.registerNoteInteractions === "function") {
      NoteElement.registerNoteInteractions(wrapper, side, {
        onDestroy: function (w, s) {
          if (NoteElement && typeof NoteElement.destroyNoteElement === "function") {
            NoteElement.destroyNoteElement(w, s);
          } else if (w && w.parentNode) {
            w.parentNode.removeChild(w);
          }
        },
        onDragEnd: function (w, s) {
          var zone = notePages.getZoneBoundsInLayer && notePages.getZoneBoundsInLayer(s);
          if (!zone) return;
          var left = parseFloat(w.style.left, 10);
          var top = parseFloat(w.style.top, 10);
          if (!isNaN(left) && !isNaN(top)) {
            w.dataset.zoneOffsetLeft = String(left - zone.left);
            w.dataset.zoneOffsetTop = String(top - zone.top);
          }
        },
      });
    }
  }

  global.EDARandomMarginItems = {
    RANDOM_OBJECT_CHANCE: RANDOM_OBJECT_CHANCE,
    maybeDropRandomItemForUserInput: maybeDropRandomItemForUserInput,
  };
})(typeof window !== "undefined" ? window : this);
