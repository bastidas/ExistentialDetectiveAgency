(function (global) {
  "use strict";

  var LEFT_WRITING_SPEED_MS = 1;
  var LEFT_WRITING_VARIATION_MS =  20;
  var RIGHT_WRITING_SPEED_MS = 1;
  var RIGHT_WRITING_VARIATION_MS = 15;

  /** Pause after each chunk (write → pause → fit check → write next). 0.1 s. */
  var NOTE_PAUSE_MS = 10000;

  /** Probability of writing to left when appendPhilosopherNoteToBothPanels is used (0.5 = 50% left, 50% right). */
  var LEFT_RIGHT_BIAS = 0.5;

  var philosopherRules = [];

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** Per-philosopher write queues: only one write runs at a time per side; others wait. */
  function createSideQueue() {
    var queue = [];
    var draining = false;
    function runNext() {
      if (queue.length === 0) {
        draining = false;
        return;
      }
      var job = queue.shift();
      job.run(job).then(function () {
        job.resolve();
        runNext();
      }).catch(function (err) {
        job.reject(err);
        runNext();
      });
    }
    function drain() {
      if (draining || queue.length === 0) return;
      draining = true;
      runNext();
    }
    function enqueue(job) {
      job.queuedWhenLength = queue.length;
      queue.push(job);
      drain();
    }
    return { enqueue: enqueue };
  }

  var leftSideQueue = createSideQueue();
  var rightSideQueue = createSideQueue();
  function enqueueLeft(job) {
    leftSideQueue.enqueue(job);
  }
  function enqueueRight(job) {
    rightSideQueue.enqueue(job);
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
    var run = function (job) {
      var debugQueueAtEnqueue = job && job.queuedWhenLength != null ? job.queuedWhenLength : null;
      var baseOpts = writeLeft
        ? { baseDelayMs: LEFT_WRITING_SPEED_MS, variationMs: LEFT_WRITING_VARIATION_MS }
        : { baseDelayMs: RIGHT_WRITING_SPEED_MS, variationMs: RIGHT_WRITING_VARIATION_MS, useLinedLayout: true, disableScroll: true };
      if (debugQueueAtEnqueue != null) baseOpts.debugQueueAtEnqueue = debugQueueAtEnqueue;
      baseOpts.debugLabel = "both";
      if (typeof notePages !== "undefined") {
        if (writeLeft) {
          var leftResult = notePages.need_new_note("left", text);
          if (leftResult.needNew) notePages.write_new_note("left", leftResult.preferLargerPaper ? { preferLargerPaper: true } : undefined);
          return notePages.write_on_current_note("left", text, baseOpts);
        }
        var rightResult = notePages.need_new_note("right", text);
        if (rightResult.needNew) notePages.write_new_note("right", rightResult.preferLargerPaper ? { preferLargerPaper: true } : undefined);
        return notePages.write_on_current_note("right", text, baseOpts);
      }
      var leftEl = document.getElementById("left-philosopher-content");
      var rightEl = document.getElementById("right-philosopher-content");
      if (writeLeft && leftEl && typeof handwriter !== "undefined") {
        return handwriter.appendText(leftEl, text, baseOpts);
      }
      if (!writeLeft && rightEl && typeof handwriter !== "undefined") {
        return handwriter.appendText(rightEl, text, baseOpts);
      }
      return Promise.resolve();
    };
    if (writeLeft) {
      return new Promise(function (resolve, reject) {
        enqueueLeft({ run: run, resolve: resolve, reject: reject });
      });
    }
    return new Promise(function (resolve, reject) {
      enqueueRight({ run: run, resolve: resolve, reject: reject });
    });
  }

  function appendLeftPhilosopherContent(responseText, notesArray) {
    var leftEl = document.getElementById("left-philosopher-content");
    if (!leftEl) return Promise.resolve();
    var baseOpts = {
      baseDelayMs: LEFT_WRITING_SPEED_MS,
      variationMs: LEFT_WRITING_VARIATION_MS,
    };
    var pieces = [];
    if (responseText && responseText.trim()) pieces.push(responseText.trim());
    if (Array.isArray(notesArray)) {
      notesArray.forEach(function (note) {
        if (note != null && String(note).trim() !== "") pieces.push(String(note).trim());
      });
    }
    var chain;
    if (typeof notePages !== "undefined") {
      return new Promise(function (resolve, reject) {
        enqueueLeft({
          run: function (job) {
            var debugQueueAtEnqueue = job && job.queuedWhenLength != null ? job.queuedWhenLength : null;
            chain = Promise.resolve();
            pieces.forEach(function (text, idx) {
              chain = chain.then(function () {
                console.log("[philosopherRules] left piece", idx + 1, "/", pieces.length, "len:", text.length);
                var leftResult = notePages.need_new_note("left", text);
                if (leftResult.needNew) notePages.write_new_note("left", leftResult.preferLargerPaper ? { preferLargerPaper: true } : undefined);
                var opts = Object.assign({}, baseOpts, {
                  debugLabel: "L " + (idx + 1) + "/" + pieces.length,
                });
                if (debugQueueAtEnqueue != null) opts.debugQueueAtEnqueue = debugQueueAtEnqueue;
                return notePages.write_on_current_note("left", text, opts);
              });
              if (idx < pieces.length - 1) {
                chain = chain.then(function () {
                  return delay(NOTE_PAUSE_MS);
                });
              }
            });
            return chain;
          },
          resolve: resolve,
          reject: reject,
        });
      });
    }
    if (typeof handwriter === "undefined") return Promise.resolve();
    chain = Promise.resolve();
    if (responseText && responseText.trim()) {
      chain = chain.then(function () {
        return handwriter.appendText(leftEl, responseText.trim(), baseOpts);
      });
    }
    if (Array.isArray(notesArray) && notesArray.length > 0) {
      notesArray.forEach(function (note) {
        if (note == null || String(note).trim() === "") return;
        chain = chain.then(function () {
          return handwriter.appendText(leftEl, String(note).trim(), baseOpts);
        });
      });
    }
    return new Promise(function (resolve, reject) {
      enqueueLeft({ run: function (job) { return chain; }, resolve: resolve, reject: reject });
    });
  }

  function appendRightPhilosopherContent(responseText, notesArray) {
    var rightEl = document.getElementById("right-philosopher-content");
    if (!rightEl) return Promise.resolve();
    var baseOpts = {
      baseDelayMs: RIGHT_WRITING_SPEED_MS,
      variationMs: RIGHT_WRITING_VARIATION_MS,
      useLinedLayout: true,
      disableScroll: true,
    };
    var pieces = [];
    if (responseText && responseText.trim()) pieces.push(responseText.trim());
    if (Array.isArray(notesArray)) {
      notesArray.forEach(function (note) {
        if (note != null && String(note).trim() !== "") pieces.push(String(note).trim());
      });
    }
    var chain;
    if (typeof notePages !== "undefined") {
      return new Promise(function (resolve, reject) {
        enqueueRight({
          run: function (job) {
            var debugQueueAtEnqueue = job && job.queuedWhenLength != null ? job.queuedWhenLength : null;
            chain = Promise.resolve();
            pieces.forEach(function (text, idx) {
              chain = chain.then(function () {
                console.log("[philosopherRules] right piece", idx + 1, "/", pieces.length, "len:", text.length);
                var rightResult = notePages.need_new_note("right", text);
                if (rightResult.needNew) notePages.write_new_note("right", rightResult.preferLargerPaper ? { preferLargerPaper: true } : undefined);
                var opts = Object.assign({}, baseOpts, {
                  debugLabel: "R " + (idx + 1) + "/" + pieces.length,
                });
                if (debugQueueAtEnqueue != null) opts.debugQueueAtEnqueue = debugQueueAtEnqueue;
                return notePages.write_on_current_note("right", text, opts);
              });
              if (idx < pieces.length - 1) {
                chain = chain.then(function () {
                  return delay(NOTE_PAUSE_MS);
                });
              }
            });
            return chain;
          },
          resolve: resolve,
          reject: reject,
        });
      });
    }
    if (typeof handwriter === "undefined") return Promise.resolve();
    chain = Promise.resolve();
    if (responseText && responseText.trim()) {
      chain = chain.then(function () {
        return handwriter.appendText(rightEl, responseText.trim(), baseOpts);
      });
    }
    if (Array.isArray(notesArray) && notesArray.length > 0) {
      notesArray.forEach(function (note) {
        if (note == null || String(note).trim() === "") return;
        chain = chain.then(function () {
          return handwriter.appendText(rightEl, String(note).trim(), baseOpts);
        });
      });
    }
    return new Promise(function (resolve, reject) {
      enqueueRight({ run: function (job) { return chain; }, resolve: resolve, reject: reject });
    });
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
    var chain = Promise.resolve();
    noteRules.forEach(function (rule) {
      if (seen[rule.respondText]) return;
      seen[rule.respondText] = true;
      chain = chain.then(function () {
        console.log("[phil-annotations] Appending note:", rule.respondText);
        return appendPhilosopherNoteToBothPanels(rule.respondText);
      });
    });
    return chain;
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
    return fetch("/api/philosopher-notes", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) {
          console.log(
            "[phil-annotations] Fetch failed:",
            res.status,
            res.statusText
          );
          return null;
        }
        return res.json();
      })
      .then(function (d) {
        var raw = d && Array.isArray(d.rules) ? d.rules : [];
        philosopherRules = raw.map(createRule);
        console.log(
          "[phil-annotations] Loaded rules:",
          philosopherRules.length,
          philosopherRules.length ? philosopherRules : "(none)"
        );
      })
      .catch(function (err) {
        philosopherRules = [];
        console.log(
          "[phil-annotations] Fetch error:",
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
    appendLeftPhilosopherContent: appendLeftPhilosopherContent,
    appendRightPhilosopherContent: appendRightPhilosopherContent,
    loadRules: loadRules,
    getRulesCount: getRulesCount,
  };
})(typeof window !== "undefined" ? window : this);
