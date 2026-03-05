(function (global) {
  "use strict";

  // var LEFT_WRITING_SPEED_MS = 0;
  // var LEFT_WRITING_VARIATION_MS =  0;
  // var RIGHT_WRITING_SPEED_MS = 0;
  // var RIGHT_WRITING_VARIATION_MS = 0;

  var LEFT_WRITING_SPEED_MS = 15;
  var LEFT_WRITING_VARIATION_MS =  20;
  var RIGHT_WRITING_SPEED_MS = 10;
  var RIGHT_WRITING_VARIATION_MS = 15;

  /** Pause after each note (write → pause → fit check → write next). 10 s. */
  var NOTE_PAUSE_MS = 2000;

  /** Probability of writing to left when appendPhilosopherNoteToBothPanels is used (0.5 = 50% left, 50% right). */
  var LEFT_RIGHT_BIAS = 0.5;

  var philosopherRules = [];
  var noteQueueManager = global.NoteQueueManager || null;
  if (noteQueueManager && typeof noteQueueManager.init === "function") {
    noteQueueManager.init({ pauseMs: NOTE_PAUSE_MS });
  }

  function fallbackHandwriterWrite(side, text, opts) {
    if (!text) return Promise.resolve();
    var targetId = side === "right" ? "right-philosopher-content" : "left-philosopher-content";
    var target = typeof document !== "undefined" ? document.getElementById(targetId) : null;
    if (!target || typeof handwriter === "undefined") return Promise.resolve();
    return handwriter.appendText(target, text, opts || {});
  }

  function queueNoteWrite(side, text, opts) {
    if (!text) return Promise.resolve();
    var normalizedSide = side === "right" ? "right" : "left";
    if (noteQueueManager && typeof noteQueueManager.enqueue === "function" && typeof notePages !== "undefined") {
      var writeOptions = Object.assign({}, opts || {});
      var job = { side: normalizedSide, text: text, writeOptions: writeOptions };
      var noteFormatConfig = global.NoteFormatConfig;
      if (noteFormatConfig && typeof noteFormatConfig.whenPaperConfigLoaded === "function") {
        return noteFormatConfig.whenPaperConfigLoaded().then(function () {
          return noteQueueManager.enqueue(job);
        });
      }
      return noteQueueManager.enqueue(job);
    }
    return fallbackHandwriterWrite(normalizedSide, text, opts);
  }

  function createRule(raw) {
    var userText = (raw.userText && raw.userText.trim()) || "";
    var respondText = raw.respondText || "";
    var mode = (raw.mode || "").toLowerCase();
    return {
      userText: userText,
      respondText: respondText,
      mode: mode,
      matches: function (text) {
        return (
          !!text &&
          !!userText &&
          text.toLowerCase().includes(userText.toLowerCase())
        );
      },
    };
  }

  function getKeywords() {
    return philosopherRules
      .map(function (r) {
        return r.userText && r.userText.trim();
      })
      .filter(Boolean);
  }

  function getAnnotationRules() {
    return philosopherRules.filter(function (r) {
      return (
        (r.mode === "keyword" || r.mode === "highlight" || r.mode === "strike") &&
        r.userText &&
        r.userText.trim()
      );
    });
  }

  function matchRules(text) {
    if (!text) {
      console.log("[phil-annotations] matchRules: no text");
      return [];
    }
    var matched = philosopherRules.filter(function (r) {
      return r.matches(text);
    });
    console.log(
      "[phil-annotations] matchRules:",
      JSON.stringify(text.slice(0, 80)),
      "→",
      matched.length,
      "matched",
      matched.length
        ? matched.map(function (r) {
            return r.userText + "→" + r.mode;
          })
        : ""
    );
    return matched;
  }

  function appendPhilosopherNoteToBothPanels(text) {
    if (!text) return Promise.resolve();
    var writeLeft = Math.random() < LEFT_RIGHT_BIAS;
    var baseOpts = writeLeft
      ? { baseDelayMs: LEFT_WRITING_SPEED_MS, variationMs: LEFT_WRITING_VARIATION_MS }
      : { baseDelayMs: RIGHT_WRITING_SPEED_MS, variationMs: RIGHT_WRITING_VARIATION_MS, useLinedLayout: true, disableScroll: true };
    baseOpts.debugLabel = "both";
    return queueNoteWrite(writeLeft ? "left" : "right", text, baseOpts);
  }

  var SIDE_OPTS = {
    left: {
      baseDelayMs: LEFT_WRITING_SPEED_MS,
      variationMs: LEFT_WRITING_VARIATION_MS,
    },
    right: {
      baseDelayMs: RIGHT_WRITING_SPEED_MS,
      variationMs: RIGHT_WRITING_VARIATION_MS,
      useLinedLayout: true,
      disableScroll: true,
    },
  };

  function appendPhilosopherContent(side, responseText, notesArray) {
    var pieces = [];
    if (responseText && responseText.trim()) pieces.push(responseText.trim());
    if (Array.isArray(notesArray)) {
      notesArray.forEach(function (note) {
        if (note != null && String(note).trim() !== "") pieces.push(String(note).trim());
      });
    }
    if (!pieces.length) return Promise.resolve();
    var normalizedSide = side === "right" ? "right" : "left";
    var baseOpts = SIDE_OPTS[normalizedSide];
    var labelPrefix = normalizedSide === "right" ? "R" : "L";
    var chain = Promise.resolve();
    pieces.forEach(function (text, idx) {
      chain = chain.then(function () {
        console.log("[philosopherRules]", normalizedSide, "piece", idx + 1, "/", pieces.length, "len:", text.length);
        var opts = Object.assign({}, baseOpts, {
          debugLabel: labelPrefix + " " + (idx + 1) + "/" + pieces.length,
        });
        return queueNoteWrite(normalizedSide, text, opts);
      });
    });
    return chain;
  }

  function runNoteActions(message) {
    var matched = matchRules(message);
    var noteRules = matched.filter(function (r) {
      return r.mode === "note";
    });
    console.log(
      "[phil-annotations] runNoteActions: message length",
      message.length,
      "note rules to run:",
      noteRules.length,
      noteRules.length
        ? noteRules.map(function (r) {
            return r.respondText;
          })
        : ""
    );
    var seen = {};
    var leftNotes = [];
    var rightNotes = [];

    noteRules.forEach(function (rule) {
      if (seen[rule.respondText]) return;
      seen[rule.respondText] = true;
      var writeLeft = Math.random() < LEFT_RIGHT_BIAS;
      if (writeLeft) leftNotes.push(rule.respondText);
      else rightNotes.push(rule.respondText);
    });

    function chainNotesForSide(side, notes) {
      if (!notes || !notes.length) return Promise.resolve();
      var baseOpts = SIDE_OPTS[side] || {};
      var labelPrefix = side === "right" ? "R" : "L";
      return notes.reduce(function (p, text, idx) {
        return p.then(function () {
          console.log("[phil-annotations]", side, "Appending note:", text);
          var opts = Object.assign({}, baseOpts, { debugLabel: labelPrefix + " " + (idx + 1) + "/" + notes.length });
          return queueNoteWrite(side, text, opts);
        });
      }, Promise.resolve());
    }

    // Run left and right chains concurrently so different philosophers can write simultaneously.
    return Promise.all([chainNotesForSide("left", leftNotes), chainNotesForSide("right", rightNotes)]).then(function () { return null; });
  }

  function applyRewriteFirst(message) {
    var matched = matchRules(message);
    var rewriteRule = matched.filter(function (r) {
      return r.mode === "rewrite";
    })[0];
    if (!rewriteRule) return null;
    var lower = message.toLowerCase();
    var idx = lower.indexOf(rewriteRule.userText.toLowerCase());
    if (idx === -1) return null;
    return {
      rule: rewriteRule,
      index: idx,
      newMessage:
        message.slice(0, idx) +
        rewriteRule.respondText +
        message.slice(idx + rewriteRule.userText.length),
    };
  }

  function loadRules() {
    // Load directly from public data, similar to paper-config.json.
    // This avoids backend deployment/file-layout issues.
    return fetch("data/phil_annotations.json")
      .then(function (res) {
        if (!res.ok) {
          console.log(
            "[phil-annotations] data/phil_annotations.json fetch failed:",
            res.status,
            res.statusText
          );
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        var raw = Array.isArray(data) ? data : [];
        philosopherRules = raw.map(createRule);
        console.log(
          "[phil-annotations] Loaded rules (from data/phil_annotations.json):",
          philosopherRules.length
        );
      })
      .catch(function (err) {
        philosopherRules = [];
        console.log(
          "[phil-annotations] data/phil_annotations.json fetch error:",
          err && err.message ? err.message : err
        );
      });
  }

  function getRulesCount() {
    return philosopherRules.length;
  }

  global.EDARules = {
    getKeywords: getKeywords,
    getAnnotationRules: getAnnotationRules,
    matchRules: matchRules,
    runNoteActions: runNoteActions,
    applyRewriteFirst: applyRewriteFirst,
    appendPhilosopherNoteToBothPanels: appendPhilosopherNoteToBothPanels,
    appendPhilosopherContent: appendPhilosopherContent,
    queueNoteWrite: queueNoteWrite,
    loadRules: loadRules,
    getRulesCount: getRulesCount,
  };
})(typeof window !== "undefined" ? window : this);
