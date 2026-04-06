"use strict";

const { setup, assign, createActor } = require("xstate");
const { classifyTimeAway, getTimeAwayThresholds } = require("./timeAwayClassification");
const { userHasPersistedDossier } = require("../dossier_and_summarize/dossierPresence");
const { isDossierStaleByAge } = require("../dossier_and_summarize/dossierRecency");
const { attacheOrchestratorMachine } = require("../attache/attacheMachine");
const { detectiveMachine } = require("../detective/detectiveMachine");
const { resetDetectiveExistentialPhaseForAttacheHandoff } = require("../detective/detectiveExistentialSession");
const { logChatMachineState, getDebugStateLevel } = require("../logger");

/**
 * Domain routing for the chat orchestrator. Serialized to HTTP as `envelope`
 * (see `frontend/contracts/chat-http.contract.json` → definitions.ChatEnvelope).
 */
const initialChatContext = {
  replyText: "",
  /** @type {"attache"|"detective"} */
  activeAgent: "attache",
  baselineCompleted: false,
  /** Exact label string the client must show; keep in sync with product copy or LLM. */
  agentLabel: "ATTACHÉ",
  /** Mirrors `timeAway` child state + `classifyTimeAway` (see compound state in machine). */
  timeAwayBin: "idle",
  msSinceLastVisit: 0,
  /** Mirrors parallel `dossier` region (`none` | `present`). */
  hasDossier: false,
  /** Incremented on each `USER_MESSAGE` (persisted with snapshot; since session / rehydration). */
  orchestrationUserTurnCount: 0,
};

