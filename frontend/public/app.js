(function () {
  (function debugOnLoad() {
    fetch("/api/debug", { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        if (!d) return;
        console.log("[DEBUG] Model:", d.model);
        console.log("[DEBUG] Service tier:", d.serviceTier);
        console.log("[DEBUG] Prompt file first 5 lines:", d.promptPreview);
        console.log("[DEBUG] Your exchange count (this session):", (d.userExchangeCount ?? 0) + "/" + (d.maxUserExchanges ?? 5));
        console.log("[DEBUG] Daily usage:", d.dailyCount + " / " + (d.maxDailyUsage ?? 100));
      })
      .catch(function () {});
  })();

  const form = document.getElementById("form");
  const input = document.getElementById("input");
  const messages = document.getElementById("messages");
  const status = document.getElementById("status");
  const submitBtn = document.getElementById("submit");

  function setStatus(text, isError) {
    status.textContent = text;
    status.className = "status " + (isError ? "error" : "");
  }

  function addMessage(role, text) {
    const div = document.createElement("div");
    div.className = "message " + role;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = role === "user" ? "You" : "Assistant";
    const content = document.createElement("div");
    content.className = "content";
    content.textContent = text;
    div.appendChild(label);
    div.appendChild(content);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    addMessage("user", message);
    input.value = "";
    submitBtn.disabled = true;
    setStatus("Thinking…");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message }),
      });

      if (res.status === 204) {
        setStatus("");
        console.log("[DEBUG] no response");
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const kind = data.errorKind || (res.status === 429 ? "rate_limit" : "");
        const displayMsg =
          kind === "flex_busy"
            ? "Service busy (Flex). Please try again in a moment."
            : kind === "rate_limit"
              ? "Too many requests. Please try again later."
              : kind === "bad_request"
                ? (data.error || "Invalid request. Check your message and try again.")
                : (data.error || "Something went wrong. Please try again.");
        setStatus(displayMsg, true);
        addMessage("assistant", displayMsg);
        return;
      }

      setStatus("");
      if (data.debug) {
        console.log("[DEBUG] user exchanges:", data.debug.userExchanges + "/" + data.debug.maxUserExchanges);
        console.log("[DEBUG] daily usage:", data.debug.dailyUsage + "/" + data.debug.maxDailyUsage);
      }
      addMessage("assistant", data.reply || "(No reply)");
    } catch (err) {
      setStatus("Network error: " + err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
