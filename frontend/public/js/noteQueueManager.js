(function (global) {
  "use strict";

  // Shared runtime config for note heuristics (also read by notePages).
  var NOTE_RUNTIME_CONFIG = global.EDANoteConfig || (global.EDANoteConfig = {});
  var LONG_NOTE_THRESHOLD = typeof NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD === "number"
    ? NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD
    : 350;
  NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD = LONG_NOTE_THRESHOLD;

  var LOG_PREFIX = "[note-queue]";
  // When preferLargerPaper is true, prefer papers whose capacity is at
  // least this multiple of the required characters, if available.
  var PREFERRED_CAPACITY_RATIO = 1.5;

  var notePages = global.notePages || null;
  var capacityApi = global.NoteCapacity || null;
  var cfg = global.NoteFormatConfig || null;

  function delay(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function createAllocator() {
    var available = { left: [], right: [] };
    var spent = { left: [], right: [] };

    function hydrateside(side) {
      var papers = (cfg && typeof cfg.getPaperImages === "function") ? cfg.getPaperImages() : [];
      if (!papers || !papers.length) {
        available[side] = [];
        spent[side] = [];
        return;
      }
      available[side] = papers.map(function (paperUrl) {
        return buildEntry(paperUrl, side);
      });
      spent[side] = [];
      console.log(LOG_PREFIX, "reset paper stack", side, "count:", available[side].length);
    }

    function ensure(side) {
      if (!available[side] || !available[side].length) hydrateside(side);
      if (!spent[side]) spent[side] = [];
    }

    function buildEntry(paperUrl, side) {
      var metrics = capacityApi && typeof capacityApi.getCapacity === "function"
        ? capacityApi.getCapacity(paperUrl, side)
        : null;
      return {
        paperUrl: paperUrl,
        side: side,
        capacity: metrics ? metrics.capacity : Infinity,
        lines: metrics ? metrics.lines : null,
        charsPerLine: metrics ? metrics.charsPerLine : null,
      };
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

    function pickFromList(list, requiredChars, preferLarger, avoidPaperUrl, strictCapacity) {
      if (!list || !list.length) return null;
      var filtered = list.filter(function (entry) {
        return typeof entry.capacity === "number" && entry.capacity >= requiredChars;
      });
      var candidates;
      if (filtered.length) {
        candidates = filtered;
      } else if (strictCapacity) {
        // When strictCapacity is true, don't fall back to undersized papers;
        // signal failure so we can search other pools (spent, rehydrated).
        return null;
      } else {
        candidates = list.slice();
      }
      if (avoidPaperUrl) {
        candidates = candidates.filter(function (e) { return e.paperUrl !== avoidPaperUrl; });
        if (!candidates.length) {
          if (filtered.length && !strictCapacity) {
            candidates = filtered;
          } else if (!strictCapacity) {
            candidates = list.slice();
          } else {
            return null;
          }
        }
      }
      if (!candidates.length) return null;
      if (preferLarger) {
        // First, try to find papers with significantly more capacity than the
        // current text requires, so long notes land on comfortably large pages
        // when the pool still has variety.
        var targetChars = requiredChars * PREFERRED_CAPACITY_RATIO;
        var oversize = candidates.filter(function (entry) {
          return typeof entry.capacity === "number" && entry.capacity >= targetChars;
        });
        var pool = oversize.length ? oversize : candidates;
        pool.sort(function (a, b) {
          return (b.capacity || 0) - (a.capacity || 0);
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
      ensure(sideKey);
      // For larger-paper requests, be strict about capacity in the current
      // pool so we can fall back to spent/rehydrated pools when only very
      // small notes remain.
      var entry = pickFromList(
        available[sideKey],
        needChars,
        preferLargerPaper,
        avoidPaperUrl,
        !!preferLargerPaper
      );
      if (entry) {
        removeEntry(available[sideKey], entry);
        spent[sideKey].push(entry);
        if (!available[sideKey].length) {
          hydrateside(sideKey);
        }
        return entry;
      }
      // Try spent pool next; allow best-available even if slightly undersized.
      entry = pickFromList(spent[sideKey], needChars, true, avoidPaperUrl, false);
      if (entry) {
        console.log(LOG_PREFIX, "reusing spent paper", entry.paperUrl, sideKey);
        return entry;
      }
      hydrateside(sideKey);
      // Final fallback: pick the best from a freshly hydrated pool.
      return pickFromList(available[sideKey], needChars, true, avoidPaperUrl, false);
    }

    function snapshot(list) {
      return list.map(function (entry) {
        return {
          paperUrl: entry.paperUrl,
          capacity: entry.capacity,
          lines: entry.lines,
          charsPerLine: entry.charsPerLine,
        };
      });
    }

    function getState() {
      return {
        available: {
          left: snapshot(available.left || []),
          right: snapshot(available.right || []),
        },
        spent: {
          left: snapshot(spent.left || []),
          right: snapshot(spent.right || []),
        },
      };
    }

    return {
      reserve: reserve,
      getState: getState,
      reset: hydrateside,
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
    notePages = notePages || global.notePages;
    if (!notePages || !job || !job.text) return Promise.resolve();
    var side = job.side === "right" ? "right" : "left";
    var text = String(job.text);
    if (!text.trim()) return Promise.resolve();
    if (text.length > LONG_NOTE_THRESHOLD) {
      console.info(LOG_PREFIX, "Long note candidate", { side: side, length: text.length });
    }
    var decision = notePages.need_new_note(side, text) || { needNew: true };
    var writeStep = Promise.resolve();
    if (decision.needNew) {
      var currentPaperUrl = (notePages.getCurrentPaperUrl && notePages.getCurrentPaperUrl(side)) || null;
      var selection = allocator.reserve(side, text.length, !!decision.preferLargerPaper, { avoidPaperUrl: currentPaperUrl });
      var noteOptions = { avoidPaperUrl: currentPaperUrl };
      if (selection && selection.paperUrl) {
        noteOptions.paperUrl = selection.paperUrl;
      } else if (decision.preferLargerPaper) {
        noteOptions.preferLargerPaper = true;
      }
      writeStep = Promise.resolve(notePages.write_new_note(side, noteOptions));
    }
    return writeStep.then(function () {
      return notePages.write_on_current_note(side, text, job.writeOptions || {});
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

  global.NoteQueueManager = manager;
})(typeof window !== "undefined" ? window : this);
