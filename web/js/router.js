(function () {
  "use strict";

  var ROUTE_PATHS = {
    intro: "/",
    chat: "/q",
    poem: "/p",
    privacy: "/privacy",
  };

  var ROUTE_TITLES = {
    intro: "Existential Detective Agency",
    chat: "Chat | Existential Detective Agency",
    poem: "Poem | Existential Detective Agency",
    privacy: "Privacy notice | Existential Detective Agency",
  };

  var routeNodes = {
    intro: null,
    chat: null,
    poem: null,
    privacy: null,
  };

  var routerInitialized = false;
  var activeRoute = null;
  var chatBootstrapped = false;
  var poemBootstrapped = false;
  var missingRouteModal = null;
  var missingRouteCloseButton = null;
  var missingRouteHomeLink = null;
  var missingRouteNoticePending = false;

  function initRouter() {
    if (routerInitialized) return;
    routerInitialized = true;
    cacheRouteNodes();
    handleLegacyHash();
    window.addEventListener("popstate", handleLocationChange);
    document.addEventListener("click", handleLinkClick);
    handleLocationChange();
  }

  function cacheRouteNodes() {
    routeNodes.intro = document.getElementById("route-intro");
    routeNodes.chat = document.getElementById("route-chat");
    routeNodes.poem = document.getElementById("route-poem");
    routeNodes.privacy = document.getElementById("route-privacy");
    cacheMissingRouteModal();
  }

  function handleLegacyHash() {
    var hash = window.location.hash;
    if (hash && hash.indexOf("#/") === 0) {
      var target = normalizePath(hash.slice(1));
      replacePath(target);
      window.location.hash = "";
    } else {
      var normalized = normalizePath(window.location.pathname);
      if (normalized !== window.location.pathname) {
        replacePath(normalized);
      }
    }
  }

  function handleLocationChange() {
    var normalizedPath = normalizePath(window.location.pathname);
    if (normalizedPath !== window.location.pathname) {
      replacePath(normalizedPath);
      return;
    }
    var nextRoute = getRouteFromPath(normalizedPath);
    activateRoute(nextRoute);
  }

  function handleLinkClick(event) {
    var anchor = event.target.closest("a[data-route-link]");
    if (!anchor) return;
    // If logo is clicked, route to /#
    if (anchor.hasAttribute('data-eda-logo')) {
      event.preventDefault();
      history.pushState({}, '', '/#');
      handleLocationChange();
      return;
    }
    var href = anchor.getAttribute("href");
    if (!href || href.indexOf("/") !== 0) return;
    var targetPath = normalizePath(href);
    if (targetPath === ROUTE_PATHS.intro && anchor.hash && anchor.hash.length > 1) {
      return; // allow same-page anchors elsewhere
    }
    event.preventDefault();
    if (targetPath === normalizePath(window.location.pathname)) {
      handleLocationChange();
      return;
    }
    history.pushState({}, "", targetPath);
    handleLocationChange();
  }

  function replacePath(path) {
    history.replaceState({}, "", path);
  }

  function normalizePath(path) {
    if (!path) return ROUTE_PATHS.intro;
    var sanitized = path.split("?")[0];
    var hash = "";
    if (sanitized.indexOf("#") !== -1) {
      hash = sanitized.slice(sanitized.indexOf("#"));
      sanitized = sanitized.split("#")[0];
    }
    var lower = sanitized.toLowerCase();
    if (lower === "/" || lower === "") {
      if (hash === "#" || hash === "#/" || hash === "#menu") {
        return ROUTE_PATHS.intro; // treat /# as menu
      }
      return ROUTE_PATHS.intro;
    }
    if (lower === "/index.html") return ROUTE_PATHS.intro;
    if (lower === ROUTE_PATHS.chat) return ROUTE_PATHS.chat;
    if (lower === ROUTE_PATHS.poem) return ROUTE_PATHS.poem;
    if (lower === ROUTE_PATHS.privacy) return ROUTE_PATHS.privacy;
    if (lower && lower !== "/") {
      missingRouteNoticePending = true;
    }
    return ROUTE_PATHS.intro;
  }

  function getRouteFromPath(path) {
    switch (path) {
      case "/q":
        return "chat";
      case "/p":
        return "poem";
      case "/privacy":
        return "privacy";
      case "/":
      default:
        return "intro";
    }
  }

  function activateRoute(routeKey) {
    hideMissingRouteModal();
    var globalAboutModal = document.querySelector("[data-poem-about-modal]");
    if (globalAboutModal) {
      globalAboutModal.setAttribute("hidden", "hidden");
    }
    if (!routeNodes[routeKey]) {
      console.warn("[router] Route node missing for", routeKey);
      return;
    }
    var previousRoute = activeRoute;
    Object.keys(routeNodes).forEach(function (key) {
      var node = routeNodes[key];
      if (!node) return;
      if (key === routeKey) {
        node.classList.add("route--active");
        node.classList.remove("route--hidden");
      } else {
        node.classList.remove("route--active");
        node.classList.add("route--hidden");
      }
    });
    updateDocumentTitle(routeKey);
    handleLifecycle(previousRoute, routeKey);
    activeRoute = routeKey;
    if (routeKey === "privacy") {
      window.scrollTo(0, 0);
    }
    maybeRevealMissingRouteModal();
  }

  function handleLifecycle(previousRoute, nextRoute) {
    if (previousRoute === "chat" && nextRoute !== "chat") {
      safeInvoke(window.hideChat);
    }
    if (previousRoute === "poem" && nextRoute !== "poem") {
      safeInvoke(window.hidePoem);
    }

    if (nextRoute === "chat") {
      if (!chatBootstrapped) {
        chatBootstrapped = true;
        safeInvoke(window.initChat);
      }
      safeInvoke(window.showChat);
    }

    if (nextRoute === "poem") {
      if (!poemBootstrapped) {
        poemBootstrapped = true;
        safeInvoke(window.initPoem);
      }
      safeInvoke(window.showPoem);
    }

    if (nextRoute === "privacy") {
      safeInvoke(window.initPrivacyNoticeRoute);
    }
  }

  function updateDocumentTitle(routeKey) {
    var nextTitle = ROUTE_TITLES[routeKey] || ROUTE_TITLES.intro;
    document.title = nextTitle;
  }

  function safeInvoke(fn) {
    if (typeof fn === "function") {
      try {
        fn();
      } catch (error) {
        console.error("[router] lifecycle error", error);
      }
    }
  }

  function cacheMissingRouteModal() {
    missingRouteModal = document.querySelector("[data-missing-route-modal]");
    missingRouteCloseButton = document.querySelector("[data-missing-route-close]");
    missingRouteHomeLink = document.querySelector("[data-missing-route-home]");

    if (missingRouteCloseButton) {
      missingRouteCloseButton.addEventListener("click", hideMissingRouteModal);
    }

    if (missingRouteHomeLink) {
      missingRouteHomeLink.addEventListener("click", hideMissingRouteModal);
    }

    if (missingRouteModal) {
      missingRouteModal.addEventListener("click", function (event) {
        if (event.target === missingRouteModal) {
          hideMissingRouteModal();
        }
      });
    }
  }

  function maybeRevealMissingRouteModal() {
    if (!missingRouteNoticePending) return;
    missingRouteNoticePending = false;
    showMissingRouteModal();
  }

  function showMissingRouteModal() {
    if (!missingRouteModal) return;
    missingRouteModal.removeAttribute("hidden");
    document.addEventListener("keydown", handleMissingRouteEsc, true);
  }

  function hideMissingRouteModal() {
    if (!missingRouteModal) return;
    if (missingRouteModal.hasAttribute("hidden")) return;
    missingRouteModal.setAttribute("hidden", "hidden");
    document.removeEventListener("keydown", handleMissingRouteEsc, true);
  }

  function handleMissingRouteEsc(event) {
    if (event.key === "Escape") {
      hideMissingRouteModal();
    }
  }

  window.initRouter = initRouter;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRouter);
  } else {
    initRouter();
  }
})();