function extractMsFromEvent(event) {
  if (!event || event.type !== "USER_MESSAGE") return 0;
  const v = event.msSinceLastVisit;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

function contextToEnvelope(ctx) {
  return {
    active_agent: ctx.activeAgent,
    baseline_completed: ctx.baselineCompleted,
    agent_label: ctx.agentLabel,
    has_dossier: !!ctx.hasDossier,
  };
}

/**
 * Snapshot of routing before any time-away turn (for GET /api/chat-state, etc.).
 */
function getInitialChatEnvelope() {
  return contextToEnvelope(initialChatContext);
}

/**
 * Assistant reply for this turn — always includes the classified time-away bin (single source of truth with machine state).
 */
function buildReplyForTier(tier) {
  return `Time-away: ${tier.bin} — ${tier.description}`;
}

/**
 * Root is **parallel**: `dossier`, `visit` (time-away tiers), `agent` (attaché vs detective via `invoke`).
 * `DOSSIER_*` sync moves both `dossier` and `agent` regions. Time-away lives under `visit.timeAway`.
 */

/** Restored between HTTP requests so `timeAway.*` and context survive across turns. */
const persistedSnapshotBySessionId = new Map();

const enterTimeAwayFromIdle = [
  { guard: "isBrief", target: "timeAway.brief", actions: ["applyTurn"] },
  { guard: "isModerate", target: "timeAway.moderate", actions: ["applyTurn"] },
  { guard: "isLong", target: "timeAway.long", actions: ["applyTurn"] },
  { guard: "isStale", target: "timeAway.stale", actions: ["applyTurn"] },
];

const moveWithinTimeAway = [
  { guard: "isBrief", target: ".brief", actions: ["applyTurn"] },
  { guard: "isModerate", target: ".moderate", actions: ["applyTurn"] },
  { guard: "isLong", target: ".long", actions: ["applyTurn"] },
  { guard: "isStale", target: ".stale", actions: ["applyTurn"] },
];

const chatMachine = setup({
  guards: {
    isBrief: ({ event }) => classifyTimeAway(extractMsFromEvent(event)).bin === "brief",
    isModerate: ({ event }) => classifyTimeAway(extractMsFromEvent(event)).bin === "moderate",
    isLong: ({ event }) => classifyTimeAway(extractMsFromEvent(event)).bin === "long",
    isStale: ({ event }) => classifyTimeAway(extractMsFromEvent(event)).bin === "stale",
  },
  actions: {
    setHasDossierTrue: assign({ hasDossier: true }),
    setHasDossierFalse: assign({ hasDossier: false }),
    enterAttacheRouting: assign({
      activeAgent: "attache",
      agentLabel: "ATTACHÉ",
      baselineCompleted: false,
    }),
    enterDetectiveRouting: assign({
      activeAgent: "detective",
      agentLabel: "DETECTIVE",
      baselineCompleted: true,
    }),
    /** Runs on each `USER_MESSAGE`; `classifyTimeAway(ms)` drives guards + context. */
    applyTurn: assign(({ event, context }) => {
      const ms = extractMsFromEvent(event);
      const tier = classifyTimeAway(ms);
      const prev =
        context && typeof context.orchestrationUserTurnCount === "number"
          ? context.orchestrationUserTurnCount
          : 0;
      return {
        replyText: buildReplyForTier(tier),
        timeAwayBin: tier.bin,
        msSinceLastVisit: ms,
        orchestrationUserTurnCount: prev + 1,
      };
    }),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGMAWBDALgOgge1lgEswAnbAOzwrAGIARAeQGVmBJAUQCUB9AGUYBBeh3oBtAAwBdRKAAOBIpiLVZIAB6IAzACYArNgkAOACxaA7OZPmjOgIw6tAGhABPRADYAnBOxf9EhImelp2dsE6AL6RLmhYuATEZNhypHBgFJgMLOzcPADCfByCXKKSMkggCsTKqpWaCLoGxmaW1rYOzm6eJr6mFno6LR7mOh7RsRg46DCZ2FiY6Gh0TKycvALCZdJq1UoqFGoNVh7YJjpGdhah4UZGHi7uCF56JtgXHiYe9l6fel5GCYgOLTWbTTCLZa0QQAFRhgnyAAkODxEYIAHJMABiWJ4MMYPBEMI4+RhbAAahxyrtFLVDvVECczhcruYbiY7g9ugg7IE3loRuZwp8dF5dCYgSD5mDcGBMGBkMoAG4rHLrApFErbCryWkHI6IIyjPytcx6c1ijx6IyPRC8rxebBGAG-LShQZaLySqbSjI4CByhXKugCdEAcR4ggAQswOOj8iiAKqxyNwhHI6mVPZ0g0IGy+PQSb4eOzmbxGUImW088KOgESex6MulsLjGLAn0zP2y+WKogq2hx4m8AAKiLYAmYjDH3GYmd1NX1DIQph07w8RtGDr0par3KM1uwZsGV0GJjsITs3viXbmclQRAANgQ8PeyLBBwANNgwnhjicsNOyJcHOOxZnqdSgA0+h2IYAwSFolznhIDheNWqFaO8wSmIEXg2J8XrtlKt44PeT4vm+pAfqsuS8IUxSlOIYELvskEaIgMFwWaCFIbyqHoWE5jYBeJg+HYvwIRyejRO2VABvAlQgjSi5sQ0AC05zVmpOgSkRPr4IQJCkMprH0lBHF7k85qYdxgQ6OYRYSDu17+okRmUNQYAmTmy6jNWVprhIbKunhQyXIRkzxAZSTkKk6SZN5S7mQggxGGcRb6EaDqnmh3JWm8Taeh4nqjMY4kub6CXgSpZnsQgOnVpYsEeCWXznsEl7SXpN4ygsSyoF51WmbmXxpSMhaof8OniZZdq8phRoVgK3xmsVumRaC3YBr2waJapdoSL8656FaG5GA2zp6OhTkFVo5yil4dgbu6FUkSkD7PrAr4DVRe21ccOjofZvgmNhnpaAhYpXBVSpEDUf25lyTzFYYYpWGj9z2N860dvEsM1NgRAQI+g0sT5yV+dyF6+HYRqiUaTY6U0MNw0o2DKAAtmAggAO7oE8ZNJXVrzoT42Abg4okjA451dRt2D42znPc3zrjYAARqQJAAGYI8uYR1i87I7ghFzVm6pxjHTDrFWKYoswTyu8-z2Ac3gAakFgpNVBB-0HYD3Kem8ZYBMYlh4Z8ONSorOBO6r2CwIsJN68lBtYQ6DqjNatMjNW9lCW0GdBA6DbhA7StEFzztq8+FBQCndUOLBtytOJJ1mJc1bBJh+jfDu5j+ChFgyZEQA */
  id: "chat",
  type: "parallel",
  context: { ...initialChatContext },
  states: {
    dossier: {
      initial: "none",
      states: {
        none: {
          entry: ["setHasDossierFalse"],
          on: {
            DOSSIER_LOADED: { target: "present" },
          },
        },
        present: {
          entry: ["setHasDossierTrue"],
          on: {
            DOSSIER_CLEARED: { target: "none" },
          },
        },
      },
    },
    agent: {
      initial: "attache",
      states: {
        attache: {
          entry: ["enterAttacheRouting"],
          invoke: {
            id: "attacheOrchestrator",
            src: attacheOrchestratorMachine,
          },
          on: {
            DOSSIER_LOADED: { target: "detective" },
            /** After attaché prelude completes (e.g. `close_from_final_baseline3`), `chatService` sends this. */
            ATTACHE_HANDOFF_TO_DETECTIVE: {
              target: "detective",
              actions: ["enterDetectiveRouting"],
            },
          },
        },
        detective: {
          entry: ["enterDetectiveRouting"],
          invoke: {
            id: "detectiveOrchestrator",
            src: detectiveMachine,
          },
          on: {
            DOSSIER_CLEARED: { target: "attache" },
            /** Dossier present but long time away — return to attaché / baseline (see `runChatTurn`). */
            LONG_ABSENCE_USE_ATTACHE: {
              target: "attache",
              actions: ["enterAttacheRouting"],
            },
          },
        },
      },
    },
    visit: {
      initial: "idle",
      states: {
        idle: {
          on: {
            USER_MESSAGE: enterTimeAwayFromIdle,
          },
        },
        timeAway: {
          initial: "brief",
          states: {
            brief: {},
            moderate: {},
            long: {},
            stale: {},
          },
          on: {
            USER_MESSAGE: moveWithinTimeAway,
          },
        },
      },
    },
  },
});

/**
 * Read `context` from a persisted snapshot (tries `snapshot.context`, then a short-lived actor).
 * @param {unknown} persisted
 * @returns {object|null}
 */
function readContextFromPersistedSnapshot(persisted) {
  if (!persisted || typeof persisted !== "object") return null;
  const ctx = /** @type {{ context?: object }} */ (persisted).context;
  if (ctx && typeof ctx === "object" && "activeAgent" in ctx) return ctx;
  try {
    const a = createActor(chatMachine, { snapshot: persisted });
    a.start();
    const out = a.getSnapshot().context;
    a.stop();
    return out;
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} ChatTurnResult
 * @property {string} reply
 * @property {{ active_agent: "attache"|"detective", baseline_completed: boolean, agent_label: string, has_dossier: boolean }} envelope
 */

/**
 * Runs one user turn and returns reply + envelope from machine context.
 *
 * Reply text is **always** derived from `msSinceLastVisit` via `classifyTimeAway` on every call.
 * The actor is **restored** from the last persisted snapshot per `sessionId` so `timeAway.*`
 * tracks the tier across requests; guards + `applyTurn` keep context in sync with `classifyTimeAway`.
 *
 * **Dossier sync:** `DOSSIER_LOADED` / `DOSSIER_CLEARED` are sent only when `userHasPersistedDossier(dossier)`
 * changes vs the last persisted snapshot — not on every request — so `detective` is not reset to `attache`
 * when the client repeatedly reports “no dossier row”.
 *
 * **Time-away + dossier:** when visit bin is `stale` (always) or `long` with no dossier or dossier stale by age,
 * `LONG_ABSENCE_USE_ATTACHE` moves `detective → attache` for re-baseline.
 * `brief` / `moderate` keep `detective` when a fresh dossier exists.
 * No dossier / first session: start in `attache` (initial state); attaché prelude + `notifyAttachePreludeComplete`
 * moves to `detective` when appropriate.
 *
 * @param {string|null|undefined} sessionId — when set, machine snapshot is persisted for this session
 * @param {string} _message
 * @param {{ msSinceLastVisit?: number, dossier?: object|null, persist?: boolean }} [turnOptions] — optional loaded dossier for `dossier` region sync + staleness; `persist: false` skips writing snapshot (lab preview).
 */
function runChatTurn(sessionId, _message, turnOptions = {}) {
  const persist = turnOptions.persist !== false;
  const ms =
    typeof turnOptions.msSinceLastVisit === "number" && Number.isFinite(turnOptions.msSinceLastVisit)
      ? Math.max(0, turnOptions.msSinceLastVisit)
      : 0;
  const tier = classifyTimeAway(ms);
  const reply = buildReplyForTier(tier);
  const wantsDossier = userHasPersistedDossier(turnOptions.dossier);
  const dossierStaleByAge = isDossierStaleByAge(turnOptions.dossier, Date.now());

  const key = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  const persisted = key ? persistedSnapshotBySessionId.get(key) : undefined;
  const prevCtx = readContextFromPersistedSnapshot(persisted);
  const prevHasDossier = !!(prevCtx && prevCtx.hasDossier);

  let actor;
  try {
    actor = createActor(chatMachine, persisted !== undefined ? { snapshot: persisted } : {});
  } catch {
    if (key) persistedSnapshotBySessionId.delete(key);
    actor = createActor(chatMachine);
  }
  actor.start();

  // Only sync dossier region when presence **changes**. Sending `DOSSIER_CLEARED` every turn
  // while `wantsDossier` is false forced `detective → attache` every request (flip-flop with handoff).
  if (prevHasDossier && !wantsDossier) {
    actor.send({ type: "DOSSIER_CLEARED" });
  }
  if (!prevHasDossier && wantsDossier) {
    actor.send({ type: "DOSSIER_LOADED" });
  }

  actor.send({ type: "USER_MESSAGE", msSinceLastVisit: ms });

  // Routing: stale visit always → attaché; long visit → attaché when no dossier or dossier stale by age.
  const forceAttacheForLongAbsence =
    tier.bin === "stale" || (tier.bin === "long" && (!wantsDossier || dossierStaleByAge));
  if (forceAttacheForLongAbsence && actor.getSnapshot().context.activeAgent === "detective") {
    actor.send({ type: "LONG_ABSENCE_USE_ATTACHE" });
  }

  const snapshot = actor.getSnapshot();
  const ctx = snapshot.context;

  if (persist && key) {
    try {
      persistedSnapshotBySessionId.set(key, actor.getPersistedSnapshot());
    } catch {
      persistedSnapshotBySessionId.delete(key);
    }
  }
  actor.stop();

  const dbg = getDebugStateLevel();
  if (dbg >= 1) {
    logChatMachineState(1, "turn", (c) => {
      console.log(
        `  ${c.dim}msSinceLastVisit${c.reset} ${c.magenta}${ms}${c.reset} ${c.dim}→${c.reset} ${c.yellow}bin=${tier.bin}${c.reset} ` +
          `${c.dim}|${c.reset} ${c.green}value=${JSON.stringify(snapshot.value)}${c.reset}`
      );
      console.log(
        `  ${c.dim}reply${c.reset} ${c.magenta}${reply.length > 120 ? reply.slice(0, 117) + "…" : reply}${c.reset}`
      );
    });
  }
  if (dbg >= 2) {
    logChatMachineState(2, "context + envelope", (c) => {
      console.log(`  ${c.cyan}context${c.reset}`, {
        timeAwayBin: ctx.timeAwayBin,
        hasDossier: ctx.hasDossier,
        msSinceLastVisit: ctx.msSinceLastVisit,
        replyTextLen: (ctx.replyText && ctx.replyText.length) || 0,
        activeAgent: ctx.activeAgent,
        agentLabel: ctx.agentLabel,
      });
      console.log(`  ${c.cyan}envelope (HTTP)${c.reset}`, contextToEnvelope(ctx));
    });
  }
  if (dbg >= 3) {
    logChatMachineState(3, "verbose", (c) => {
      console.log(`  ${c.green}thresholds (ms)${c.reset}`, getTimeAwayThresholds());
      console.log(`  ${c.green}tier (full)${c.reset}`, tier);
      try {
        console.log(`  ${c.blue}snapshot.value${c.reset}`, snapshot.value);
        console.log(`  ${c.blue}snapshot.status${c.reset}`, snapshot.status);
        console.log(
          `  ${c.dim}snapshot.context (full)${c.reset}`,
          JSON.stringify(snapshot.context, null, 2)
        );
      } catch (e) {
        console.log(`  ${c.red}snapshot dump failed${c.reset}`, e && e.message);
      }
    });
  }

  return {
    reply,
    envelope: contextToEnvelope(ctx),
  };
}

/**
 * Move `agent` region from attaché to detective after attaché prelude ends (`runAttacheTurn` `sessionEnded`).
 * No-op if there is no persisted snapshot or we are not on attaché.
 *
 * @param {string|null|undefined} sessionId
 */
function notifyAttachePreludeComplete(sessionId) {
  const key = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!key) return;
  const persisted = persistedSnapshotBySessionId.get(key);
  if (!persisted) return;
  let actor;
  try {
    actor = createActor(chatMachine, { snapshot: persisted });
  } catch {
    persistedSnapshotBySessionId.delete(key);
    return;
  }
  actor.start();
  const value = actor.getSnapshot().value;
  const agentState =
    value && typeof value === "object" && value.agent != null ? value.agent : null;
  if (agentState === "attache") {
    actor.send({ type: "ATTACHE_HANDOFF_TO_DETECTIVE" });
  }
  try {
    persistedSnapshotBySessionId.set(key, actor.getPersistedSnapshot());
  } catch {
    persistedSnapshotBySessionId.delete(key);
  }
  actor.stop();
  if (agentState === "attache") {
    resetDetectiveExistentialPhaseForAttacheHandoff(key);
  }
}

/**
 * HTTP envelope from persisted chat machine state (after handoff, etc.).
 *
 * @param {string|null|undefined} sessionId
 * @returns {{ active_agent: string, baseline_completed: boolean, agent_label: string, has_dossier: boolean }|null}
 */
function getChatEnvelopeForSession(sessionId) {
  const key = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!key) return null;
  const persisted = persistedSnapshotBySessionId.get(key);
  if (!persisted) return null;
  let actor;
  try {
    actor = createActor(chatMachine, { snapshot: persisted });
  } catch {
    return null;
  }
  actor.start();
  const env = contextToEnvelope(actor.getSnapshot().context);
  actor.stop();
  return env;
}

/**
 * User messages processed since this chat snapshot exists (each `USER_MESSAGE` increments).
 *
 * @param {string|null|undefined} sessionId
 * @returns {number}
 */
function getOrchestrationUserTurnCountForSession(sessionId) {
  const key = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!key) return 0;
  const persisted = persistedSnapshotBySessionId.get(key);
  const ctx = readContextFromPersistedSnapshot(persisted);
  if (!ctx || typeof ctx !== "object") return 0;
  const n = /** @type {{ orchestrationUserTurnCount?: number }} */ (ctx).orchestrationUserTurnCount;
  return typeof n === "number" && n >= 0 ? n : 0;
}

/**
 * Dev / lab: raw persisted chat machine snapshot for a session (or null).
 *
 * @param {string|null|undefined} sessionId
 * @returns {unknown|null}
 */
function getPersistedChatMachineSnapshot(sessionId) {
  const key = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!key) return null;
  const persisted = persistedSnapshotBySessionId.get(key);
  return persisted !== undefined ? persisted : null;
}

module.exports = {
  chatMachine,
  initialChatContext,
  getInitialChatEnvelope,
  runChatTurn,
  classifyTimeAway,
  notifyAttachePreludeComplete,
  getChatEnvelopeForSession,
  getOrchestrationUserTurnCountForSession,
  getPersistedChatMachineSnapshot,
  /** @param {string} id */
  clearPersistedChatMachineSnapshot(id) {
    if (typeof id === "string" && id.length > 0) persistedSnapshotBySessionId.delete(id);
  },
};
