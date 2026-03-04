(function (global) {
  "use strict";

  var cfg = global.NoteFormatConfig || null;
  var capacityCache = Object.create(null);

  function getScaleSignature() {
    if (cfg && typeof cfg.getResponsiveNoteScale === "function") {
      var scale = cfg.getResponsiveNoteScale();
      return Number(scale || 1).toFixed(3);
    }
    return "1.000";
  }

  function cacheKey(paperUrl, side) {
    return [side || "left", paperUrl || "unknown", getScaleSignature()].join("::");
  }

  function getLineHeightPx(side) {
    if (cfg) {
      if (typeof cfg.getEstimatedLineHeightPx === "function") {
        return cfg.getEstimatedLineHeightPx(side);
      }
      var fallback = cfg.ESTIMATE_LINE_HEIGHT_PX || {};
      if (typeof fallback[side] === "number" && fallback[side] > 0) {
        return fallback[side];
      }
      if (typeof fallback.left === "number" && fallback.left > 0) {
        return fallback.left;
      }
    }
    return 32;
  }

  function getCharsPerLine(paperUrl, side) {
    if (cfg) {
      if (typeof cfg.estimateCharsPerLineForPaper === "function") {
        return cfg.estimateCharsPerLineForPaper(paperUrl, side);
      }
      if (typeof cfg.getEstimateCharsPerLine === "function") {
        return cfg.getEstimateCharsPerLine(side);
      }
    }
    return 80;
  }

  function getWritableArea(paperUrl, side) {
    if (cfg && typeof cfg.getWritableAreaSize === "function") {
      return cfg.getWritableAreaSize(paperUrl, side);
    }
    if (cfg && typeof cfg.getPaperSize === "function") {
      var size = cfg.getPaperSize(paperUrl);
      return { width: size.width, height: size.height };
    }
    return { width: 440, height: 560 };
  }

  function computeCapacity(paperUrl, side) {
    var key = cacheKey(paperUrl, side);
    if (capacityCache[key]) return capacityCache[key];
    var writable = getWritableArea(paperUrl, side);
    var lineHeight = getLineHeightPx(side);
    if (!lineHeight || lineHeight <= 0) lineHeight = 32;
    var charsPerLine = getCharsPerLine(paperUrl, side);
    if (!charsPerLine || charsPerLine <= 0) charsPerLine = 40;
    var lines = Math.max(1, Math.floor(writable.height / lineHeight));
    var capacity = lines * charsPerLine;
    var entry = {
      paperUrl: paperUrl,
      side: side,
      capacity: capacity,
      lines: lines,
      charsPerLine: charsPerLine,
      writable: writable,
      lineHeightPx: lineHeight,
    };
    capacityCache[key] = entry;
    return entry;
  }

  function getAllCapacities(side) {
    if (!cfg || typeof cfg.getPaperImages !== "function") return [];
    var papers = cfg.getPaperImages();
    if (!papers || !papers.length) return [];
    var list = [];
    for (var i = 0; i < papers.length; i++) {
      list.push(computeCapacity(papers[i], side));
    }
    return list;
  }

  function invalidate() {
    capacityCache = Object.create(null);
  }

  global.NoteCapacity = {
    getCapacity: computeCapacity,
    getAllCapacities: getAllCapacities,
    invalidate: invalidate,
  };
})(typeof window !== "undefined" ? window : this);
