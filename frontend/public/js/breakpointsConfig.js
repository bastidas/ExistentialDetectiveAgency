/**
 * Central breakpoint and viewport configuration for width-based behavior.
 *
 * This is the single place to adjust the core width thresholds used by:
 * - Note scaling modes in noteFormatConfig.js
 * - Viewport layout modes in viewportNotes.js
 *
 * It does not change any CSS media queries directly, but JS logic and
 * documentation should treat these as the canonical values.
 */
(function (global) {
  "use strict";

  var existing = global.EDABreakpoints || {};

  // Core numeric thresholds (in px) for width bands.
  var BREAKPOINTS = existing.BREAKPOINTS || {
    MOBILE_XS_MAX: 480,
    MOBILE_SM_MAX: 640,
    MOBILE_MAX: 768,
    MEDIUM_MAX: 1440,
    DESKTOP_WIDE_MIN: 2000,
  };

  // Layout-focused bands. These are coarse and map to data-viewport:
  //   mobile  → 0..MOBILE_MAX
  //   medium  → MEDIUM_MIN..MEDIUM_MAX
  //   large   → LARGE_MIN..∞
  var LAYOUT = existing.LAYOUT || {
    MOBILE_MAX: BREAKPOINTS.MOBILE_MAX,
    MEDIUM_MIN: BREAKPOINTS.MOBILE_MAX + 1,
    MEDIUM_MAX: BREAKPOINTS.MEDIUM_MAX,
    LARGE_MIN: BREAKPOINTS.MEDIUM_MAX + 1,
  };

  // Unified responsive bands for note scaling and width-mode naming.
  // These cover the full width range with explicit min/max where relevant.
  // NOTE: If you change BREAKPOINTS here, also update the inline fallback
  // RESPONSIVE_BANDS in noteFormatConfig.js to keep behavior consistent
  // when EDABreakpoints is not present.
  var RESPONSIVE_BANDS = existing.RESPONSIVE_BANDS || [
    { mode: "mobile-xs",   min: 0,                                max: BREAKPOINTS.MOBILE_XS_MAX,          noteScale: 0.58, fontScale: 0.8 },
    { mode: "mobile-sm",   min: BREAKPOINTS.MOBILE_XS_MAX + 1,    max: BREAKPOINTS.MOBILE_SM_MAX,          noteScale: 0.65, fontScale: 0.85 },
    { mode: "mobile",      min: BREAKPOINTS.MOBILE_SM_MAX + 1,    max: BREAKPOINTS.MOBILE_MAX,             noteScale: 0.76, fontScale: 0.9 },
    { mode: "medium",      min: BREAKPOINTS.MOBILE_MAX + 1,       max: BREAKPOINTS.MEDIUM_MAX,             noteScale: 0.8,  fontScale: 0.9 },
    { mode: "desktop-base",min: BREAKPOINTS.MEDIUM_MAX + 1,       max: BREAKPOINTS.DESKTOP_WIDE_MIN - 1,   noteScale: 1,    fontScale: 1 },
    { mode: "desktop-wide",min: BREAKPOINTS.DESKTOP_WIDE_MIN,     max: Infinity,                           noteScale: 1.05, fontScale: 1.02 },
  ];

  global.EDABreakpoints = {
    BREAKPOINTS: BREAKPOINTS,
    LAYOUT: LAYOUT,
    RESPONSIVE_BANDS: RESPONSIVE_BANDS,
  };
})(typeof window !== "undefined" ? window : this);
