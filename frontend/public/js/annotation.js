(function (global) {
  "use strict";

  var config = global.AnnotationConfig || {};
  var DEFAULT_COLOR = config.ANNOTATION_DEFAULT_COLOR != null ? config.ANNOTATION_DEFAULT_COLOR : "#5452ad";
  var MODE_TO_TYPES = config.ANNOTATION_MODE_TO_TYPES || {
    keyword: ["circle", "box", "underline"],
    highlight: ["highlight", "bracket"],
    strike: ["strike-through", "crossed-off"],
  };
  var ANNOTATION_PHILOSOPHER_SETTINGS = config.ANNOTATION_PHILOSOPHER_SETTINGS || {
    left: { animationDuration: 700, strokeWidth: 1, padding: 5, iterations: 2, bracketSides: ["left", "right"], keywordColors: ["#5452ad"], highlightColors: ["#5452ad"], strikeColors: ["#5452ad"] },
    right: { animationDuration: 800, strokeWidth: 1.5, padding: 5, iterations: 2, bracketSides: ["right", "left"], keywordColors: ["#284283"], highlightColors: ["#284283"], strikeColors: ["#284283"] },
  };

  function pickColor(colors) {
    if (!colors || !colors.length) return DEFAULT_COLOR;
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function getOptionsForPhilosopher(philosopher) {
    var key = philosopher === "right" ? "right" : "left";
    return ANNOTATION_PHILOSOPHER_SETTINGS[key] || ANNOTATION_PHILOSOPHER_SETTINGS.left;
  }

  function pickRoughTypeForMode(mode) {
    var types = MODE_TO_TYPES[mode];
    if (!types || !types.length) return "underline";
    return types[Math.floor(Math.random() * types.length)];
  }

  /** Shared word-boundary regex for a phrase (used by both initial wrap and incremental add to avoid drift). */
  function wordBoundaryRegex(phrase) {
    var escaped = (typeof EDAUtils !== "undefined" && EDAUtils.escapeRegex)
      ? EDAUtils.escapeRegex(phrase)
      : String(phrase).replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp("\\b(" + escaped + ")\\b", "gi");
  }

  function wrapAnnotationKeywords(text, options) {
    if (!text) return "";
    var escaped = EDAUtils.escapeHtml(text);
    var rules = EDARules.getAnnotationRules();
    var extraCallouts = (options && options.extraCallouts) || [];
    if (!rules.length && !extraCallouts.length) return escaped;

    var matches = rules.reduce(function (acc, rule) {
      var userText = rule.userText && rule.userText.trim();
      if (!userText) return acc;
      var re = wordBoundaryRegex(userText);
      var match;
      while ((match = re.exec(escaped)) !== null) {
        acc.push({
          index: match.index,
          length: match[0].length,
          text: match[1],
          mode: rule.mode,
        });
      }
      return acc;
    }, []);

    var staticEnds = matches.map(function (m) {
      return { start: m.index, end: m.index + m.length };
    });
    function rangeOverlaps(start, end) {
      return staticEnds.some(function (r) {
        return start < r.end && end > r.start;
      });
    }

    extraCallouts.forEach(function (entry) {
      var userText = (entry && entry.userText != null)
        ? String(entry.userText).trim()
        : (Array.isArray(entry) && entry.length >= 2)
          ? String(entry[0]).trim()
          : "";
      var mode = (entry && entry.mode != null)
        ? String(entry.mode).toLowerCase()
        : (Array.isArray(entry) && entry.length >= 2)
          ? String(entry[1]).toLowerCase()
          : "";
      if (!userText || !mode) return;
      if (mode !== "keyword" && mode !== "highlight" && mode !== "strike") return;
      var re = wordBoundaryRegex(userText);
      var match;
      while ((match = re.exec(escaped)) !== null) {
        var start = match.index;
        var end = match.index + match[0].length;
        if (!rangeOverlaps(start, end)) {
          matches.push({
            index: match.index,
            length: match[0].length,
            text: match[1],
            mode: mode,
          });
        }
      }
    });

    matches.sort(function (a, b) {
      if (a.index !== b.index) return a.index - b.index;
      return b.length - a.length;
    });

    var nonOverlapping = [];
    var lastEnd = -1;
    matches.forEach(function (m) {
      if (m.index >= lastEnd) {
        nonOverlapping.push(m);
        lastEnd = m.index + m.length;
      }
    });

    var result = "";
    var pos = 0;
    nonOverlapping.forEach(function (m) {
      result += escaped.slice(pos, m.index);
      result +=
        '<span class="keyword-annotation" data-mode="' +
        m.mode +
        '">' +
        EDAUtils.escapeHtml(m.text) +
        "</span>";
      pos = m.index + m.length;
    });
    result += escaped.slice(pos);
    return result;
  }

  /** Build RoughNotation options for one span (mode → type/color from philosopher settings). */
  function buildRoughOptsForSpan(span, settings) {
    var mode = span.getAttribute("data-mode") || "keyword";
    var type = pickRoughTypeForMode(mode);
    var color;
    if (mode === "highlight") {
      color = pickColor(settings.highlightColors);
    } else if (mode === "strike") {
      color = pickColor(settings.strikeColors);
    } else {
      color = pickColor(settings.keywordColors);
    }
    var opts = {
      type: type,
      color: color,
      animate: true,
      animationDuration: settings.animationDuration,
      strokeWidth: settings.strokeWidth,
      padding: settings.padding,
      iterations: settings.iterations,
    };
    if (type === "bracket") {
      opts.brackets = settings.bracketSides || ["left", "right"];
    }
    return opts;
  }

  /**
   * Internal: apply rough notation to an array of span elements. Optionally use annotationGroup for coordinated show.
   * @param spans - array or NodeList of .keyword-annotation elements
   * @param philosopher - "left" or "right"
   * @param useGroup - if true and RoughNotation.annotationGroup exists, show as group; else show each individually
   */
  function applyRoughToSpansInternal(spans, philosopher, useGroup) {
    if (typeof RoughNotation === "undefined" || !RoughNotation.annotate || !spans || !spans.length) return;
    var settings = getOptionsForPhilosopher(philosopher);
    var annotations = Array.from(spans).map(function (span) {
      return RoughNotation.annotate(span, buildRoughOptsForSpan(span, settings));
    });
    if (useGroup && RoughNotation.annotationGroup && annotations.length > 0) {
      RoughNotation.annotationGroup(annotations).show();
    } else {
      annotations.forEach(function (a) {
        a.show();
      });
    }
  }

  /** Apply rough notation to the given span elements (incremental/agent callouts). Uses annotationGroup so they animate sequentially like the first set. */
  function applyRoughNotationToSpans(spans, philosopher) {
    applyRoughToSpansInternal(spans, philosopher, true);
  }

  /**
   * Find phrase in content's text (word boundary), wrap each occurrence that is not already
   * inside a .keyword-annotation in a span, and return the new span elements.
   * Wraps one occurrence at a time and re-builds segments so the DOM stays consistent.
   * Uses extractContents + insertNode so we don't rely on surroundContents (which can fail when the range spans many nodes).
   */
  function addInPlaceAnnotationSpans(contentEl, phrase, mode) {
    if (!contentEl || !phrase || typeof phrase !== "string") return [];
    var trimmed = phrase.trim();
    if (!trimmed) return [];
    var modeVal = (mode && (mode === "keyword" || mode === "highlight" || mode === "strike")) ? mode : "keyword";
    var re = wordBoundaryRegex(trimmed);
    var newSpans = [];
    var match;
    while (true) {
      re.lastIndex = 0;
      var segments = [];
      var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null, false);
      var node;
      var fullLength = 0;
      while ((node = walker.nextNode())) {
        var text = node.textContent;
        if (!text) continue;
        var start = fullLength;
        fullLength += text.length;
        var insideAnnotation = !!(node.parentElement && node.parentElement.closest && node.parentElement.closest(".keyword-annotation"));
        segments.push({ node: node, start: start, end: fullLength, insideAnnotation: insideAnnotation });
      }
      var fullText = segments.map(function (s) {
        return s.node.textContent;
      }).join("");
      match = re.exec(fullText);
      if (!match) break;
      var matchStart = match.index;
      var matchEnd = match.index + match[0].length;
      var overlapsAnnotated = segments.some(function (s) {
        return s.insideAnnotation && matchStart < s.end && matchEnd > s.start;
      });
      if (overlapsAnnotated) break;
      var startNode = null;
      var startOffset = 0;
      var endNode = null;
      var endOffset = 0;
      for (var j = 0; j < segments.length; j++) {
        var seg = segments[j];
        if (startNode === null && matchStart < seg.end) {
          startNode = seg.node;
          startOffset = matchStart - seg.start;
        }
        if (endNode === null && matchEnd <= seg.end) {
          endNode = seg.node;
          endOffset = matchEnd - seg.start;
          break;
        }
      }
      if (!startNode || !endNode) break;
      try {
        var range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        var span = document.createElement("span");
        span.className = "keyword-annotation";
        span.setAttribute("data-mode", modeVal);
        var fragment = range.extractContents();
        range.insertNode(span);
        span.appendChild(fragment);
        newSpans.push(span);
      } catch (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[annotation] addInPlaceAnnotationSpans: skipped phrase (range/insert failed):", trimmed.substring(0, 40), err);
        }
        break;
      }
    }
    return newSpans;
  }

  /** Apply rough notation to all .keyword-annotation spans inside contentEl (initial render; uses annotationGroup). */
  function applyRoughNotationToKeywordSpans(contentEl, philosopher) {
    if (!contentEl) return;
    var spans = contentEl.querySelectorAll(".keyword-annotation");
    if (!spans.length) return;
    applyRoughToSpansInternal(spans, philosopher, true);
  }

  global.EDAAnnotation = {
    wrapAnnotationKeywords: wrapAnnotationKeywords,
    applyRoughNotationToKeywordSpans: applyRoughNotationToKeywordSpans,
    applyRoughNotationToSpans: applyRoughNotationToSpans,
    addInPlaceAnnotationSpans: addInPlaceAnnotationSpans,
    pickRoughTypeForMode: pickRoughTypeForMode,
  };
})(typeof window !== "undefined" ? window : this);
