/**
 * Build Mermaid source for chat scenario lab from orchestration JSON (matches XState machines).
 * Avoids characters that break Mermaid (underscores in unquoted math, etc.).
 */
(function (global) {
  "use strict";

  var NARR_STAGES = [
    "Exposition",
    "Rising Action",
    "Climax",
    "Falling Action",
    "Denouement",
    "Coda",
  ];

  function classDef() {
    return [
      "classDef active fill:#3d5a45,stroke:#c9a227,stroke-width:3px,color:#e8e4dc",
      "classDef inactive fill:#1a1816,stroke:#3a3630,color:#7a756c",
      "classDef note fill:#2a2418,stroke:#554a38,color:#a39d90,stroke-dasharray: 4 3",
    ].join("\n  ");
  }

  /**
   * chatMachine: parallel dossier | agent | visit
   * @param {object|null} orch
   */
  function buildChat(orch) {
    var c = orch && orch.chat;
    var v = c && c.value;
    var lines = ["flowchart TB", "  " + classDef()];
    var classes = [];
    var active = [];

    lines.push('  subgraph cgD["dossier"]');
    lines.push('    cDnone["none"]');
    lines.push('    cDpres["present"]');
    lines.push("  end");
    lines.push('  subgraph cgA["agent"]');
    lines.push('    cAatt["attache"]');
    lines.push('    cAdet["detective"]');
    lines.push("  end");
    lines.push('  subgraph cgV["visit"]');
    lines.push('    cVid["idle"]');
    lines.push('    subgraph cgTA["timeAway"]');
    lines.push('      cVbr["brief"]');
    lines.push('      cVmo["moderate"]');
    lines.push('      cVlo["long"]');
    lines.push('      cVst["stale"]');
    lines.push("    end");
    lines.push("  end");

    if (!v || typeof v !== "object") {
      lines.push('  cHint["no snapshot"]:::note');
      lines.push("  class cHint note");
      return lines.join("\n");
    }

    var dossier = v.dossier;
    var agent = v.agent;
    var visit = v.visit;

    if (dossier === "none") active.push("cDnone");
    else if (dossier === "present") active.push("cDpres");

    if (agent === "attache") active.push("cAatt");
    else if (agent === "detective") active.push("cAdet");

    if (visit === "idle") {
      active.push("cVid");
    } else if (visit && typeof visit === "object" && visit.timeAway) {
      var t = String(visit.timeAway);
      if (t === "brief") active.push("cVbr");
      else if (t === "moderate") active.push("cVmo");
      else if (t === "long") active.push("cVlo");
      else if (t === "stale") active.push("cVst");
    }

    [
      "cDnone",
      "cDpres",
      "cAatt",
      "cAdet",
      "cVid",
      "cVbr",
      "cVmo",
      "cVlo",
      "cVst",
    ].forEach(function (id) {
      var on = active.indexOf(id) >= 0;
      lines.push("  class " + id + " " + (on ? "active" : "inactive"));
    });

    return lines.join("\n");
  }

  /**
   * attacheOrchestratorMachine: intro | exploring | baseline1-3 | closing
   * @param {object|null} orch
   */
  function buildAttache(orch) {
    var a = orch && orch.attache;
    var st = a && a.attacheState;
    var phase = st && st.phase ? String(st.phase) : "";
    var lines = ["flowchart LR", "  " + classDef()];
    var map = {
      start: "aIntro",
      explore: "aExp",
      baseline1: "aB1",
      baseline2: "aB2",
      baseline3: "aB3",
      close: "aCls",
    };
    var qLabel = "Q index —";
    if (st && phase) {
      var isBaseline = phase === "baseline1" || phase === "baseline2" || phase === "baseline3";
      var qi = st.question_index;
      var nq = st.n_questions_in_baseline;
      var qiNum = typeof qi === "number" && qi >= 0 ? qi : 0;
      var nNum = typeof nq === "number" && nq > 0 ? nq : 0;
      if (isBaseline && nNum > 0) {
        qLabel = "Q index " + qiNum + " of " + nNum;
      } else if (isBaseline) {
        qLabel = "Q index " + qiNum + " (n?)";
      } else {
        qLabel = "Q index n/a";
      }
    }
    lines.push('  subgraph att["attacheOrchestrator"]');
    lines.push('    aIntro["intro"]');
    lines.push('    aExp["exploring"]');
    lines.push('    aB1["baseline1"]');
    lines.push('    aB2["baseline2"]');
    lines.push('    aB3["baseline3"]');
    lines.push('    aCls["closing"]');
    lines.push('    aQidx["' + qLabel + '"]:::note');
    lines.push("  end");

    var ids = ["aIntro", "aExp", "aB1", "aB2", "aB3", "aCls"];
    var activeId = phase ? map[phase] || "" : "";

    if (!st || !phase) {
      lines.push('  aHint["no attaché session"]:::note');
      lines.push("  class aHint note");
    }

    ids.forEach(function (id) {
      lines.push("  class " + id + " " + (id === activeId ? "active" : "inactive"));
    });
    lines.push("  class aQidx note");

    return lines.join("\n");
  }

  /**
   * detectiveMachine: single state active + context existentialTherapyPhase
   */
  function buildDetective(orch) {
    var d = orch && orch.detective;
    var phase = d && d.existentialTherapyPhase ? String(d.existentialTherapyPhase) : "";
    var lines = ["flowchart TB", "  " + classDef()];
    lines.push('  subgraph det["detectiveOrchestrator"]');
    lines.push('    dAct["state active"]');
    lines.push("  end");
    lines.push('  subgraph eth["existentialTherapyPhase context"]');
    lines.push('    dIni["initial"]');
    lines.push('    dMid["middle"]');
    lines.push('    dFin["final"]');
    lines.push("  end");

    if (!d || !d.hasPersistedSnapshot) {
      lines.push('  dHint["no detective orchestrator snapshot"]:::note');
      lines.push("  class dHint note");
      lines.push("  class dAct,dIni,dMid,dFin inactive");
      return lines.join("\n");
    }

    lines.push("  class dAct active");
    var p = phase === "middle" || phase === "final" ? phase : "initial";
    var ep = p === "initial" ? "dIni" : p === "middle" ? "dMid" : "dFin";
    ["dIni", "dMid", "dFin"].forEach(function (id) {
      lines.push("  class " + id + " " + (id === ep ? "active" : "inactive"));
    });

    return lines.join("\n");
  }

  /**
   * philosophersNarrativeMachine: state active + narrative arc from turn index
   */
  function buildPhilosophers(orch) {
    var p = orch && orch.philosophers;
    var lines = ["flowchart LR", "  " + classDef()];
    lines.push('  subgraph phx["philosophersNarrative"]');
    lines.push('    pAct["state active"]');
    lines.push("  end");
    lines.push('  subgraph arc["narrative arc"]');

    var activeLabel = p && p.narrative_phase ? String(p.narrative_phase) : "";
    var nodes = [];
    NARR_STAGES.forEach(function (label, i) {
      var id = "pN" + i;
      nodes.push(id);
      var short = label.length > 16 ? label.slice(0, 14) + ".." : label;
      lines.push("    " + id + '["' + short + '"]');
    });
    lines.push("  end");

    if (!p || !p.hasPersistedSnapshot) {
      lines.push('  pHint["no philosopher snapshot"]:::note');
      lines.push("  class pHint note");
      lines.push("  class pAct inactive");
      nodes.forEach(function (id) {
        lines.push("  class " + id + " inactive");
      });
      return lines.join("\n");
    }

    lines.push("  class pAct active");
    NARR_STAGES.forEach(function (label, i) {
      var id = "pN" + i;
      var on = label === activeLabel;
      lines.push("  class " + id + " " + (on ? "active" : "inactive"));
    });

    return lines.join("\n");
  }

  function buildAll(orch) {
    return {
      chat: buildChat(orch),
      attache: buildAttache(orch),
      detective: buildDetective(orch),
      philosophers: buildPhilosophers(orch),
    };
  }

  /**
   * Build only the diagram sources needed for visible slots (e.g. attaché-only vs routing band).
   * @param {object|null} orch
   * @param {string[]} keys — e.g. ["attache"] or ["chat","detective","philosophers"]
   */
  function buildForKeys(orch, keys) {
    var all = buildAll(orch);
    var out = {};
    (keys || []).forEach(function (k) {
      out[k] = all[k] || "";
    });
    return out;
  }

  global.EDAChatScenarioDiagrams = {
    buildAll: buildAll,
    buildForKeys: buildForKeys,
  };
})(typeof window !== "undefined" ? window : globalThis);
