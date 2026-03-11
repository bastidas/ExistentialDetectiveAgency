(function () {
  "use strict";

  var chatState = {
    initialized: false,
    routeNode: null,
  };

  function initChat() {
    if (chatState.initialized) return;
    var bootstrap = window.EDAChatBootstrap;
    if (typeof bootstrap === "function") {
      bootstrap();
      chatState.initialized = true;
    } else {
      console.error("[chat] Missing EDAChatBootstrap binding; chat cannot start.");
    }
  }

  function showChat() {
    var node = getRouteNode();
    if (node) {
      node.classList.remove("route--hidden");
      node.setAttribute("aria-hidden", "false");
    }
    document.body.dataset.chatVisible = "true";
    if (window.EDAMessageUI && typeof window.EDAMessageUI.runBlankChatIntro === "function") {
      window.EDAMessageUI.runBlankChatIntro();
    }
  }

  function hideChat() {
    var node = getRouteNode();
    if (node) {
      node.setAttribute("aria-hidden", "true");
    }
    delete document.body.dataset.chatVisible;
  }

  function getRouteNode() {
    if (!chatState.routeNode) {
      chatState.routeNode = document.getElementById("route-chat");
    }
    return chatState.routeNode;
  }

  window.initChat = initChat;
  window.showChat = showChat;
  window.hideChat = hideChat;
})();
