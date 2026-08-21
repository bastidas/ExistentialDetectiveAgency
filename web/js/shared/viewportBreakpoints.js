/**
 * Central breakpoint and viewport configuration for width-based behavior.
 *
 * SINGLE SOURCE OF TRUTH for responsive bands (RESPONSIVE_BANDS). Other files
 * (e.g. notes.formatConfig.js) must use EDABreakpoints.RESPONSIVE_BANDS only;
 * they must not define their own band values. A fallback in consumers is only
 * for when this script is not loaded and must not be edited.
 *
 * This is the single place to adjust:
 * - BREAKPOINTS (width thresholds)
 * - RESPONSIVE_BANDS (noteScale, fontScale by viewport width)
 *
 * Used by: notes.formatConfig.js (note scaling), viewportNotes.js (layout modes).
 * It does not change any CSS media queries directly.
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
  //   large   → LARGE_MIN..inf
  var LAYOUT = existing.LAYOUT || {
    MOBILE_MAX: BREAKPOINTS.MOBILE_MAX,
    MEDIUM_MIN: BREAKPOINTS.MOBILE_MAX + 1,
    MEDIUM_MAX: BREAKPOINTS.MEDIUM_MAX,
    LARGE_MIN: BREAKPOINTS.MEDIUM_MAX + 1,
  };

  // Unified responsive bands for note scaling and width-mode naming.
  // EDIT HERE ONLY. Other files import via EDABreakpoints.RESPONSIVE_BANDS.
  // fontScale multiplies note/otherResponse base sizes. Use 1 for desktop so philosopherDisplay sizes apply as-is (matches notedebug when it doesn't load this script).
  var RESPONSIVE_BANDS = existing.RESPONSIVE_BANDS || [
    { mode: "mobile-xs",   min: 0,                                max: BREAKPOINTS.MOBILE_XS_MAX,          noteScale: 0.58, fontScale: 0.8 },
    { mode: "mobile-sm",   min: BREAKPOINTS.MOBILE_XS_MAX + 1,    max: BREAKPOINTS.MOBILE_SM_MAX,          noteScale: 0.65, fontScale: 0.85 },
    { mode: "mobile",      min: BREAKPOINTS.MOBILE_SM_MAX + 1,    max: BREAKPOINTS.MOBILE_MAX,             noteScale: 0.76, fontScale: 0.9 },
    { mode: "medium",      min: BREAKPOINTS.MOBILE_MAX + 1,       max: BREAKPOINTS.MEDIUM_MAX,             noteScale: 0.8,  fontScale: 0.9 },
    { mode: "desktop-base",min: BREAKPOINTS.MEDIUM_MAX + 1,       max: BREAKPOINTS.DESKTOP_WIDE_MIN - 1,   noteScale: 1,    fontScale: 1.0 },
    { mode: "desktop-wide",min: BREAKPOINTS.DESKTOP_WIDE_MIN,     max: Infinity,                           noteScale: 1.05, fontScale: 1.05 },
  ];

  global.EDABreakpoints = {
    BREAKPOINTS: BREAKPOINTS,
    LAYOUT: LAYOUT,
    RESPONSIVE_BANDS: RESPONSIVE_BANDS,
  };
})(typeof window !== "undefined" ? window : this);
