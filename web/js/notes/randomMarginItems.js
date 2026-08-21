(function (global) {
  "use strict";

  // Chance to drop a random margin object after each user input.
  var RANDOM_OBJECT_CHANCE = 0.17;

  // Chance to drop a baseline (attaché) margin object after each user input.
  var ATTACHE_RANDOM_PAPERS_CHANCE = 0.3;

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

  // Current mode for margin items: "normal" (classic) or "baseline".
  var currentMode = "normal";

  // Base path for random margin objects.
  var OBJECT_BASE_PATH = "assets/imgs/misc_objects/";

  function getImageUrlForKey(key) {
    if (!key) return "";
    var cfg = objectConfig && objectConfig[key] ? objectConfig[key] : null;
    var basePath = cfg && typeof cfg.base_path === "string" && cfg.base_path
      ? cfg.base_path
      : OBJECT_BASE_PATH;
    return basePath + key;
  }

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

    // Visual scale: per-object scale * responsive note scale (same as notes).
    var scale = typeof config.scale === "number" && config.scale > 0 ? config.scale : 1;
    var responsiveScale = 1;
    if (noteFormatConfig && typeof noteFormatConfig.getResponsiveNoteScale === "function") {
      responsiveScale = noteFormatConfig.getResponsiveNoteScale();
    }
    var visualWidth = baseWidth * scale * responsiveScale;
    var visualHeight = baseHeight * scale * responsiveScale;

    // Logical bounding box: centered fraction of the visual size, like papers.
    var bx = config && typeof config.bounding_x_frac === "number" ? config.bounding_x_frac : 1;
    var by = config && typeof config.bounding_y_frac === "number" ? config.bounding_y_frac : 1;
    if (!(bx > 0)) bx = 1;
    if (!(by > 0)) by = 1;
    if (bx > 1) bx = 1;
    if (by > 1) by = 1;
    var boundingWidth = visualWidth * bx;
    var boundingHeight = visualHeight * by;
    if (!(boundingWidth > 0)) boundingWidth = visualWidth;
    if (!(boundingHeight > 0)) boundingHeight = visualHeight;

    // Bounding box is the wrapper; offsets are 0 in wrapper coordinates.
    var offsetX = 0;
    var offsetY = 0;

    return {
      visualWidth: visualWidth,
      visualHeight: visualHeight,
      boundingWidth: boundingWidth,
      boundingHeight: boundingHeight,
      offsetX: offsetX,
      offsetY: offsetY,
      scale: scale,
    };
  }

  // Load object-config.json and populate remainingItems
  function loadObjectConfig(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "data/object-config.json", true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        try {
          objectConfig = JSON.parse(xhr.responseText) || {};
          // Populate remainingItems with config keys; actual image URLs are
          // derived later so different types can live in different folders.
          remainingItems = Object.keys(objectConfig);
          if (typeof callback === "function") callback();
        } catch (err) {
          console.warn("[RandomMarginItems] Could not parse object-config.json:", err.message);
        }
      }
    };
    xhr.send();
  }

  var EDANoteLayout = global.EDANoteLayout;
  var EDANoteElement = global.EDANoteElement;
  var noteFormatConfig = global.EDANoteFormatConfig || null;

  function hasRemainingItems() {
    return remainingItems.length > 0;
  }

  function getAllowedTypesForCurrentMode() {
    if (currentMode === "baseline") return ["baseline"];
    // Classic behavior: drop everything except baseline-only objects.
    return ["misc", "special"];
  }

  function consumeRandomItemForCurrentMode() {
    if (!remainingItems.length) return null;
    var allowedTypes = getAllowedTypesForCurrentMode();
    var attempts = 0;
    var maxAttempts = remainingItems.length;
    while (attempts < maxAttempts) {
      var index = Math.floor(Math.random() * remainingItems.length);
      var key = remainingItems[index];
      var cfg = objectConfig && objectConfig[key] ? objectConfig[key] : {};
      var type = cfg && typeof cfg.type === "string" ? cfg.type : "misc";
      var isAllowed = !allowedTypes || allowedTypes.indexOf(type) !== -1;
      if (isAllowed) {
        remainingItems.splice(index, 1);
        return key;
      }
      attempts++;
    }
    return null;
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
    wrapper.dataset.rotationDeg = String(rotationDeg);
    if (pos.left != null) wrapper.style.left = pos.left + "px";
    if (pos.right != null) wrapper.style.right = pos.right + "px";
    wrapper.style.top = pos.top + "px";

    // Get config for this item from object-config.json.
    var config = getConfigForImage(imageUrl);
    var size = getItemSizeFromConfig(config);

    // Wrapper size matches the logical bounding box.
    wrapper.style.width = size.boundingWidth + "px";
    wrapper.style.height = size.boundingHeight + "px";
    wrapper.dataset.boundingWidth = String(size.boundingWidth);
    wrapper.dataset.boundingHeight = String(size.boundingHeight);
    wrapper.dataset.boundingOffsetX = String(size.offsetX);
    wrapper.dataset.boundingOffsetY = String(size.offsetY);

    // Inner wrapper holds the visual image, which can extend outside the
    // hit box but remains non-interactive.
    var imgWrap = document.createElement("div");
    imgWrap.className = "margin-item__image-wrap";
    imgWrap.style.position = "absolute";
    imgWrap.style.width = size.visualWidth + "px";
    imgWrap.style.height = size.visualHeight + "px";
    imgWrap.style.left = ((size.boundingWidth - size.visualWidth) / 2) + "px";
    imgWrap.style.top = ((size.boundingHeight - size.visualHeight) / 2) + "px";
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
      if (imageUrl) {
        var lastSlash = imageUrl.lastIndexOf("/");
        label.textContent = lastSlash >= 0 ? imageUrl.slice(lastSlash + 1) : imageUrl;
      } else {
        label.textContent = "";
      }
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

    var dropChance = currentMode === "baseline" ? ATTACHE_RANDOM_PAPERS_CHANCE : RANDOM_OBJECT_CHANCE;
    if (Math.random() >= dropChance) return;

    var notePages = global.EDANotePages;
    if (!notePages || !EDANoteLayout) return;
    if (typeof EDANotePages.getOrCreateNotesLayer !== "function") return;

    var side = pickSide(opts.side);
    var layer = EDANotePages.getOrCreateNotesLayer();
    var zoneBounds = EDANotePages.getZoneBoundsInLayer && EDANotePages.getZoneBoundsInLayer(side);
    if (!layer || !zoneBounds) return;

    var itemKey = consumeRandomItemForCurrentMode();
    if (!itemKey) return;

    var imageUrl = getImageUrlForKey(itemKey);
    var config = objectConfig[itemKey] || getConfigForImage(imageUrl);
    var rotationDeg = rotationForConfig(config);
    var size = getItemSizeFromConfig(config);

    var index = layer.querySelectorAll('.note-page[data-note-side="' + side + '"], .margin-item[data-note-side="' + side + '"]').length;
    var zoneEl = EDANotePages.getPanel(side);
    // Use same placement as notes: stacked in zone and, when applicable, anchored near last user message.
    var pos;
    if (zoneEl && typeof EDANotePages.getPositionInZone === "function") {
      var bounding = { offsetX: size.offsetX || 0, offsetY: size.offsetY || 0, width: size.boundingWidth, height: size.boundingHeight };
      pos = EDANotePages.getPositionInZone(zoneEl, side, rotationDeg, bounding, size.visualWidth, size.visualHeight, index);
    } else if (typeof EDANoteLayout.stackedPositionInRegion === "function" && zoneEl) {
      pos = EDANoteLayout.stackedPositionInRegion(zoneEl, side, rotationDeg, size.boundingWidth, size.boundingHeight, index);
    } else {
      pos = { left: side === "left" ? 0 : undefined, right: side === "right" ? 0 : undefined, top: 0 };
    }

    var wrapper = createMarginItemElement(side, imageUrl, pos, rotationDeg);
    var wrapperW = size.visualWidth;
    var zoneOffsetLeft = pos.left != null ? pos.left : (zoneBounds.width - pos.right - wrapperW);
    var zoneOffsetTop = pos.top;
    wrapper.style.left = (zoneBounds.left + zoneOffsetLeft) + "px";
    wrapper.style.right = "";
    wrapper.style.top = (zoneBounds.top + zoneOffsetTop) + "px";
    wrapper.dataset.zoneOffsetLeft = String(zoneOffsetLeft);
    wrapper.dataset.zoneOffsetTop = String(zoneOffsetTop);

    layer.appendChild(wrapper);
    if (EDANoteElement && typeof EDANoteElement.bringNoteToFront === "function") {
      EDANoteElement.bringNoteToFront(wrapper, side);
    }
    if (notePages && typeof EDANotePages.addEntranceAnimation === "function") {
      EDANotePages.addEntranceAnimation(wrapper);
    }

    if (EDANoteElement && typeof EDANoteElement.registerNoteInteractions === "function") {
      EDANoteElement.registerNoteInteractions(wrapper, side, {
        onDestroy: function (w, s) {
          if (EDANoteElement && typeof EDANoteElement.destroyNoteElement === "function") {
            EDANoteElement.destroyNoteElement(w, s);
          } else if (w && w.parentNode) {
            w.parentNode.removeChild(w);
          }
        },
        onDragEnd: function (w, s) {
          var zone = EDANotePages.getZoneBoundsInLayer && EDANotePages.getZoneBoundsInLayer(s);
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

  function setMode(mode) {
    if (mode === "baseline") currentMode = "baseline";
    else currentMode = "normal";
  }

  function getMode() {
    return currentMode;
  }

  global.EDARandomMarginItems = {
    RANDOM_OBJECT_CHANCE: RANDOM_OBJECT_CHANCE,
    ATTACHE_RANDOM_PAPERS_CHANCE: ATTACHE_RANDOM_PAPERS_CHANCE,
    maybeDropRandomItemForUserInput: maybeDropRandomItemForUserInput,
    loadObjectConfig: loadObjectConfig,
    getObjectConfig: function () { return objectConfig; },
    setMode: setMode,
    getMode: getMode,
  };
})(typeof window !== "undefined" ? window : this);
