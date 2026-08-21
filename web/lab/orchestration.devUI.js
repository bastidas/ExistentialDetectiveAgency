(function () {
  const statusEl = document.getElementById("orchestration-dev-status");
  const mermaidContainer = document.getElementById("orchestration-dev-mermaid");
  const tableContainer = document.getElementById("orchestration-dev-table-container");
  const promptsContainer = document.getElementById("orchestration-dev-prompts");
  const refreshPromptsBtn = document.getElementById("orchestration-dev-refresh-prompts");
  const savePromptsBtn = document.getElementById("orchestration-dev-save-prompts");

  let graphData = null;
  let scenarios = [];
  let prompts = null;
  let activeScenarioId = null;

  function showStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.display = message ? "block" : "none";
  }

  function switchTab(tab) {
    document.querySelectorAll(".tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === "tab-" + tab);
    });
  }

  function renderMermaid() {
    if (!graphData || !mermaidContainer) return;
    const source = graphData.mermaidSource || "";
    if (!source) {
      mermaidContainer.textContent = "No graph data.";
      return;
    }

    const id = "mermaid-" + Date.now();
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        mermaidContainer.innerHTML = svg;
        attachMermaidClickHandlers();
      })
      .catch((err) => {
        console.error("Mermaid render error", err);
        mermaidContainer.textContent = "Mermaid render error";
      });
  }

  function attachMermaidClickHandlers() {
    try {
      if (!graphData) {
        showStatus("No graph data available for diagram click wiring.");
        return;
      }
      if (!graphData.nodes || !graphData.nodes.length) {
        showStatus("Diagram graph has no nodes; cannot wire clicks.");
        return;
      }
      if (!mermaidContainer) {
        showStatus("Mermaid container missing; cannot wire diagram clicks.");
        return;
      }

      const svgRoot = mermaidContainer.querySelector("svg");
      if (!svgRoot) {
        showStatus("Diagram SVG not found for click wiring.");
        return;
      }

      // Mermaid's SVG may use <text>, <tspan>, or other elements to hold
      // label text. Treat any element whose direct child is a text node as
      // a candidate label.
      const allNodes = Array.from(svgRoot.querySelectorAll("*"));
      const texts = allNodes.filter((n) => {
        if (!n.childNodes || n.childNodes.length !== 1) return false;
        const child = n.firstChild;
        return child && child.nodeType === 3 && (n.textContent || "").trim();
      });
      if (!texts.length) {
        showStatus("Diagram rendered but no text-bearing SVG elements were found for wiring.");
        return;
      }

      // Map rendered text labels to scenario ids.
      const scenarioIdSet = new Set((scenarios || []).map((row) => row.id));
      const nodeLabelToScenario = new Map();

      (graphData.nodes || []).forEach((node) => {
        if (!node.scenarioId) return;
        const lbl = (node.label || node.id || "").trim();
        if (!lbl) return;
        nodeLabelToScenario.set(lbl, node.scenarioId);
      });

      const clickableLabels = [];

      texts.forEach((t) => {
        const raw = t.textContent || "";
        const label = raw.trim();
        if (!label) return;

        let scenarioId = null;
        if (scenarioIdSet.has(label)) {
          scenarioId = label;
        } else if (nodeLabelToScenario.has(label)) {
          scenarioId = nodeLabelToScenario.get(label);
        }
        if (!scenarioId) return;

        const target = t.parentNode || t;
        target.style.cursor = "pointer";
        target.style.pointerEvents = "auto";
        // Make clickable labels visually distinct.
        try {
          t.style.fill = "#0050b3";
          t.style.textDecoration = "underline";
        } catch (_) {}
        clickableLabels.push(label);
        target.addEventListener("click", () => {
          activeScenarioId = scenarioId;
          switchTab("states");
          renderTable();
          // After re-rendering, scroll the highlighted row into view so
          // the diagram click "jumps" to the corresponding scenario.
          try {
            const row = tableContainer.querySelector(
              'tr[data-scenario-id="' + scenarioId + '"]'
            );
            if (row && typeof row.scrollIntoView === "function") {
              row.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          } catch (_) {}
        });
      });

      if (clickableLabels.length) {
        // Keep the status minimal now that wiring is stable.
        showStatus("Diagram clicks enabled; click a node to jump to its row.");
      } else {
        showStatus("Diagram rendered but no labels matched scenarios for clicking.");
      }
    } catch (err) {
      console.error("Error wiring diagram clicks", err);
      showStatus("Error wiring diagram clicks: " + (err && err.message ? err.message : "unknown"));
    }
  }

  function renderTable() {
    if (!tableContainer) return;
    if (!scenarios || !scenarios.length) {
      tableContainer.textContent = "No scenarios.";
      return;
    }
    const table = document.createElement("table");
    table.className = "orchestration-dev-table";
    const thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th>id</th><th>phase_before</th><th>phase_before_close</th><th>next_phase_hint</th><th>description</th><th>turn_instruction</th></tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");

    scenarios.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.id === activeScenarioId) {
        tr.classList.add("active");
      }
      tr.dataset.scenarioId = row.id;
      // For dev display, strip a leading phase marker like "(explore) "
      // from turn_instruction so the core content is easier to read.
      let displayTurn = row.turn_instruction || "";
      displayTurn = displayTurn.replace(/^\([^)]*\)\s*/, "");
      const cells = [
        row.id,
        row.phase_before,
        row.phase_before_close,
        row.next_phase_hint,
        row.description,
        displayTurn,
      ];
      cells.forEach((value, idx) => {
        const td = document.createElement("td");
        td.textContent = value || "";
        // Keep row-selection behavior only on the id cell so the
        // rest of the row is easy to text-select without re-rendering.
        if (idx === 0) {
          td.style.cursor = "pointer";
          td.addEventListener("click", () => {
            activeScenarioId = row.id;
            renderTable();
          });
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableContainer.innerHTML = "";
    tableContainer.appendChild(table);
  }

  function renderPrompts() {
    if (!promptsContainer) return;
    if (!prompts) {
      promptsContainer.textContent = "No prompt data.";
      return;
    }
    promptsContainer.innerHTML = "";

    function autosizeTextarea(ta) {
      if (!ta) return;
      ta.style.overflowY = "hidden";
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }

    function addField(keyPath, label, value) {
      const group = document.createElement("div");
      group.className = "field-group";
      const id = "prompt-" + keyPath.replace(/\./g, "-");
      const lab = document.createElement("label");
      lab.setAttribute("for", id);
      lab.textContent = label;
      const ta = document.createElement("textarea");
      ta.id = id;
      ta.value = value != null ? String(value) : "";
      ta.dataset.keyPath = keyPath;
      ta.addEventListener("input", () => autosizeTextarea(ta));
      group.appendChild(lab);
      group.appendChild(ta);
      promptsContainer.appendChild(group);
      // Initial size to fit content with no vertical scrollbar.
      autosizeTextarea(ta);
    }

    const t = prompts.transitions || {};

    // Phase-level instructions: phase_instructions.*
    if (t.phase_instructions && typeof t.phase_instructions === "object") {
      Object.keys(t.phase_instructions).forEach((phase) => {
        addField(
          `transitions.phase_instructions.${phase}`,
          `transitions.phase_instructions.${phase}`,
          t.phase_instructions[phase] || ""
        );
      });
    }

    // Baseline phase intro sentences: phase_intro_sentences.*
    if (t.phase_intro_sentences && typeof t.phase_intro_sentences === "object") {
      Object.keys(t.phase_intro_sentences).forEach((phase) => {
        addField(
          `transitions.phase_intro_sentences.${phase}`,
          `transitions.phase_intro_sentences.${phase}`,
          t.phase_intro_sentences[phase] || ""
        );
      });
    }

    // Shared scaffolding
    if (t.shared && typeof t.shared.start_baseline_prefix === "string") {
      addField(
        "transitions.shared.start_baseline_prefix",
        "transitions.shared.start_baseline_prefix",
        t.shared.start_baseline_prefix
      );
    }
    if (t.shared && typeof t.shared.present_question_unless === "string") {
      addField(
        "transitions.shared.present_question_unless",
        "transitions.shared.present_question_unless",
        t.shared.present_question_unless
      );
    }

    const tt = t.transitions || {};

    // Start-phase turn template
    if (tt.start && typeof tt.start.turn === "string") {
      addField(
        "transitions.transitions.start.turn",
        "transitions.transitions.start.turn",
        tt.start.turn
      );
    }

    // Explore templates
    if (tt.explore && typeof tt.explore.turn === "string") {
      addField(
        "transitions.transitions.explore.turn",
        "transitions.transitions.explore.turn",
        tt.explore.turn
      );
    }
    if (tt.explore && typeof tt.explore.resume_from_phase === "string") {
      addField(
        "transitions.transitions.explore.resume_from_phase",
        "transitions.transitions.explore.resume_from_phase",
        tt.explore.resume_from_phase
      );
    }
    if (tt.explore && typeof tt.explore.resume_from_start === "string") {
      addField(
        "transitions.transitions.explore.resume_from_start",
        "transitions.transitions.explore.resume_from_start",
        tt.explore.resume_from_start
      );
    }
    if (tt.explore && typeof tt.explore.close_suffix === "string") {
      addField(
        "transitions.transitions.explore.close_suffix",
        "transitions.transitions.explore.close_suffix",
        tt.explore.close_suffix
      );
    }

    // Baseline phases templates
    if (tt.baseline_phases && typeof tt.baseline_phases.phase_start === "string") {
      addField(
        "transitions.transitions.baseline_phases.phase_start",
        "transitions.transitions.baseline_phases.phase_start",
        tt.baseline_phases.phase_start
      );
    }
    if (tt.baseline_phases && typeof tt.baseline_phases.mid === "string") {
      addField(
        "transitions.transitions.baseline_phases.mid",
        "transitions.transitions.baseline_phases.mid",
        tt.baseline_phases.mid
      );
    }

    // Close-phase templates
    if (tt.close && typeof tt.close.from_phase3 === "string") {
      addField(
        "transitions.transitions.close.from_phase3",
        "transitions.transitions.close.from_phase3",
        tt.close.from_phase3
      );
    }
    if (tt.close && typeof tt.close.generic === "string") {
      addField(
        "transitions.transitions.close.generic",
        "transitions.transitions.close.generic",
        tt.close.generic
      );
    }
  }

  function collectPromptEdits() {
    const fields = promptsContainer.querySelectorAll("textarea[data-key-path]");
    const baseQuestions =
      prompts && prompts.questions ? JSON.parse(JSON.stringify(prompts.questions)) : {};
    const baseTransitions =
      prompts && prompts.transitions ? JSON.parse(JSON.stringify(prompts.transitions)) : {};
    const next = { questions: baseQuestions, transitions: baseTransitions };

    function setDeep(obj, path, value) {
      const parts = path.split(".");
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
        cur = cur[key];
      }
      cur[parts[parts.length - 1]] = value;
    }

    fields.forEach((ta) => {
      const keyPath = ta.dataset.keyPath;
      const value = ta.value;
      if (keyPath.startsWith("questions.")) {
        setDeep(next.questions, keyPath.slice("questions.".length), value);
      } else if (keyPath.startsWith("transitions.")) {
        setDeep(next.transitions, keyPath.slice("transitions.".length), value);
      }
    });

    return next;
  }

  async function loadAll() {
    try {
      // Show an explicit loading message so it's obvious when
      // the dev UI script is running, even before API calls succeed.
      showStatus("Loading dev orchestration data...");
      const [graphRes, scenariosRes, promptsRes] = await Promise.all([
        fetch("/api/orchestration/dev/graph"),
        fetch("/api/orchestration/dev/scenarios"),
        fetch("/api/orchestration/dev/prompts"),
      ]);
      if (!graphRes.ok || !scenariosRes.ok || !promptsRes.ok) {
        showStatus("Dev orchestration API not available (ensure DEV=1).");
        return;
      }
      graphData = await graphRes.json();
      const scenariosJson = await scenariosRes.json();
      scenarios = scenariosJson.scenarios || [];
      prompts = await promptsRes.json();
      // At this point the backend responded; if the banner stays stuck on
      // "Loading..." it can be confusing, so update it before rendering.
      showStatus("Dev data loaded; rendering diagram and table...");
      renderMermaid();
      renderTable();
      renderPrompts();
    } catch (err) {
      console.error(err);
      showStatus("Error loading dev orchestration data.");
    }
  }

  async function savePrompts() {
    try {
      const payload = collectPromptEdits();
      const res = await fetch("/api/orchestration/dev/prompts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        showStatus("Error saving prompts.");
        return;
      }
      prompts = await res.json();
      showStatus("Prompts saved.");
      renderPrompts();
    } catch (err) {
      console.error(err);
      showStatus("Error saving prompts.");
    }
  }

  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });

  if (refreshPromptsBtn) {
    refreshPromptsBtn.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/orchestration/dev/prompts");
        if (!res.ok) {
          showStatus("Error reloading prompts.");
          return;
        }
        prompts = await res.json();
        renderPrompts();
      } catch (err) {
        console.error(err);
        showStatus("Error reloading prompts.");
      }
    });
  }

  if (savePromptsBtn) {
    savePromptsBtn.addEventListener("click", savePrompts);
  }

  loadAll();
})();
