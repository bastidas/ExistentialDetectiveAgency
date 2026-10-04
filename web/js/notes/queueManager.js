(function (global) {
  "use strict";

  var LOG_PREFIX = "[note-queue]";
  // When preferLargerPaper is true, prefer papers whose capacity is at
  // least this multiple of the required characters, if available.
  var PREFERRED_CAPACITY_RATIO = 1.5;

  var EDANotePages = global.EDANotePages || null;
  var capacityApi = global.EDANoteCapacity || null;
  var cfg = global.EDANoteFormatConfig || null;

  function delay(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function createAllocator() {
    // Single shared pool: left and right both draw from the same available/spent
    // so one philosopher cannot use a paper image until it comes back into the pool.
    var available = [];
    var spent = [];

    function hydrate() {
      var papers = (cfg && typeof cfg.getPaperImages === "function") ? cfg.getPaperImages() : [];
      if (!papers || !papers.length) {
        available = [];
        spent = [];
        return;
      }
      available = papers.map(buildEntryShared);
      spent = [];
      console.log(LOG_PREFIX, "reset paper stack (shared pool) count:", available.length);
    }

    function ensure() {
      if (!available || !available.length) hydrate();
    }

    function buildEntryShared(paperUrl) {
      var leftM = capacityApi && typeof capacityApi.getCapacity === "function"
        ? capacityApi.getCapacity(paperUrl, "left")
        : null;
      var rightM = capacityApi && typeof capacityApi.getCapacity === "function"
        ? capacityApi.getCapacity(paperUrl, "right")
        : null;
      return {
        paperUrl: paperUrl,
        capacityLeft: leftM && typeof leftM.capacity === "number" ? leftM.capacity : Infinity,
        capacityRight: rightM && typeof rightM.capacity === "number" ? rightM.capacity : Infinity,
        linesLeft: leftM && leftM.lines,
        linesRight: rightM && rightM.lines,
        charsPerLineLeft: leftM && leftM.charsPerLine,
        charsPerLineRight: rightM && rightM.charsPerLine,
      };
    }

    function capacityForSide(entry, side) {
      return side === "right"
        ? (entry.capacityRight != null ? entry.capacityRight : entry.capacity)
        : (entry.capacityLeft != null ? entry.capacityLeft : entry.capacity);
    }

    function removeEntry(list, entry) {
      var idx = list.indexOf(entry);
      if (idx === -1) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].paperUrl === entry.paperUrl) {
            idx = i;
            break;
          }
        }
      }
      if (idx >= 0) list.splice(idx, 1);
    }

    function pickFromList(list, side, requiredChars, preferLarger, avoidPaperUrl, strictCapacity) {
      if (!list || !list.length) return null;
      var filtered = list.filter(function (entry) {
        var cap = capacityForSide(entry, side);
        return typeof cap === "number" && cap >= requiredChars;
      });
      var candidates;
      if (filtered.length) {
        candidates = filtered;
      } else if (strictCapacity) {
        return null;
      } else {
        candidates = list.filter(function (entry) {
          var cap = capacityForSide(entry, side);
          return typeof cap === "number" || cap === Infinity;
        });
        if (!candidates.length) candidates = list.slice();
      }
      if (avoidPaperUrl) {
        candidates = candidates.filter(function (e) { return e.paperUrl !== avoidPaperUrl; });
        if (!candidates.length) {
          if (filtered.length && !strictCapacity) {
            candidates = filtered;
          } else if (!strictCapacity) {
            candidates = list.slice().filter(function (e) { return e.paperUrl !== avoidPaperUrl; });
            if (!candidates.length) candidates = list.slice();
          } else {
            return null;
          }
        }
      }
      if (!candidates.length) return null;
      if (preferLarger) {
        var targetChars = requiredChars * PREFERRED_CAPACITY_RATIO;
        var oversize = candidates.filter(function (entry) {
          var cap = capacityForSide(entry, side);
          return typeof cap === "number" && cap >= targetChars;
        });
        var pool = oversize.length ? oversize : candidates;
        pool.sort(function (a, b) {
          return (capacityForSide(b, side) || 0) - (capacityForSide(a, side) || 0);
        });
        return pool[0];
      }
      var idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx];
    }

    function reserve(side, requiredChars, preferLargerPaper, options) {
      options = options || {};
      var avoidPaperUrl = options.avoidPaperUrl || null;
      var sideKey = side === "right" ? "right" : "left";
      var needChars = Math.max(1, requiredChars || 0);
      ensure();
      var entry = pickFromList(
        available,
        sideKey,
        needChars,
        preferLargerPaper,
        avoidPaperUrl,
        !!preferLargerPaper
      );
      if (entry) {
        removeEntry(available, entry);
        spent.push(entry);
        if (!available.length) hydrate();
        return entry;
      }
      entry = pickFromList(spent, sideKey, needChars, true, avoidPaperUrl, false);
      if (entry) {
        removeEntry(spent, entry);
        console.log(LOG_PREFIX, "reusing spent paper", entry.paperUrl, sideKey);
        return entry;
      }
      hydrate();
      entry = pickFromList(available, sideKey, needChars, true, avoidPaperUrl, false);
      if (entry) {
        removeEntry(available, entry);
        spent.push(entry);
        if (!available.length) hydrate();
      }
      return entry;
    }

    function snapshot(list) {
      return (list || []).map(function (entry) {
        return {
          paperUrl: entry.paperUrl,
          capacity: capacityForSide(entry, "left"),
          lines: entry.linesLeft,
          charsPerLine: entry.charsPerLineLeft,
        };
      });
    }

    function getState() {
      var snap = snapshot(available);
      var spentSnap = snapshot(spent);
      return {
        available: { left: snap, right: snap },
        spent: { left: spentSnap, right: spentSnap },
      };
    }

    return {
      reserve: reserve,
      getState: getState,
      reset: hydrate,
    };
  }

  function createQueue(executor) {
    var queues = {
      left: { pending: [], running: false, pauseMs: 0 },
      right: { pending: [], running: false, pauseMs: 0 },
    };

    function setPause(ms) {
      var m = Math.max(0, Number(ms) || 0);
      queues.left.pauseMs = m;
      queues.right.pauseMs = m;
    }

    function enqueue(job) {
      return new Promise(function (resolve, reject) {
        var side = job && job.side === "right" ? "right" : "left";
        queues[side].pending.push({ job: job, resolve: resolve, reject: reject });
        if (LOG_PREFIX) console.log(LOG_PREFIX, "enqueue -> side:", side, "pending:", queues[side].pending.length, "textLen:", job && job.text ? String(job.text).length : 0);
        drain(side);
      });
    }

    function drain(side) {
      var q = queues[side];
      if (q.running) return;
      var next = q.pending.shift();
      if (!next) return;
      q.running = true;
      try {
        if (LOG_PREFIX) console.log(LOG_PREFIX, "start job -> side:", side, "textLen:", next.job && next.job.text ? String(next.job.text).length : 0);
      } catch (e) {}
      executor(next.job)
        .then(function (result) {
          next.resolve(result);
          if (LOG_PREFIX) console.log(LOG_PREFIX, "job done -> side:", side);
          return delay(q.pauseMs);
        })
        .catch(function (err) {
          next.reject(err);
          if (LOG_PREFIX) console.log(LOG_PREFIX, "job error -> side:", side, err && err.message ? err.message : err);
          return delay(q.pauseMs);
        })
        .then(function () {
          q.running = false;
          if (LOG_PREFIX) console.log(LOG_PREFIX, "drain continue -> side:", side, "pending:", q.pending.length);
          drain(side);
        });
    }

    return {
      enqueue: enqueue,
      setPause: setPause,
    };
  }

  var allocator = createAllocator();

  function executeJob(job) {
    EDANotePages = EDANotePages || global.EDANotePages;
    if (!EDANotePages || !job || !job.text) return Promise.resolve();
    var side = job.side === "right" ? "right" : "left";
    var text = String(job.text);
    if (!text.trim()) return Promise.resolve();
    var longNoteThreshold = (cfg && typeof cfg.getLongNoteThreshold === "function") ? cfg.getLongNoteThreshold() : 350;
    if (text.length > longNoteThreshold) {
      console.info(LOG_PREFIX, "Long note candidate", { side: side, length: text.length });
    }
    var decision = EDANotePages.need_new_note(side, text) || { needNew: true };
    var writeStep = Promise.resolve();
    if (decision.needNew) {
      var currentPaperUrl = (EDANotePages.getCurrentPaperUrl && EDANotePages.getCurrentPaperUrl(side)) || null;
      var selection = allocator.reserve(side, text.length, !!decision.preferLargerPaper, { avoidPaperUrl: currentPaperUrl });
      var noteOptions = { avoidPaperUrl: currentPaperUrl };
      if (selection && selection.paperUrl) {
        // Allocator is the single source of truth for paper choice when available.
        // Use its selection directly so the shared pool semantics (available/spent)
        // cannot be bypassed by local random selection.
        noteOptions.paperUrl = selection.paperUrl;
      } else if (decision.preferLargerPaper) {
        // Fallback for environments where allocator cannot provide a selection.
        noteOptions.preferLargerPaper = true;
      }
      var newNoteResult = EDANotePages.write_new_note(side, noteOptions);
      if (newNoteResult == null) {
        return Promise.reject(new Error("write_new_note failed: no region for side " + side));
      }
      writeStep = Promise.resolve(newNoteResult);
    }
    return writeStep.then(function () {
      return EDANotePages.write_on_current_note(side, text, job.writeOptions || {});
    });
  }

  var queue = createQueue(executeJob);

  var manager = {
    init: function (options) {
      if (!options) return;
      if (options.pauseMs != null) queue.setPause(options.pauseMs);
    },
    enqueue: function (job) {
      return queue.enqueue(job || {});
    },
    getAllocatorState: function () {
      return allocator.getState();
    },
  };

  global.EDANoteQueueManager = manager;
})(typeof window !== "undefined" ? window : this);
