(function (global) {
  "use strict";

  // Chance to drop a random margin object after each user input.
  var RANDOM_OBJECT_CHANCE = 0.2;

  // Default wide random rotation range (degrees) around 0.
  // Per-object overrides come from data/object-config.json via "rotation_range".
  // With 300, this yields approximately -150deg to +150deg.
  var DEFAULT_ROTATION_RANGE_DEG = 30;

  // Approximate size (px) used for layout and rotation cadlculations.
  var ITEM_WIDTH_PX = 400;
  var ITEM_HEIGHT_PX = 400;

  // One-time objects to drop in the margins this session.
  var remainingItems = [];
  var objectConfig = {};

  // Base path for random margin objects.
  var OBJECT_BASE_PATH = "assets/imgs/misc_objects/";

  function isDevDebugMode() {
    try {
      return typeof document !== "undefined" && document.body && document.body.dataset && document.body.dataset.devMode === "true";
    } catch (e) {
      return false;
    }
  }

  function getConfigForImage(imageUrl) {
    var key;
    if (imageUrl && imageUrl.indexOf(OBJECT_BASE_PATH) === 0) {
      key = imageUrl.slice(OBJECT_BASE_PATH.length);
    } else if (imageUrl) {
      var lastSlash = imageUrl.lastIndexOf("/");
      key = lastSlash >= 0 ? imageUrl.slice(lastSlash + 1) : imageUrl;
    }
    return (key && objectConfig[key]) || {};
  }

  function getItemSizeFromConfig(config) {
    // Base size for the visual object.
    var baseWidth = ITEM_WIDTH_PX;
    var baseHeight = ITEM_HEIGHT_PX;
    if (config) {
      if (typeof config.width === "number" && config.width > 0) baseWidth = config.width;
      if (typeof config.height === "number" && config.height > 0) baseHeight = config.height;
    }

    // Visual scale applied first.
    var scale = typeof config.scale === "number" && config.scale > 0 ? config.scale : 1;
    var visualWidth = baseWidth * scale;
    var visualHeight = baseHeight * scale;

    // Optional padding fraction: how much to shrink the selectable region
    // inward on EACH side, as a fraction of the visual size.
    var paddingFrac = 0;
    if (config && typeof config.padding_frac === "number" && isFinite(config.padding_frac)) {
      paddingFrac = config.padding_frac;
      if (paddingFrac < 0) paddingFrac = 0;
      if (paddingFrac > 0.45) paddingFrac = 0.45; // avoid disappearing hit box
    }

    var hitWidth = visualWidth * (1 - 2 * paddingFrac);
    var hitHeight = visualHeight * (1 - 2 * paddingFrac);
    if (hitWidth <= 0) hitWidth = Math.max(visualWidth * 0.2, 10);
    if (hitHeight <= 0) hitHeight = Math.max(visualHeight * 0.2, 10);

    return {
      visualWidth: visualWidth,
      visualHeight: visualHeight,
      hitWidth: hitWidth,
      hitHeight: hitHeight,
      scale: scale,
      paddingFrac: paddingFrac,
    };
  }

  // Load object-config.json and populate remainingItems
  function loadObjectConfig(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "data/object-config.json", true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        try {
          objectConfig = JSON.parse(xhr.responseText);
          // Populate remainingItems with keys, using misc_objects base path.
          remainingItems = Object.keys(objectConfig).map(function (key) {
            return OBJECT_BASE_PATH + key;
          });
          if (typeof callback === "function") callback();
        } catch (err) {
          console.warn("[RandomMarginItems] Could not parse object-config.json:", err.message);
        }
      }
    };
    xhr.send();
  }

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

  function rotationForConfig(config) {
    var range = Number(config && config.rotation_range);
    if (!isFinite(range) || range <= 0) {
      range = DEFAULT_ROTATION_RANGE_DEG;
    }
    return (Math.random() * range) - range / 2;
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

    // Get config for this item from object-config.json.
    var config = getConfigForImage(imageUrl);
    var size = getItemSizeFromConfig(config);

    // Hit/bounding box uses the shrunken dimensions (after padding_frac).
    wrapper.style.width = size.hitWidth + "px";
    wrapper.style.height = size.hitHeight + "px";

    // Inner wrapper holds the visual image, which can extend outside the
    // hit box but remains non-interactive.
    var imgWrap = document.createElement("div");
    imgWrap.className = "margin-item__image-wrap";
    imgWrap.style.position = "absolute";
    imgWrap.style.width = size.visualWidth + "px";
    imgWrap.style.height = size.visualHeight + "px";
    imgWrap.style.left = ((size.hitWidth - size.visualWidth) / 2) + "px";
    imgWrap.style.top = ((size.hitHeight - size.visualHeight) / 2) + "px";
    imgWrap.style.pointerEvents = "none";

    var img = document.createElement("img");
    img.className = "margin-item__image";
    img.src = imageUrl;
    img.alt = "";
    img.loading = "lazy";
    img.draggable = false;
    img.style.pointerEvents = "none";
    img.style.width = "100%";
    img.style.height = "100%";
    imgWrap.appendChild(img);

    // Optional: add a glass lens overlay and image cut-out for objects
    // that define a transparent region in object-config.json (e.g. mglass.webp).
    var tx = Number(config && config.transparent_x);
    var ty = Number(config && config.transparent_y);
    var tr = Number(config && config.transparent_radius);
    if (isFinite(tx) && isFinite(ty) && isFinite(tr) && tr > 0) {
      wrapper.className += " margin-item--glass";

      // Express the glass center as percentages of the visual image size
      // so CSS masks can reference it. transparent_x / transparent_y are
      // in wrapper (hit-box) coordinates, so convert them into image
      // coordinates using the same centering offset as imgWrap.
      if (size.visualWidth > 0 && size.visualHeight > 0) {
        var imgOffsetX = (size.hitWidth - size.visualWidth) / 2;
        var imgOffsetY = (size.hitHeight - size.visualHeight) / 2;
        var centerXPercent = ((tx - imgOffsetX) / size.visualWidth) * 100;
        var centerYPercent = ((ty - imgOffsetY) / size.visualHeight) * 100;
        wrapper.style.setProperty("--glass-center-x", centerXPercent + "%");
        wrapper.style.setProperty("--glass-center-y", centerYPercent + "%");
        wrapper.style.setProperty("--glass-hole-radius", tr + "px");
      }

      var lens = document.createElement("div");
      lens.className = "margin-item__glass-lens";
      lens.setAttribute("aria-hidden", "true");

      var diameter = tr * 2;
      lens.style.position = "absolute";
      lens.style.left = tx - tr + "px";
      lens.style.top = ty - tr + "px";
      lens.style.width = diameter + "px";
      lens.style.height = diameter + "px";
      lens.style.pointerEvents = "none";

      wrapper.appendChild(lens);
    }

    wrapper.appendChild(imgWrap);

    // Dev-only: draw a bounding box + label with the object filename.
    if (isDevDebugMode()) {
      var debugBox = document.createElement("div");
      debugBox.className = "margin-item__debug-box";
      debugBox.setAttribute("aria-hidden", "true");
      debugBox.style.position = "absolute";
      debugBox.style.boxSizing = "border-box";
      debugBox.style.pointerEvents = "none";
      debugBox.style.border = "1px solid rgba(0, 255, 255, 0.9)";
      debugBox.style.inset = "0";

      var label = document.createElement("span");
      label.className = "margin-item__debug-label";
      label.textContent = (imageUrl && imageUrl.indexOf(OBJECT_BASE_PATH) === 0)
        ? imageUrl.slice(OBJECT_BASE_PATH.length)
        : imageUrl;
      debugBox.appendChild(label);

      wrapper.appendChild(debugBox);
    }

    // Match notes: make margin items focusable and bring-to-front capable.
    wrapper.setAttribute("role", "button");
    wrapper.setAttribute("tabindex", "0");
    wrapper.setAttribute("aria-label", "Move object");

    return wrapper;
  }

  function maybeDropRandomItemForUserInput(options) {
    if (typeof document === "undefined") return;

    // If objectConfig is empty, load it and try again after
    if (Object.keys(objectConfig).length === 0) {
      loadObjectConfig(function () {
        maybeDropRandomItemForUserInput(options);
      });
      return;
    }

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

    var config = getConfigForImage(imageUrl);
    var rotationDeg = rotationForConfig(config);
    var size = getItemSizeFromConfig(config);

    var index = layer.querySelectorAll('.note-page[data-note-side="' + side + '"], .margin-item[data-note-side="' + side + '"]').length;
    var zoneEl = notePages.getPanel(side);
    // Use same stacked placement helper as notes, but with the object's
    // hit-box dimensions (after padding_frac) so it fits the philosopher zones.
    var pos = typeof NoteLayout.stackedPositionInRegion === "function" && zoneEl
      ? NoteLayout.stackedPositionInRegion(zoneEl, side, rotationDeg, size.hitWidth, size.hitHeight, index)
      : { left: side === "left" ? 0 : undefined, right: side === "right" ? 0 : undefined, top: 0 };

    var wrapper = createMarginItemElement(side, imageUrl, pos, rotationDeg);
    var zoneOffsetLeft = pos.left != null ? pos.left : (zoneBounds.width - pos.right - size.hitWidth);
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
    loadObjectConfig: loadObjectConfig,
    getObjectConfig: function () { return objectConfig; },
  };
})(typeof window !== "undefined" ? window : this);
