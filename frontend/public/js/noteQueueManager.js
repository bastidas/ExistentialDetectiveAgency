(function (global) {
  "use strict";

  var LONG_NOTE_THRESHOLD = 350;
  var LOG_PREFIX = "[note-queue]";

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

    function pickFromList(list, requiredChars, preferLarger, avoidPaperUrl) {
      if (!list || !list.length) return null;
      var filtered = list.filter(function (entry) {
        return typeof entry.capacity === "number" && entry.capacity >= requiredChars;
      });
      var candidates = filtered.length ? filtered : list.slice();
      if (avoidPaperUrl) {
        candidates = candidates.filter(function (e) { return e.paperUrl !== avoidPaperUrl; });
        if (!candidates.length) candidates = filtered.length ? filtered : list.slice();
      }
      if (!candidates.length) return null;
      if (preferLarger) {
        candidates.sort(function (a, b) {
          return (b.capacity || 0) - (a.capacity || 0);
        });
        return candidates[0];
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
      var entry = pickFromList(available[sideKey], needChars, preferLargerPaper, avoidPaperUrl);
      if (entry) {
        removeEntry(available[sideKey], entry);
        spent[sideKey].push(entry);
        if (!available[sideKey].length) {
          hydrateside(sideKey);
        }
        return entry;
      }
      entry = pickFromList(spent[sideKey], needChars, true, avoidPaperUrl);
      if (entry) {
        console.log(LOG_PREFIX, "reusing spent paper", entry.paperUrl, sideKey);
        return entry;
      }
      hydrateside(sideKey);
      return pickFromList(available[sideKey], needChars, true, avoidPaperUrl);
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
    var pending = [];
    var running = false;
    var pauseMs = 0;

    function setPause(ms) {
      pauseMs = Math.max(0, Number(ms) || 0);
    }

    function enqueue(job) {
      return new Promise(function (resolve, reject) {
        pending.push({ job: job, resolve: resolve, reject: reject });
        drain();
      });
    }

    function drain() {
      if (running) return;
      var next = pending.shift();
      if (!next) return;
      running = true;
      executor(next.job)
        .then(function (result) {
          next.resolve(result);
          return delay(pauseMs);
        })
        .catch(function (err) {
          next.reject(err);
          return delay(pauseMs);
        })
        .then(function () {
          running = false;
          drain();
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
