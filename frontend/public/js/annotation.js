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

  function wrapAnnotationKeywords(text) {
    if (!text) return "";
    var escaped = EDAUtils.escapeHtml(text);
    var rules = EDARules.getAnnotationRules();
    if (!rules.length) return escaped;

    var matches = rules.reduce(function (acc, rule) {
      var userText = rule.userText && rule.userText.trim();
      if (!userText) return acc;
      var re = new RegExp(
        "\\b(" + EDAUtils.escapeRegex(userText) + ")\\b",
        "gi"
      );
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

  function applyRoughNotationToKeywordSpans(contentEl, philosopher) {
    if (typeof RoughNotation === "undefined" || !RoughNotation.annotate) return;
    var spans = contentEl.querySelectorAll(".keyword-annotation");
    if (!spans.length) return;

    var settings = getOptionsForPhilosopher(philosopher);

    var annotations = Array.from(spans).map(function (span) {
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
      return RoughNotation.annotate(span, opts);
    });

    if (RoughNotation.annotationGroup && annotations.length > 0) {
      var group = RoughNotation.annotationGroup(annotations);
      group.show();
    } else {
      annotations.forEach(function (a) {
        a.show();
      });
    }
  }

  global.EDAAnnotation = {
    wrapAnnotationKeywords: wrapAnnotationKeywords,
    applyRoughNotationToKeywordSpans: applyRoughNotationToKeywordSpans,
    pickRoughTypeForMode: pickRoughTypeForMode,
  };
})(typeof window !== "undefined" ? window : this);
