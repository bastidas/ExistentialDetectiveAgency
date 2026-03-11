/**
 * Philosopher display config: per-side fonts (userResponse, otherResponse, notes),
 * global 4-color set, base style (fontSize, color, weight, opacity), otherResponse styling, and line breaks.
 *
 * SINGLE SOURCE OF TRUTH: Philosopher font size, color, weight, and opacity are defined only here.
 * Font scaling, text padding, and areas stay in notes.formatConfig.js. CSS uses --note-* set from this config.
 * annotation.config.js derives keyword/highlight/strike from the 4-color set.
 */
(function (global) {
  "use strict";

  /**
   * Base display style per philosopher (font size, opacity, weight). Default color and fontFamily
   * come from PHILOSOPHER_COLORS.userResponse and PHILOSOPHER_FONTS.userResponse.
   */
  var PHILOSOPHER_BASE_STYLE = {
    left: {
      fontSize: "1.7rem",
      opacity: 0.75,
      fontWeight: "normal",
    },
    right: {
      fontSize: "1.18rem",
      opacity: 0.93,
      fontWeight: "normal",
    },
  };

  /**
 * otherResponse segment: only overrides (size, alpha, style). Color and font come from
 * PHILOSOPHER_COLORS.otherResponse and PHILOSOPHER_FONTS.otherResponse.
 */
  var OTHER_RESPONSE_STYLE = {
    left: {
      size: "1.8rem",
    },
    right: {
      size: "1.28rem"
    },
  };

  /** Configurable newlines after each segment type (used when building segments for the queue). */
  var LINE_BREAK_CONFIG = {
    newlinesAfterUserResponse: 2,
    newlinesAfterOtherResponse: 2,
  };

  /** Prefix for philosopher-to-philosopher segment (otherResponse). */
  var OTHER_RESPONSE_PREFIX = "[the quick brown fox jumped] ";

  /**
   * Per-side fonts by context. 4th option (and beyond) left as comments for future use.
   * Right: userResponse=Homemade Apple, otherResponse=Cedarville Cursive, notes=Dawning of a New Day (4th: La Belle Aurore).
   * Left: userResponse=Annie Use Your Telescope, otherResponse=Indie Flower, notes=Reenie Beanie (4th+: Caveat, Square Peg, Sue Ellen Francisco).
   */
  var PHILOSOPHER_FONTS = {
    left: {
      userResponse: '"Reenie Beanie", "Swanky and Moo Moo", cursive',
      otherResponse: '"Reenie Beanie", "Swanky and Moo Moo", cursive',
      notes: '"Reenie Beanie", cursive',
      // others maybe: "Annie Use Your Telescope" "Square Peg", "Sue Ellen Francisco" Fuzzy Bubbles, Coming Soon, Schoolbell, Swanky and Moo Moo
    },
    right: {
      userResponse: '"Homemade Apple", "Cedarville Cursive", cursive',
      otherResponse: '"Homemade Apple", "Cedarville Cursive", cursive',
      notes: '"Homemade Apple", "Cedarville Cursive", cursive',
      // Future: "La Belle Aurore" 
    }, 
  };

  /**
   * Global 4-color set per philosopher. Used for annotations (keyword/highlight/strike) and segment display.
   * userResponse = text to querent; altResponse = softer tone; angryResponse = emphasis/strike; otherResponse = to other philosopher.
   */
  var PHILOSOPHER_COLORS = {
    left: {
      userResponse: "rgb(50, 50, 47)", 
      altResponse: "rgba(40, 84, 58, 0.91)", 
      // altResponse: "rgba(0, 0, 0, 0.91)", 
      angryResponse: "rgba(183, 53, 6, 0.83)",
      otherResponse: "rgba(34, 29, 24, 0.94)",
    },
    right: {
      userResponse: "rgb(40, 66, 131)",
      altResponse: "rgb(22, 28, 45)",
      angryResponse: "rgba(227, 54, 38, 0.8)",
      otherResponse: "rgba(227, 54, 38, 0.8)",
    },
  };


  function getLineBreakConfig() {
    return {
      newlinesAfterUserResponse: LINE_BREAK_CONFIG.newlinesAfterUserResponse,
      newlinesAfterOtherResponse: LINE_BREAK_CONFIG.newlinesAfterOtherResponse,
    };
  }

  function getOtherResponsePrefix() {
    return OTHER_RESPONSE_PREFIX;
  }

  /**
   * Base style for a philosopher (fontSize, color, opacity, fontWeight, fontFamily).
   * Used by notes.formatConfig getNoteFormat() and when applying --note-* to panel roots.
   */
  function getPhilosopherBaseStyle(side) {
    var key = side === "right" ? "right" : "left";
    var base = PHILOSOPHER_BASE_STYLE[key] || PHILOSOPHER_BASE_STYLE.left;
    var colors = PHILOSOPHER_COLORS[key];
    var fonts = PHILOSOPHER_FONTS[key];
    return {
      fontSize: base.fontSize,
      opacity: base.opacity,
      fontWeight: base.fontWeight,
      color: colors ? colors.userResponse : undefined,
      fontFamily: fonts ? fonts.userResponse : undefined,
    };
  }

  /**
   * Get font-family for a segment type (side + responseType).
   * @param {string} side - "left" or "right"
   * @param {string} responseType - "userResponse" | "otherResponse" | "note"
   */
  function getSegmentFont(side, responseType) {
    var fonts = PHILOSOPHER_FONTS[side === "right" ? "right" : "left"];
    if (!fonts) return "cursive";
    if (responseType === "note") return fonts.notes;
    if (responseType === "otherResponse") return fonts.otherResponse;
    return fonts.userResponse;
  }

  /**
   * Get color for a segment type from the global 4-color set.
   */
  function getSegmentColor(side, responseType) {
    var colors = PHILOSOPHER_COLORS[side === "right" ? "right" : "left"];
    if (!colors) return "#333";
    if (responseType === "note") return colors.userResponse; // notes use primary by default
    if (responseType === "otherResponse") return colors.otherResponse;
    return colors.userResponse;
  }

  /**
   * Get full style for a segment (fontFamily, color, optional opacity) for inline/CSS use.
   * otherResponse uses OTHER_RESPONSE_STYLE for size/alpha; others use default note styling.
   */
  function getSegmentStyle(side, responseType) {
    var sideKey = side === "right" ? "right" : "left";
    var fontFamily = getSegmentFont(side, responseType);
    var color = getSegmentColor(side, responseType);
    var style = { fontFamily: fontFamily, color: color };
    if (responseType === "otherResponse" && OTHER_RESPONSE_STYLE[sideKey]) {
      var o = OTHER_RESPONSE_STYLE[sideKey];
      if (o.alpha != null) style.opacity = String(o.alpha);
      if (o.size) style.fontSize = o.size;
      if (o.style) style.fontStyle = o.style;
    }
    return style;
  }

  /**
   * Return annotation arrays derived from the global 4-color set (for annotation.config.js).
   */
  function getAnnotationColors(side) {
    var c = PHILOSOPHER_COLORS[side === "right" ? "right" : "left"];
    if (!c) return { keywordColors: [], highlightColors: [], strikeColors: [] };
    return {
      keywordColors: [c.userResponse],
      highlightColors: [c.userResponse, c.altResponse],
      strikeColors: [c.angryResponse, c.userResponse],
    };
  }

  /** System or generic font names we do not load from Google Fonts. */
  var SYSTEM_FONT_NAMES = {
    cursive: true,
    serif: true,
    "sans-serif": true,
    monospace: true,
    verdana: true,
    tahoma: true,
    arial: true,
    georgia: true,
    "times new roman": true,
    inherit: true,
  };

  /**
   * Extract all quoted font family names from a font-family string.
   * e.g. '"Indie Flower", cursive' -> ["Indie Flower"], '"tahoma", "Indie Flower", cursive' -> ["tahoma", "Indie Flower"].
   */
  function parseQuotedFontFamilies(str) {
    if (!str || typeof str !== "string") return [];
    var list = [];
    var s = str.trim();
    var i = 0;
    while (i < s.length) {
      var quote = s.charAt(i) === "\"" ? "\"" : s.charAt(i) === "'" ? "'" : null;
      if (!quote) {
        i++;
        continue;
      }
      var end = s.indexOf(quote, i + 1);
      if (end === -1) break;
      var name = s.slice(i + 1, end).trim();
      if (name) list.push(name);
      i = end + 1;
    }
    return list;
  }

  /**
   * Collect unique Google Font family names from PHILOSOPHER_FONTS (exclude system fonts).
   * Returns array of display names (e.g. "Cedarville Cursive"). Parses all quoted names in each value.
   */
  function getPhilosopherFontNamesToLoad() {
    var seen = {};
    var list = [];
    var sides = ["left", "right"];
    for (var s = 0; s < sides.length; s++) {
      var fonts = PHILOSOPHER_FONTS[sides[s]];
      if (!fonts) continue;
      ["userResponse", "otherResponse", "notes"].forEach(function (key) {
        var raw = fonts[key];
        if (!raw) return;
        var names = parseQuotedFontFamilies(raw);
        names.forEach(function (name) {
          var lower = name.toLowerCase();
          if (SYSTEM_FONT_NAMES[lower]) return;
          if (!seen[lower]) {
            seen[lower] = true;
            list.push(name);
          }
        });
      });
    }
    return list;
  }

  /**
   * Load philosopher fonts from Google Fonts when the page loads. Injects a <link> into document.head
   * so all fonts in PHILOSOPHER_FONTS (except system fonts) are available.
   */
  function loadPhilosopherFonts() {
    if (typeof document === "undefined" || !document.head) return;
    var names = getPhilosopherFontNamesToLoad();
    if (!names.length) return;
    var familyParams = names.map(function (name) {
      return "family=" + encodeURIComponent(name).replace(/%20/g, "+");
    }).join("&");
    var href = "https://fonts.googleapis.com/css2?" + familyParams + "&display=swap";
    var existing = document.querySelector("link[data-philosopher-fonts=\"true\"]");
    if (existing) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-philosopher-fonts", "true");
    document.head.appendChild(link);
  }

  /**
   * Apply philosopher display config as CSS custom properties on panel roots (#left-philosopher, #right-philosopher):
   * base (fontSize, color, opacity, fontWeight, fontFamily) and segment fonts/colors.
   */
  function applyDisplayConfigToPanels() {
    if (typeof document === "undefined") return;
    var leftEl = document.getElementById("left-philosopher");
    var rightEl = document.getElementById("right-philosopher");
    ["left", "right"].forEach(function (side) {
      var el = side === "left" ? leftEl : rightEl;
      if (!el) return;
      var base = getPhilosopherBaseStyle(side);
      if (base.fontSize != null) el.style.setProperty("--note-fontSize", base.fontSize);
      if (base.color != null) el.style.setProperty("--note-color", base.color);
      if (base.opacity != null) el.style.setProperty("--note-opacity", String(base.opacity));
      if (base.fontWeight != null) el.style.setProperty("--note-fontWeight", base.fontWeight);
      if (base.fontFamily != null) el.style.setProperty("--note-fontFamily", base.fontFamily);
      var fonts = PHILOSOPHER_FONTS[side];
      var colors = PHILOSOPHER_COLORS[side];
      if (fonts) {
        el.style.setProperty("--note-fontFamily-userResponse", fonts.userResponse);
        el.style.setProperty("--note-fontFamily-otherResponse", fonts.otherResponse);
        el.style.setProperty("--note-fontFamily-notes", fonts.notes);
      }
      if (colors) {
        el.style.setProperty("--note-color-userResponse", colors.userResponse);
        el.style.setProperty("--note-color-otherResponse", colors.otherResponse);
        el.style.setProperty("--note-color-notes", colors.userResponse);
      }
    });
  }

  global.EDAPhilosopherDisplayConfig = {
    getLineBreakConfig: getLineBreakConfig,
    getOtherResponsePrefix: getOtherResponsePrefix,
    getPhilosopherBaseStyle: getPhilosopherBaseStyle,
    getSegmentFont: getSegmentFont,
    getSegmentColor: getSegmentColor,
    getSegmentStyle: getSegmentStyle,
    getAnnotationColors: getAnnotationColors,
    applyDisplayConfigToPanels: applyDisplayConfigToPanels,
    loadPhilosopherFonts: loadPhilosopherFonts,
    getPhilosopherFontNamesToLoad: getPhilosopherFontNamesToLoad,
    PHILOSOPHER_BASE_STYLE: PHILOSOPHER_BASE_STYLE,
    PHILOSOPHER_FONTS: PHILOSOPHER_FONTS,
    PHILOSOPHER_COLORS: PHILOSOPHER_COLORS,
    LINE_BREAK_CONFIG: LINE_BREAK_CONFIG,
  };

  if (typeof document !== "undefined" && document.head) {
    loadPhilosopherFonts();
  }
})(typeof window !== "undefined" ? window : this);
