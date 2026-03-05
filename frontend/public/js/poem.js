(function () {
  "use strict";

  var STORAGE_KEY = "existential-detective-effect-prefs";

  var SELECTED_EFFECTS = [
    { name: "fade-in-bottom", duration: "0.6s", timing: "cubic-bezier(0.39, 0.575, 0.565, 1)", category: "Fade" },
    { name: "fade-in-bck", duration: "0.6s", timing: "cubic-bezier(0.39, 0.575, 0.565, 1)", category: "Fade" },
    { name: "flip-in-hor-top", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Flip" },
    { name: "flip-in-ver-right", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Flip" },
    { name: "flip-in-hor-bottom", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Flip" },
    { name: "roll-in-right", duration: "0.6s", timing: "ease-out", category: "Roll" },
    { name: "rotate-in-2-ccw", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Rotate" },
    { name: "rotate-in-top", duration: "0.6s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Rotate" },
    { name: "scale-in-center", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Scale" },
    { name: "scale-in-bottom", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Scale" },
    { name: "scale-in-hor-center", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Scale" },
    { name: "scale-in-ver-center", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Scale" },
    { name: "slide-in-top", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Slide" },
    { name: "slide-in-bottom", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Slide" },
    { name: "slide-in-blurred-top", duration: "0.6s", timing: "cubic-bezier(0.23, 1, 0.32, 1)", category: "Slide" },
    { name: "slide-in-blurred-right", duration: "0.6s", timing: "cubic-bezier(0.23, 1, 0.32, 1)", category: "Slide" },
    { name: "slide-in-blurred-bottom", duration: "0.6s", timing: "cubic-bezier(0.23, 1, 0.32, 1)", category: "Slide" },
    { name: "swing-in-left-fwd", duration: "0.5s", timing: "cubic-bezier(0.175, 0.885, 0.32, 1.275)", category: "Swing" },
    { name: "puff-in-center", duration: "0.7s", timing: "cubic-bezier(0.47, 0, 0.745, 0.715)", category: "Puff" },
    { name: "puff-in-top", duration: "0.7s", timing: "cubic-bezier(0.47, 0, 0.745, 0.715)", category: "Puff" },
    { name: "puff-in-bottom", duration: "0.7s", timing: "cubic-bezier(0.47, 0, 0.745, 0.715)", category: "Puff" },
    { name: "puff-in-hor", duration: "0.7s", timing: "cubic-bezier(0.47, 0, 0.745, 0.715)", category: "Puff" },
    { name: "puff-in-ver", duration: "0.7s", timing: "cubic-bezier(0.47, 0, 0.745, 0.715)", category: "Puff" },
    { name: "bounce-in-fwd", duration: "1.1s", timing: "ease", category: "Bounce" },
    { name: "bounce-in-bck", duration: "1.1s", timing: "ease", category: "Bounce" },
    { name: "text-focus-in", duration: "1s", timing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)", category: "Text" },
    { name: "text-flicker-in-glow", duration: "1.5s", timing: "linear", category: "Text" },
    { name: "tracking-in-contract", duration: "0.8s", timing: "cubic-bezier(0.215, 0.61, 0.355, 1)", category: "Text" },
    { name: "tracking-in-expand", duration: "0.7s", timing: "cubic-bezier(0.215, 0.61, 0.355, 1)", category: "Text" },
    { name: "tracking-in-expand-fwd", duration: "0.8s", timing: "cubic-bezier(0.215, 0.61, 0.355, 1)", category: "Text" },
    { name: "tracking-in-contract-bck", duration: "1s", timing: "cubic-bezier(0.215, 0.61, 0.355, 1)", category: "Text" },
    { name: "blink-1", duration: "0.6s", timing: "linear", category: "Blink" },
    { name: "blink-2", duration: "0.9s", timing: "linear", category: "Blink" },
    { name: "flicker-3", duration: "1.5s", timing: "linear", category: "Flicker" },
    { name: "flicker-2", duration: "3s", timing: "linear", category: "Flicker" },
    { name: "jello-horizontal", duration: "0.9s", timing: "ease", category: "Jello" },
    { name: "pulsate-fwd", duration: "0.5s", timing: "ease-in-out", category: "Pulsate" },
    { name: "pulsate-bck", duration: "0.5s", timing: "ease-in-out", category: "Pulsate" },
    { name: "bounce-top", duration: "0.9s", timing: "ease", category: "Bounce Attention" },
    { name: "bounce-right", duration: "1.1s", timing: "ease", category: "Bounce Attention" },
    { name: "shake-horizontal", duration: "0.8s", timing: "cubic-bezier(0.455, 0.03, 0.515, 0.955)", category: "Shake" },
    { name: "shake-vertical", duration: "0.8s", timing: "cubic-bezier(0.455, 0.03, 0.515, 0.955)", category: "Shake" },
    { name: "vibrate-1", duration: "0.3s", timing: "linear", category: "Vibrate" },
    { name: "vibrate-3", duration: "0.5s", timing: "linear", category: "Vibrate" },
    { name: "vibrate-2", duration: "0.5s", timing: "linear", category: "Vibrate" },
    { name: "text-blur-out", duration: "1.2s", timing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)", category: "Text" },
  ];

  var OUTRO_EFFECTS = [
    { name: "fade-out-bottom", duration: "0.6s", timing: "cubic-bezier(0.39, 0.575, 0.565, 1)", category: "Fade" },
    { name: "fade-out-bck", duration: "0.6s", timing: "cubic-bezier(0.39, 0.575, 0.565, 1)", category: "Fade" },
    { name: "flip-out-hor-top", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Flip" },
    { name: "flip-out-ver-right", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Flip" },
    { name: "flip-out-hor-bottom", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Flip" },
    { name: "roll-out-right", duration: "0.6s", timing: "ease-out", category: "Roll" },
    { name: "rotate-out-2-cw", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Rotate" },
    { name: "rotate-out-top", duration: "0.6s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Rotate" },
    { name: "scale-out-center", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Scale" },
    { name: "scale-out-bottom", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Scale" },
    { name: "scale-out-hor-center", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Scale" },
    { name: "scale-out-ver-center", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Scale" },
    { name: "slide-out-top", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Slide" },
    { name: "slide-out-bottom", duration: "0.5s", timing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", category: "Slide" },
    { name: "slide-out-blurred-top", duration: "0.6s", timing: "cubic-bezier(0.755, 0.05, 0.855, 0.06)", category: "Slide" },
    { name: "slide-out-blurred-right", duration: "0.6s", timing: "cubic-bezier(0.755, 0.05, 0.855, 0.06)", category: "Slide" },
    { name: "slide-out-blurred-bottom", duration: "0.6s", timing: "cubic-bezier(0.755, 0.05, 0.855, 0.06)", category: "Slide" },
    { name: "swing-out-left-fwd", duration: "0.5s", timing: "cubic-bezier(0.6, -0.28, 0.735, 0.045)", category: "Swing" },
    { name: "puff-out-center", duration: "0.7s", timing: "cubic-bezier(0.165, 0.84, 0.44, 1)", category: "Puff" },
    { name: "puff-out-top", duration: "0.7s", timing: "cubic-bezier(0.165, 0.84, 0.44, 1)", category: "Puff" },
    { name: "puff-out-bottom", duration: "0.7s", timing: "cubic-bezier(0.165, 0.84, 0.44, 1)", category: "Puff" },
    { name: "puff-out-hor", duration: "0.7s", timing: "cubic-bezier(0.165, 0.84, 0.44, 1)", category: "Puff" },
    { name: "puff-out-ver", duration: "0.7s", timing: "cubic-bezier(0.165, 0.84, 0.44, 1)", category: "Puff" },
    { name: "bounce-out-fwd", duration: "1.1s", timing: "ease", category: "Bounce" },
    { name: "bounce-out-bck", duration: "1.1s", timing: "ease", category: "Bounce" },
    { name: "text-blur-out", duration: "1.2s", timing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)", category: "Text" },
    { name: "text-focus-out", duration: "1s", timing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)", category: "Text" },
    { name: "tracking-out-expand", duration: "0.7s", timing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)", category: "Text" },
    { name: "tracking-out-contract", duration: "0.8s", timing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)", category: "Text" },
    { name: "tracking-out-expand-fwd", duration: "0.8s", timing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)", category: "Text" },
    { name: "tracking-out-contract-bck", duration: "1s", timing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)", category: "Text" },
  ];

  var INTRO_EFFECT_NAMES = [
    "fade-in-bottom",
    "fade-in-bck",
    "flip-in-hor-top",
    "flip-in-ver-right",
    "flip-in-hor-bottom",
    "roll-in-right",
    "rotate-in-2-ccw",
    "rotate-in-top",
    "scale-in-center",
    "scale-in-bottom",
    "scale-in-hor-center",
    "scale-in-ver-center",
    "slide-in-top",
    "slide-in-bottom",
    "slide-in-blurred-top",
    "slide-in-blurred-right",
    "slide-in-blurred-bottom",
    "swing-in-left-fwd",
    "puff-in-center",
    "puff-in-top",
    "puff-in-bottom",
    "puff-in-hor",
    "puff-in-ver",
    "bounce-in-fwd",
    "bounce-in-bck",
    "text-focus-in",
    "text-flicker-in-glow",
    "tracking-in-contract",
    "tracking-in-expand",
    "tracking-in-expand-fwd",
    "tracking-in-contract-bck",
  ];

  var AMBIENT_EFFECT_NAMES = [
    "blink-1",
    "blink-2",
    "flicker-3",
    "flicker-2",
    "jello-horizontal",
    "pulsate-fwd",
    "pulsate-bck",
    "bounce-top",
    "bounce-right",
    "shake-horizontal",
    "shake-vertical",
    "vibrate-1",
    "vibrate-3",
    "vibrate-2",
  ];

  var ALL_EFFECTS = SELECTED_EFFECTS.concat(OUTRO_EFFECTS);
  var EFFECTS_BY_CATEGORY = buildEffectsByCategory();

  var DEFAULT_HOLD_TIME_SECONDS = 3;

  var poemState = {
    initialized: false,
    routeActive: false,
    playbackActive: false,
    lines: [],
    timerId: null,
    currentIndex: 0,
    currentPhase: "stopped",
    currentIntroEffect: null,
    currentOutroEffect: null,
    previewEffectName: null,
    includedEffects: null,
    elements: {},
    videoLoaded: false,
    loading: false,
    holdTimeSeconds: DEFAULT_HOLD_TIME_SECONDS,
  };

  function initPoem() {
    if (poemState.initialized) return;
    poemState.initialized = true;
    poemState.includedEffects = loadEffectPreferences();
    cacheElements();
    bindEvents();
    updateEffectSummary();
    renderEffectLibrary();
    loadPoemLines();
  }

  function cacheElements() {
    var root = document.getElementById("route-poem");
    poemState.elements = {
      root: document.querySelector("[data-poem-root]") || null,
      line: document.getElementById("poem-current-line") || null,
      sentenceDisplay: document.getElementById("poem-sentence-display") || null,
      skipButton: document.querySelector("[data-poem-skip]") || null,
      effectButtons: Array.prototype.slice.call(document.querySelectorAll("[data-poem-effects-button]")),
      aboutButton: document.querySelector("[data-poem-about]") || null,
      aboutModal: document.querySelector("[data-poem-about-modal]") || null,
      aboutClose: document.querySelector("[data-poem-about-close]") || null,
      effectModal: document.querySelector("[data-poem-effect-modal]") || null,
      effectClose: document.querySelector("[data-poem-effect-close]") || null,
      effectCategories: document.querySelector("[data-poem-effect-categories]") || null,
      effectCount: document.querySelector("[data-poem-effect-count]") || null,
      effectTotal: document.querySelector("[data-poem-effect-total]") || null,
      selectAllBtn: document.querySelector("[data-effect-select-all]") || null,
      deselectAllBtn: document.querySelector("[data-effect-deselect-all]") || null,
      resetBtn: document.querySelector("[data-effect-reset]") || null,
      video: root ? root.querySelector(".background-video") : document.querySelector("#route-poem .background-video"),
    };

    if (poemState.elements.effectTotal) {
      poemState.elements.effectTotal.textContent = String(ALL_EFFECTS.length);
    }
  }

  function bindEvents() {
    if (poemState.elements.skipButton) {
      poemState.elements.skipButton.addEventListener("click", handleSkipToOutro);
    }
    if (poemState.elements.sentenceDisplay) {
      poemState.elements.sentenceDisplay.addEventListener("click", handleSkipToOutro);
    }
    poemState.elements.effectButtons.forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        openEffectModal();
      });
    });
    if (poemState.elements.aboutButton) {
      poemState.elements.aboutButton.addEventListener("click", function (event) {
        event.preventDefault();
        openAboutModal();
      });
    }
    if (poemState.elements.aboutClose) {
      poemState.elements.aboutClose.addEventListener("click", closeAboutModal);
    }
    if (poemState.elements.aboutModal) {
      poemState.elements.aboutModal.addEventListener("click", function (event) {
        if (event.target === event.currentTarget) {
          closeAboutModal();
        }
      });
    }
    if (poemState.elements.effectClose) {
      poemState.elements.effectClose.addEventListener("click", closeEffectModal);
    }
    if (poemState.elements.effectModal) {
      poemState.elements.effectModal.addEventListener("click", function (event) {
        if (event.target === event.currentTarget) {
          closeEffectModal();
        }
      });
    }
    if (poemState.elements.selectAllBtn) {
      poemState.elements.selectAllBtn.addEventListener("click", function () {
        poemState.includedEffects = getDefaultEffectSet();
        saveEffectPreferences(poemState.includedEffects);
        updateEffectSummary();
        renderEffectLibrary();
      });
    }
    if (poemState.elements.deselectAllBtn) {
      poemState.elements.deselectAllBtn.addEventListener("click", function () {
        if (!window.confirm("This will leave only one effect enabled. Continue?")) return;
        poemState.includedEffects = new Set([ALL_EFFECTS[0].name]);
        saveEffectPreferences(poemState.includedEffects);
        updateEffectSummary();
        renderEffectLibrary();
      });
    }
    if (poemState.elements.resetBtn) {
      poemState.elements.resetBtn.addEventListener("click", function () {
        poemState.includedEffects = getDefaultEffectSet();
        saveEffectPreferences(poemState.includedEffects);
        updateEffectSummary();
        renderEffectLibrary();
      });
    }
    if (poemState.elements.effectCategories) {
      poemState.elements.effectCategories.addEventListener("change", handleEffectCategoriesChange);
      poemState.elements.effectCategories.addEventListener("click", handleEffectCategoriesClick);
    }
  }

  /**
   * Split poem text into segments. A segment ends at a period or question mark.
   * The last run of text (with no . or ?) is always one segment (last line is end).
   * Preserves the author's spaces and line breaks within each segment.
   */
  function parsePoemSegments(text) {
    var segments = [];
    var pos = 0;
    var len = text.length;
    while (pos < len) {
      var nextPeriod = text.indexOf(".", pos);
      var nextQuestion = text.indexOf("?", pos);
      var nextEnd = -1;
      if (nextPeriod >= 0 && nextQuestion >= 0) {
        nextEnd = Math.min(nextPeriod, nextQuestion);
      } else if (nextPeriod >= 0) {
        nextEnd = nextPeriod;
      } else if (nextQuestion >= 0) {
        nextEnd = nextQuestion;
      }
      if (nextEnd === -1) {
        var rest = text.slice(pos).trim();
        /* Skip trailing punctuation-only (e.g. stray '.' at end of file) */
        if (rest.length > 0 && !/^[.\?\s]+$/.test(rest)) segments.push(rest);
        break;
      }
      var segment = text.slice(pos, nextEnd + 1).trim();
      if (segment.length > 0) segments.push(segment);
      pos = nextEnd + 1;
    }
    return segments;
  }

  function pickRandomPoemFile(poemsMeta) {
    var keys = Object.keys(poemsMeta);
    if (!keys.length) return null;
    return keys[Math.floor(Math.random() * keys.length)];
  }

  function loadPoemLines() {
    if (poemState.loading) return;
    poemState.loading = true;
    if (poemState.elements.line) {
      poemState.elements.line.textContent = "Loading poem...";
    }
    fetch("data/poems.json")
      .then(function (response) {
        if (!response.ok) throw new Error("Failed to fetch poems.json");
        return response.json();
      })
      .then(function (poemsMeta) {
        var poemFile = pickRandomPoemFile(poemsMeta);
        if (!poemFile) throw new Error("No poems in poems.json");
        var config = poemsMeta[poemFile] || {};
        var holdTime = config.hold_time;
        poemState.holdTimeSeconds = typeof holdTime === "number" && holdTime >= 0
          ? holdTime
          : DEFAULT_HOLD_TIME_SECONDS;
        return fetch("data/" + poemFile).then(function (res) {
          if (!res.ok) throw new Error("Failed to fetch poem: " + poemFile);
          return res.text();
        });
      })
      .then(function (text) {
        var lines = parsePoemSegments(text);
        poemState.lines = lines;
        poemState.currentIndex = 0;
        if (poemState.elements.line) {
          poemState.elements.line.textContent = lines.length ? lines[0] : "Add poems to poems.json and data/ to begin.";
        }
        maybeStartPlayback();
      })
      .catch(function (error) {
        console.warn("[poem] Unable to load poem", error);
        if (poemState.elements.line) {
          poemState.elements.line.textContent = "Unable to load poem.";
        }
      })
      .finally(function () {
        poemState.loading = false;
      });
  }

  function maybeStartPlayback() {
    if (!poemState.routeActive || !poemState.lines.length || poemState.playbackActive) {
      return;
    }
    poemState.currentIndex = Math.min(poemState.currentIndex, Math.max(poemState.lines.length - 1, 0));
    beginIntroPhase();
  }

  function beginIntroPhase() {
    if (!poemState.lines.length) return;
    clearTimer();
    poemState.playbackActive = true;
    poemState.currentIntroEffect = pickIntroEffect();
    var text = poemState.lines[poemState.currentIndex];
    applySentenceText(text);
    var effectName = poemState.previewEffectName || (poemState.currentIntroEffect && poemState.currentIntroEffect.name);
    poemState.previewEffectName = null;
    applySentenceEffect(effectName);
    poemState.currentPhase = "intro";
    scheduleTimer(parseDuration(poemState.currentIntroEffect), enterHoldPhase);
  }

  function enterHoldPhase() {
    poemState.currentPhase = "hold";
    var holdMs = poemState.holdTimeSeconds * 1000;
    scheduleTimer(holdMs, startOutroPhase);
  }

  function startOutroPhase() {
    clearTimer();
    poemState.currentOutroEffect = pickOutroEffect();
    applySentenceEffect(poemState.currentOutroEffect ? poemState.currentOutroEffect.name : null);
    poemState.currentPhase = "outro";
    scheduleTimer(parseDuration(poemState.currentOutroEffect), advanceToNextLine);
  }

  function advanceToNextLine() {
    clearTimer();
    if (poemState.currentIndex >= poemState.lines.length - 1) {
      poemState.currentPhase = "stopped";
      poemState.playbackActive = false;
      return;
    }
    poemState.currentIndex += 1;
    beginIntroPhase();
  }

  function handleSkipToOutro(event) {
    event.preventDefault();
    if (!poemState.lines.length) return;
    if (poemState.currentPhase === "intro" || poemState.currentPhase === "hold") {
      startOutroPhase();
    }
  }

  function applySentenceText(text) {
    if (!poemState.elements.line) return;
    poemState.elements.line.textContent = text || "";
  }

  function applySentenceEffect(effectName) {
    if (!poemState.elements.line) return;
    var line = poemState.elements.line;
    line.className = "sentence";
    void line.offsetWidth;
    if (effectName) {
      line.className = "sentence " + effectName;
    }
  }

  function pickIntroEffect() {
    var included = poemState.includedEffects;
    var introPool = SELECTED_EFFECTS.filter(function (effect) {
      return included.has(effect.name) && INTRO_EFFECT_NAMES.indexOf(effect.name) !== -1;
    });
    var ambientPool = SELECTED_EFFECTS.filter(function (effect) {
      return included.has(effect.name) && AMBIENT_EFFECT_NAMES.indexOf(effect.name) !== -1;
    });
    var combined = introPool.concat(ambientPool);
    if (!combined.length) {
      combined = SELECTED_EFFECTS.filter(function (effect) {
        return included.has(effect.name);
      });
    }
    if (!combined.length) {
      combined = SELECTED_EFFECTS.slice();
    }
    return pickRandom(combined);
  }

  function pickOutroEffect() {
    var included = poemState.includedEffects;
    var outroPool = OUTRO_EFFECTS.filter(function (effect) {
      return included.has(effect.name);
    });
    var ambientPool = SELECTED_EFFECTS.filter(function (effect) {
      return included.has(effect.name) && AMBIENT_EFFECT_NAMES.indexOf(effect.name) !== -1;
    });
    var combined = outroPool.concat(ambientPool);
    if (!combined.length) {
      combined = OUTRO_EFFECTS.slice();
    }
    return pickRandom(combined);
  }

  function pickRandom(collection) {
    if (!collection.length) return null;
    var index = Math.floor(Math.random() * collection.length);
    return collection[index];
  }

  function parseDuration(effect) {
    if (!effect || !effect.duration) return 600;
    var value = parseFloat(effect.duration);
    if (Number.isNaN(value)) return 600;
    return value * 1000;
  }

  function scheduleTimer(duration, next) {
    clearTimer();
    if (!poemState.routeActive) {
      poemState.playbackActive = false;
      return;
    }
    poemState.timerId = window.setTimeout(function () {
      poemState.timerId = null;
      if (typeof next === "function") {
        next();
      }
    }, duration);
  }

  function clearTimer() {
    if (poemState.timerId) {
      window.clearTimeout(poemState.timerId);
      poemState.timerId = null;
    }
  }

  function ensureVideoReady() {
    var video = poemState.elements.video;
    if (!video || poemState.videoLoaded) return;
    var src = video.getAttribute("data-video-src");
    if (src) {
      video.src = src;
      video.load();
      poemState.videoLoaded = true;
    }
  }

  function playVideo() {
    var video = poemState.elements.video;
    if (!video) return;
    var playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {});
    }
  }

  function pauseVideo() {
    var video = poemState.elements.video;
    if (!video) return;
    try {
      video.pause();
    } catch (error) {
      console.warn("[poem] Unable to pause video", error);
    }
  }

  function loadEffectPreferences() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed.includedEffects)) {
          var filtered = parsed.includedEffects.filter(function (name) {
            return ALL_EFFECTS.some(function (effect) {
              return effect.name === name;
            });
          });
          if (filtered.length) {
            return new Set(filtered);
          }
        }
      }
    } catch (error) {
      console.warn("[poem] Unable to load effect preferences", error);
    }
    return getDefaultEffectSet();
  }

  function saveEffectPreferences(effectSet) {
    try {
      var payload = {
        version: 1,
        includedEffects: Array.from(effectSet),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("[poem] Unable to save effect preferences", error);
    }
  }

  function getDefaultEffectSet() {
    return new Set(
      ALL_EFFECTS.map(function (effect) {
        return effect.name;
      })
    );
  }

  function renderEffectLibrary() {
    var container = poemState.elements.effectCategories;
    if (!container) return;
    container.innerHTML = "";
    var included = poemState.includedEffects;
    var categories = Object.keys(EFFECTS_BY_CATEGORY).sort();

    categories.forEach(function (category) {
      var section = document.createElement("details");
      section.className = "category-section";
      section.open = true;

      var summary = document.createElement("summary");
      summary.className = "category-header";

      var nameSpan = document.createElement("span");
      nameSpan.className = "category-name";
      nameSpan.textContent = category;

      var countSpan = document.createElement("span");
      countSpan.className = "category-count";
      var effects = EFFECTS_BY_CATEGORY[category];
      var includedCount = effects.filter(function (effect) {
        return included.has(effect.name);
      }).length;
      countSpan.textContent = includedCount + "/" + effects.length;

      summary.appendChild(nameSpan);
      summary.appendChild(countSpan);
      section.appendChild(summary);

      var list = document.createElement("div");
      list.className = "effect-list";

      effects.forEach(function (effect) {
        var row = document.createElement("div");
        row.className = "effect-row";
        row.setAttribute("data-effect-name", effect.name);

        var label = document.createElement("label");
        label.className = "effect-label";

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = included.has(effect.name);
        checkbox.setAttribute("data-effect-checkbox", effect.name);

        var span = document.createElement("span");
        span.className = "effect-name";
        span.textContent = effect.name;

        label.appendChild(checkbox);
        label.appendChild(span);

        var demo = document.createElement("button");
        demo.type = "button";
        demo.className = "effect-demo-btn";
        demo.textContent = "demo";
        demo.title = "Click to demo this effect on the main screen";
        demo.setAttribute("data-effect-demo", effect.name);

        row.appendChild(label);
        row.appendChild(demo);
        list.appendChild(row);
      });

      section.appendChild(list);
      container.appendChild(section);
    });
  }

  function updateEffectSummary() {
    if (poemState.elements.effectCount) {
      poemState.elements.effectCount.textContent = String(poemState.includedEffects.size);
    }
    if (poemState.elements.effectTotal) {
      poemState.elements.effectTotal.textContent = String(ALL_EFFECTS.length);
    }
  }

  function handleEffectCategoriesChange(event) {
    var checkbox = event.target;
    if (!checkbox || checkbox.getAttribute("data-effect-checkbox") == null) return;
    var effectName = checkbox.getAttribute("data-effect-checkbox");
    if (!effectName) return;
    if (checkbox.checked) {
      poemState.includedEffects.add(effectName);
    } else if (poemState.includedEffects.size > 1) {
      poemState.includedEffects.delete(effectName);
    } else {
      checkbox.checked = true;
      return;
    }
    saveEffectPreferences(poemState.includedEffects);
    updateEffectSummary();
    renderEffectLibrary();
  }

  function handleEffectCategoriesClick(event) {
    var demoButton = event.target.closest("button[data-effect-demo]");
    if (!demoButton) return;
    var effectName = demoButton.getAttribute("data-effect-demo");
    if (!effectName) return;
    previewEffect(effectName);
  }

  function previewEffect(effectName) {
    poemState.previewEffectName = effectName;
    applySentenceEffect(effectName);
  }

  function openEffectModal() {
    if (poemState.elements.effectModal) {
      poemState.elements.effectModal.hidden = false;
    }
  }

  function closeEffectModal() {
    if (poemState.elements.effectModal) {
      poemState.elements.effectModal.hidden = true;
    }
  }

  function openAboutModal() {
    if (poemState.elements.aboutModal) {
      poemState.elements.aboutModal.hidden = false;
    }
  }

  function closeAboutModal() {
    if (poemState.elements.aboutModal) {
      poemState.elements.aboutModal.hidden = true;
    }
  }

  function buildEffectsByCategory() {
    return ALL_EFFECTS.reduce(function (acc, effect) {
      var category = effect.category || "Other";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(effect);
      return acc;
    }, {});
  }

  function showPoem() {
    poemState.routeActive = true;
    document.body.dataset.poemVisible = "true";
    ensureVideoReady();
    playVideo();
    maybeStartPlayback();
  }

  function hidePoem() {
    poemState.routeActive = false;
    delete document.body.dataset.poemVisible;
    poemState.playbackActive = false;
    if (poemState.currentPhase !== "stopped") {
      poemState.currentPhase = "paused";
    }
    clearTimer();
    pauseVideo();
  }

  window.initPoem = function () {
    initPoem();
  };
  window.showPoem = showPoem;
  window.hidePoem = hidePoem;

  // Ensure init runs if the route is already active when the script loads.
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initPoem();
  } else {
    document.addEventListener("DOMContentLoaded", initPoem);
  }
})();
