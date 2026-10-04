(function () {
  "use strict";

  var PRIVACY_MD_PATH = "content/privacy-notice.md";
  var fetched = false;
  var loading = false;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatInline(text) {
    var links = [];
    var s = String(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
      links.push({ label: label, href: href });
      return "§§" + (links.length - 1) + "§§";
    });
    s = escapeHtml(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    for (var i = 0; i < links.length; i++) {
      s = s.replace(
        "§§" + i + "§§",
        '<a href="' + escapeHtml(links[i].href) + '">' + escapeHtml(links[i].label) + "</a>"
      );
    }
    return s;
  }

  function parseMarkdown(md) {
    var lines = md.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
    var html = [];
    var i = 0;
    var inUl = false;

    function closeUl() {
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
    }

    while (i < lines.length) {
      var trimmed = lines[i].trim();

      if (!trimmed) {
        closeUl();
        i++;
        continue;
      }

      if (trimmed.indexOf("## ") === 0) {
        closeUl();
        html.push("<h3>" + formatInline(trimmed.slice(3)) + "</h3>");
        i++;
        continue;
      }

      if (trimmed.indexOf("- ") === 0) {
        if (!inUl) {
          html.push("<ul>");
          inUl = true;
        }
        html.push("<li>" + formatInline(trimmed.slice(2)) + "</li>");
        i++;
        continue;
      }

      closeUl();
      var para = [trimmed];
      i++;
      while (i < lines.length) {
        var next = lines[i].trim();
        if (!next) break;
        if (next.indexOf("## ") === 0 || next.indexOf("- ") === 0) break;
        para.push(next);
        i++;
      }
      html.push("<p>" + formatInline(para.join(" ")) + "</p>");
    }
    closeUl();
    return html.join("\n");
  }

  window.initPrivacyNoticeRoute = function () {
    var root = document.getElementById("privacy-notice-md-root");
    if (!root || fetched || loading) return;
    loading = true;
    root.innerHTML = '<p class="eda-prose-loading">Loading…</p>';

    fetch(PRIVACY_MD_PATH, { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("load failed");
        return res.text();
      })
      .then(function (text) {
        root.innerHTML = parseMarkdown(text.trim());
        root.classList.add("eda-prose");
        fetched = true;
      })
      .catch(function () {
        root.innerHTML =
          '<p class="eda-prose-error">The privacy notice could not be loaded. You may refresh the page or return to the menu.</p>';
      })
      .finally(function () {
        loading = false;
      });
  };
})();
