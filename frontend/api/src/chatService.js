"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");
const logger = require("./logger");
const {
  createInitialAttacheSessionState,
  runAttacheTurn,
  getRandomIntroLine,
  getRandomFinalLine,
  getPhaseNotesForTransition,
} = require("./attache/attacheRuntime");
const { summarizeHistory, maybeSummarize, shouldRunDossierUpdate } = require("./summarization");
const { createEmptyDossier, user_dossier_updater, runDossierAnalyzer } = require("./dossier");
const {
  appendThreadEvent,
  threadEventsToPhilosopherTranscriptText,
} = require("./storage/threadEvents");
const { classifyFromSessionAndDossier } = require("./session/returnClassification");
const {
  composeAgentPrompt,
} = require("./prompts/promptComposer");
const {
  transitionMainState,
  isUsablePersistedSnapshot: isUsableMainStateSnapshot,
} = require("./orchestration/mainStateMachine");

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function logInfo(...args) {
  logger.info("chatService", ...args);
}

function logDebug(...args) {
  logger.debug("chatService", ...args);
}

function logState(label, snapshot) {
  logger.state("chatService", label, snapshot);
}

// ---------------------------------------------------------------------------
// In-memory state and daily-usage helpers (HTTP layer integration)
// ---------------------------------------------------------------------------

const userExchangeCounts = new Map();

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function createFileDailyUsageStore(dataDir) {
  const dailyUsageFile = path.join(dataDir, "daily_usage.json");
  return {
    readDailyUsage() {
      try {
        if (fs.existsSync(dailyUsageFile)) {
          const data = JSON.parse(fs.readFileSync(dailyUsageFile, "utf8"));
          if (data.date === getToday()) return data.count;
        }
      } catch (_) {}
      return 0;
    },
    writeDailyUsage(count) {
      try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(
          dailyUsageFile,
          JSON.stringify({ date: getToday(), count }, null, 2),
          "utf8"
        );
      } catch (err) {
        console.error("Failed to write daily usage:", err.message);
      }
    },
  };
}

function createMemoryDailyUsageStore() {
  let dailyUsageCount = 0;
  let dailyUsageDate = null;
  return {
    readDailyUsage() {
      const today = getToday();
      if (dailyUsageDate === today) return dailyUsageCount;
      dailyUsageDate = today;
      dailyUsageCount = 0;
      return 0;
    },
    writeDailyUsage(count) {
      dailyUsageDate = getToday();
      dailyUsageCount = count;
    },
  };
}

// ---------------------------------------------------------------------------

// Each agent gets a different system message
// - Different POV
// - Different knowledge
// - Different summaries of others
// ✔ You can load prompts from external strings
// - JSON files
// - DB
// - CMS
// - Environment variables
// - User‑editable config
// ✔ You reduce token usage
// Each agent sees:
// - Its own full prompt
// - Only a short summary of others
// ✔ You get more nuanced storytelling
// Each agent has:
// - Its own perspective
// - Its own blind spots
// - Its own interpretation of the shared past
// This creates a richer, more novelistic dynamic.

// next steps
// - memory layers (episodic, semantic, agent‑specific)
// - narrative‑arc state machine





// ---------------------------------------------------------------------------
// Conversation state helpers
// ---------------------------------------------------------------------------

function normalizeConversationState(state) {
  const next = state && typeof state === "object" ? { ...state } : {};
  if (!next.mainStateSnapshots || !isUsableMainStateSnapshot(next.mainStateSnapshots.root)) {
    const transitioned = transitionMainState(next.mainStateSnapshots || null, {
      rehydrated: false,
      attache: { completed: false, closingDelivered: false },
    });
    next.mainStateSnapshots = transitioned.snapshots;
    next.mainState = transitioned.view;
  }
  return next;
}


// ---------------------------------------------------------------------------
// Turn envelope helpers (for callers / client surface)
// ---------------------------------------------------------------------------

function buildTurnEnvelope(state, userInput) {
  const s = state && typeof state === "object" ? state : {};
  const m = s.mainState && typeof s.mainState === "object" ? s.mainState : null;
  const baselineCompleted = !!(m && m.attache && m.attache.baselineCompleted);

  return {
    baseline_active: !baselineCompleted,
    baseline_completed: baselineCompleted,
    active_agent: baselineCompleted ? "detective" : "attache",
    last_user_message: typeof userInput === "string" ? userInput : "",
  };
}

function buildTurnResponseForCaller({ state, history, userInput, merged }) {
  return {
    envelope: buildTurnEnvelope(state, userInput),
    conversation: {
      // Full textual history including the new turn
      history,
      // The single block of text that was just appended this turn
      last_turn: merged,
    },
  };
}

// Per-session conversation state used by HTTP handlers
const sessionStates = new Map();

function createFreshSessionEntry() {
  return {
    state: null,
    history: "",
    attacheState: null,
    attacheCompleted: false,
    conversationSummaries: null,
    attacheIntroSent: false,
    detectiveIntroSent: false,
    threadEvents: [],
    /** ISO timestamp: last completed turn / hydrate; drives return-policy time-away. */
    returnPolicyLastActivityAt: null,
    lastReturnClassification: null,
    baselineRefreshInProgress: false,
    baselineRefreshReturnCategory: null,
    historyBeforeBaselineRefresh: null,
    summariesBeforeBaselineRefresh: null,
  };
}

function getOrCreateSessionState(sessionId) {
  let entry = sessionStates.get(sessionId);
  if (!entry) {
    entry = createFreshSessionEntry();
    sessionStates.set(sessionId, entry);
  }
  if (!Array.isArray(entry.threadEvents)) {
    entry.threadEvents = [];
  }
  return entry;
}

/**
 * Persist philosopher + detective lines for one detective turn (user message optional if already appended).
 * @param {object} session
 * @param {object} agents — { lumen, umbra, detective } raw agent results
 * @param {{ skipUser?: boolean }} [opts]
 */
function appendDetectiveTurnThreadEvents(session, userMessage, agents, opts) {
  const skipUser = opts && opts.skipUser;
  const trimmed = String(userMessage || "").trim();
  if (!skipUser && trimmed) {
    appendThreadEvent(session, { phase: "detective", kind: "user", text: trimmed });
  }
  const lumen = agents && agents.lumen;
  const umbra = agents && agents.umbra;
  const detective = agents && agents.detective;
  const lu =
    lumen && lumen.lumen_philosopher_user_response
      ? String(lumen.lumen_philosopher_user_response).trim()
      : "";
  if (lu) {
    appendThreadEvent(session, { phase: "detective", kind: "lumen_user", text: lu });
  }
  const lo =
    lumen && lumen.lumen_philosopher_other_response
      ? String(lumen.lumen_philosopher_other_response).trim()
      : "";
  if (lo) {
    appendThreadEvent(session, { phase: "detective", kind: "lumen_aside", text: lo });
  }
  const uu =
    umbra && umbra.umbra_philosopher_user_response
      ? String(umbra.umbra_philosopher_user_response).trim()
      : "";
  if (uu) {
    appendThreadEvent(session, { phase: "detective", kind: "umbra_user", text: uu });
  }
  const uo =
    umbra && umbra.umbra_philosopher_other_response
      ? String(umbra.umbra_philosopher_other_response).trim()
      : "";
  if (uo) {
    appendThreadEvent(session, { phase: "detective", kind: "umbra_aside", text: uo });
  }
  const dr =
    detective && detective.detective_response
      ? String(detective.detective_response).trim()
      : "";
  if (dr) {
    appendThreadEvent(session, { phase: "detective", kind: "detective", text: dr });
  }
}

function buildUserProgress(session, dossier) {
  const d = dossier != null ? dossier : session && session.dossier;
  return {
    baselineCompleted: !!(session && session.attacheCompleted),
    baselineDossierRecorded: !!(
      d &&
      d.meta &&
      typeof d.meta.baselineQuestionsAnswered === "number" &&
      d.meta.baselineQuestionsAnswered > 0
    ),
    hydratedFromStorage: !!(session && session._hydratedFromStorage),
  };
}

function enrichResponseBody(body, session) {
  if (!body || typeof body !== "object") return body;
  body.userProgress = buildUserProgress(session, session && session.dossier);
  if (session && session.lastReturnClassification) {
    body.returnClassification = session.lastReturnClassification;
  }
  return body;
}

/**
 * Recompute time-away / baseline policy classification (always when policy enabled).
 * Optionally mutates session for baseline refresh handoff when enforcement is on.
 * @param {object} session
 * @returns {object|null}
 */
function refreshReturnClassificationOnSession(session) {
  if (!config.ENABLE_RETURN_POLICY) {
    session.lastReturnClassification = null;
    return null;
  }
  const classification = classifyFromSessionAndDossier(
    session,
    session.dossier,
    new Date()
  );
  session.lastReturnClassification = classification;
  return classification;
}

/**
 * When the user was away long enough and already handed off to the detective,
 * restart attaché baseline while preserving prior detective history for summaries.
 * @param {object} session
 * @returns {object|null} classification
 */
function maybeApplyReturnBaselineTransition(session) {
  const classification = refreshReturnClassificationOnSession(session);
  if (!classification) return null;

  if (config.RETURN_POLICY_LOG_ONLY) {
    logInfo("return_policy", "classification_only", classification);
    return classification;
  }

  if (session.baselineRefreshInProgress) {
    return classification;
  }

  if (
    classification.returnCategory === "JUST_STEPPED_AWAY" ||
    classification.returnCategory === "UNKNOWN"
  ) {
    return classification;
  }

  if (!classification.needsBaselineRefresh) {
    return classification;
  }

  if (!session.attacheCompleted) {
    return classification;
  }

  session.baselineRefreshInProgress = true;
  session.baselineRefreshReturnCategory = classification.returnCategory;
  session.historyBeforeBaselineRefresh = session.history || "";
  session.summariesBeforeBaselineRefresh = session.conversationSummaries
    ? JSON.parse(JSON.stringify(session.conversationSummaries))
    : null;
  session.history = "";
  session.attacheState = createInitialAttacheSessionState({
    baseline_refresh_return_category: session.baselineRefreshReturnCategory,
    baseline_return_greeting_pending: true,
  });
  session.attacheCompleted = false;
  session.detectiveIntroSent = false;
  session.attacheIntroSent = false;

  logInfo("return_policy", "baseline_refresh_transition", {
    returnCategory: classification.returnCategory,
    baselineReason: classification.baselineReason,
    timeAwayMs: classification.timeAwayMs,
  });

  return classification;
}

/**
 * After a return-policy baseline refresh completes, merge new baseline + prior detective summaries.
 * @param {object} client - OpenAI client
 * @param {object} session
 * @param {string} baselineHistoryText
 */
async function mergeSummariesAfterBaselineRefresh(client, session, baselineHistoryText) {
  const prevSummaries = session.summariesBeforeBaselineRefresh;
  const prevDetectiveHistory = session.historyBeforeBaselineRefresh || "";

  const newBaselineSummary = await summarizeHistory(client, baselineHistoryText);

  let baselineAttache = newBaselineSummary;
  if (prevSummaries && prevSummaries.baselineAttache) {
    baselineAttache = await summarizeHistory(
      client,
      `Previous baseline summary:\n${prevSummaries.baselineAttache}\n\nNew baseline session:\n${baselineHistoryText}`
    );
  }

  let userDetective = null;
  if (String(prevDetectiveHistory).trim()) {
    userDetective = await summarizeHistory(client, prevDetectiveHistory);
  }
  if (prevSummaries && prevSummaries.userDetective && userDetective) {
    userDetective = await summarizeHistory(
      client,
      `Previous detective-phase summary:\n${prevSummaries.userDetective}\n\nUpdated detective transcript digest:\n${String(userDetective).slice(0, 6000)}`
    );
  } else if (prevSummaries && prevSummaries.userDetective && !userDetective) {
    userDetective = prevSummaries.userDetective;
  }

  const philText = threadEventsToPhilosopherTranscriptText(
    session.threadEvents || []
  );
  let philosophersInternal = null;
  if (String(philText).trim()) {
    philosophersInternal = await summarizeHistory(client, philText);
  }
  if (prevSummaries && prevSummaries.philosophersInternal && philosophersInternal) {
    philosophersInternal = await summarizeHistory(
      client,
      `Previous internal philosopher summary:\n${prevSummaries.philosophersInternal}\n\nRecent philosopher transcript:\n${String(philosophersInternal).slice(0, 6000)}`
    );
  } else if (
    prevSummaries &&
    prevSummaries.philosophersInternal &&
    !philosophersInternal
  ) {
    philosophersInternal = prevSummaries.philosophersInternal;
  }

  session.conversationSummaries = {
    v: 1,
    updatedAt: new Date().toISOString(),
    baselineAttache,
    userDetective,
    philosophersInternal,
  };
}

// ---------------------------------------------------------------------------
// Azure Table Storage (durable session / dossier / usage)
// ---------------------------------------------------------------------------

let durableStorageCache = undefined;

function getDurableStorage() {
  if (!config.ENABLE_DURABLE_STORAGE) return null;
  if (durableStorageCache === false) return null;
  if (durableStorageCache) return durableStorageCache;
  try {
    const { createStorage } = require("./storage/durableTableStorage");
    durableStorageCache = createStorage();
    if (!durableStorageCache) durableStorageCache = false;
  } catch (err) {
    logInfo("durable storage init failed:", err && err.message);
    durableStorageCache = false;
  }
  return durableStorageCache || null;
}

async function hydrateFromDurableStorage(sessionId) {
  const d = getDurableStorage();
  if (!d) return { dailyCount: null };
  const existing = sessionStates.get(sessionId);
  if (existing && existing._hydratedFromStorage) {
    // Avoid re-hydrating full session state on every turn; if a single persist
    // fails, repeatedly hydrating stale storage would rewind in-memory state.
    return { dailyCount: null };
  }
  try {
    return await d.hydrate(sessionId, () => getOrCreateSessionState(sessionId), userExchangeCounts);
  } catch (err) {
    logInfo("durable hydrate failed:", err && err.message);
    // Graceful fallback without silent reset: keep any existing in-memory state.
    // If this is a truly new session, it will naturally behave like a new user
    // without force-clearing data for returning users.
    const session = getOrCreateSessionState(sessionId);
    session._hydratedFromStorage = true; // prevent retry loop this process
    session._hydrateFailed = true;
    session._hydratedAsNewUserFallback = false;
    return { dailyCount: null };
  }
}

function isSessionStateUncertain(session) {
  if (!session || typeof session !== "object") return true;
  const hasHistory = !!(session.history && String(session.history).trim());
  const hasDetectiveState = !!(
    session.state &&
    typeof session.state === "object" &&
    Object.keys(session.state).length > 0
  );
  const hasAttacheState = !!(
    session.attacheState &&
    typeof session.attacheState === "object" &&
    Object.keys(session.attacheState).length > 0
  );
  const hasEvents = Array.isArray(session.threadEvents) && session.threadEvents.length > 0;
  const hasSummaries = !!(
    session.conversationSummaries &&
    typeof session.conversationSummaries === "object"
  );
  const hasDossier = !!(session.dossier && typeof session.dossier === "object");
  const hasCompletedFlag = session.attacheCompleted === true;
  return !(
    hasHistory ||
    hasDetectiveState ||
    hasAttacheState ||
    hasEvents ||
    hasSummaries ||
    hasDossier ||
    hasCompletedFlag
  );
}

function shouldHydrateForRequest(session, trimmedUserMessage) {
  if (!config.ENABLE_DURABLE_STORAGE) return false;
  if (!session || session._hydratedFromStorage) return false;
  if (!trimmedUserMessage) return true; // page load / explicit resume path
  return isSessionStateUncertain(session); // cold start / memory loss / uncertain state
}

function bumpReturnPolicyLastActivity(session) {
  if (!session || typeof session !== "object") return;
  session.returnPolicyLastActivityAt = new Date().toISOString();
}

async function persistDurableIfEnabled(sessionId, newDailyCount, options) {
  const persistProfile =
    options && typeof options === "object" && options.persistProfile === true;
  const session = sessionStates.get(sessionId);
  const d = getDurableStorage();
  if (!d) {
    bumpReturnPolicyLastActivity(session);
    return;
  }
  if (!session) return;
  try {
    await d.persist({
      sessionId,
      session,
      dossier: session.dossier,
      userExchangeCount: userExchangeCounts.get(sessionId) ?? 0,
      dailyCount: newDailyCount,
      persistProfile,
    });
  } catch (err) {
    logInfo("durable persist failed:", err && err.message);
  } finally {
    bumpReturnPolicyLastActivity(session);
  }
}

async function getChatStateForSession(sessionId) {
  const d = getDurableStorage();
  const emptySnapshot = {
    messages: [],
    sideTranscripts: { philosophers: [] },
    returnClassification: null,
    envelope: null,
    userProgress: {},
    summaries: null,
    lastActivityAt: null,
    detectiveIntroSent: false,
    baselineIntroSent: false,
  };
  if (!d) {
    return emptySnapshot;
  }
  try {
    return await d.getChatState(sessionId);
  } catch (err) {
    logInfo("getChatStateForSession failed:", err && err.message);
    return emptySnapshot;
  }
}




// json envelope schema example
// This is the meta‑control layer you prepend before the conversation log.
// It tells the model how to behave, not what to say.
// {
//   "schema_version": "1.0",
//   "agents": {
//     "detective": {
//       "role": "primary_user_facing",
//       "speaks_to_user": true,
//       "speaks_to_agents": false,
//       "listens_to_agents": true
//     },
//     "optimist_philosopher": {
//       "role": "internal_voice",
//       "speaks_to_user": false,
//       "speaks_to_agents": true,
//       "listens_to_agents": true
//     },
//     "pessimist_philosopher": {
//       "role": "internal_voice",
//       "speaks_to_user": false,
//       "speaks_to_agents": true,
//       "listens_to_agents": true
//     }
//   },
//   "conversation_rules": {
//     "turn_structure": "free", 
//     "philosophers_may_debate_each_other": true,
//     "detective_addresses_user_directly": true,
//     "detective_may_reference_philosophers": true,
//     "philosophers_do_not_address_user": true
//   },
//   "next_action": {
//     "expected_speaker": "detective",
//     "response_style": "natural_language"
//   }
// }

// example with json schema:
// {
//   "type": "agent_context",
//   "identity": "You are the Left Philosopher...",
//   "other_agents": "The Detective is analytical... The Right Philosopher is...",
//   "conversation_state": { ... },
//   "output_schema": {
//     "type": "json",
//     "schema": {
//       "user_response": "string",
//       "tags": "string[]",
//       "tuples": "[[string, string]]"
//     }
//   },
//   "rules": { ... }
// }





// Build Per‑Agent System Messages
// Each agent gets:
// - Its own full developer prompt
// - A short summary of the other agents
// - The shared conversation state
// - The shared rules
// - Its required output schema

function buildSystemMessageForAgent(agentKey, conversationState, internalState) {
  const prompts = config.agentPrompts[agentKey] || { others: "" };
  return composeAgentPrompt({
    agentKey,
    session: null,
    internalState: internalState || conversationState || {},
    otherAgentsSummary: String(prompts.others || "").trim(),
  });
}



// Conversation Log That Follows the Envelope
//  Flat Chronological Log” (Most Natural, Most Flexible)
// You then append the human‑readable dialogue:
// # CONVERSATION HISTORY

// [USER]: I feel like I’m drifting.

// [LUMEN_PHILOSOPHER]: Drifting is not always a loss—it can be the beginning of a new current. Perhaps the self is rearranging itself toward something freer.

// [UMBRA_PHILOSOPHER]: Or perhaps drifting is simply the slow erosion of purpose. A sign that the compass has rusted.

// [LUMEN_PHILOSOPHER]: You always assume erosion. Why not transformation?

// [UMBRA_PHILOSOPHER]: Because transformation requires intention. Drifting lacks it.

// [DETECTIVE]: I hear both of you. But I’m focused on the user’s lived clues. User, what’s the most recent moment where you felt this drifting sensation?

// # NEW USER MESSAGE

// I think it happened when I was talking to my boss today.

function mergeAgentOutputs({
  userMessage,
  lumen,
  umbra,
  detective,
}) {
  const transcript = [];

  if (userMessage) {
    transcript.push(`[USER]: ${userMessage}`);
  }

  // Lumen (optimist) philosopher fields
  const lumenUser =
    lumen && lumen.lumen_philosopher_user_response
      ? String(lumen.lumen_philosopher_user_response).trim()
      : "";
  const lumenOther =
    lumen && lumen.lumen_philosopher_other_response
      ? String(lumen.lumen_philosopher_other_response).trim()
      : "";

  if (lumenUser) {
    transcript.push(`[LUMEN_PHILOSOPHER]: ${lumenUser}`);
  }

  if (lumenOther) {
    transcript.push(`[LUMEN_PHILOSOPHER_ASIDE]: ${lumenOther}`);
  }

  // Umbra (pessimist) philosopher fields
  const umbraUser =
    umbra && umbra.umbra_philosopher_user_response
      ? String(umbra.umbra_philosopher_user_response).trim()
      : "";
  const umbraOther =
    umbra && umbra.umbra_philosopher_other_response
      ? String(umbra.umbra_philosopher_other_response).trim()
      : "";

  if (umbraUser) {
    transcript.push(`[UMBRA_PHILOSOPHER]: ${umbraUser}`);
  }

  if (umbraOther) {
    transcript.push(`[UMBRA_PHILOSOPHER_ASIDE]: ${umbraOther}`);
  }

  // Detective field
  const detectiveResponse =
    detective && detective.detective_response
      ? String(detective.detective_response).trim()
      : "";

  if (detectiveResponse) {
    transcript.push(`[DETECTIVE]: ${detectiveResponse}`);
  }

  return transcript.join("\n\n");
}

function appendTurnToHistory(previousHistory, turnTranscript) {
  const trimmedTurn = String(turnTranscript || "").trim();
  if (!trimmedTurn) return previousHistory || "";
  if (!previousHistory || !String(previousHistory).trim()) {
    return trimmedTurn;
  }
  return `${previousHistory.trim()}\n\n${trimmedTurn}`;
}




// The User Message (same for all agents)
function buildUserMessage(history, userInput) {
  return {
    role: "user",
    content: `# CONVERSATION HISTORY\n${history}\n\n# NEW USER MESSAGE\n${userInput}`
  };
}


// Agent Call (non-streaming)
async function callAgent({
  openai,
  agentKey,
  conversationState,
  session,
  history,
  userInput,
}) {
  const prompts = config.agentPrompts[agentKey] || { others: "" };
  const systemMessage = composeAgentPrompt({
    agentKey,
    session,
    internalState: conversationState,
    otherAgentsSummary: String(prompts.others || "").trim(),
  });
  const userMessage = buildUserMessage(history, userInput);
  const schema = systemMessage.outputSchema || null;

  // OFFLINE mode: do everything but call the model
  if (config.OFFLINE) {
    logInfo(`OFFLINE=1: skipping model call for agent "${agentKey}"`);
    if (agentKey === "detective" || agentKey === "final_detective") {
      return {
        detective_response:
          "[OFFLINE] Detective is unavailable. This is a stub response.",
      };
    }
    if (agentKey === "lumen") {
      return {
        lumen_philosopher_user_response:
          "[OFFLINE] Lumen Philosopher is unavailable. Stub response.",
        lumen_philosopher_other_response: "",
      };
    }
    if (agentKey === "umbra") {
      return {
        umbra_philosopher_user_response:
          "[OFFLINE] Umbra Philosopher is unavailable. Stub response.",
        umbra_philosopher_other_response: "",
      };
    }
    return {};
  }

  const messages = [
    { role: systemMessage.role, content: systemMessage.content },
    { role: userMessage.role, content: userMessage.content },
  ];

  const params = {
    model: config.MODEL,
    messages,
    ...(schema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: `${agentKey}_turn`,
              schema,
              strict: true,
            },
          },
        }
      : {}),
    ...(config.SERVICE_TIER === "flex" && { service_tier: "flex" }),
  };

  logger.logLLMCall("chatService", {
    label: `agent=${agentKey}`,
    messages,
    params,
  });

  try {
    const response = await openai.chat.completions.create(
      params,
      config.requestOptions
    );
    logDebug(
      "callAgent raw response for",
      agentKey,
      JSON.stringify(response, null, 2)
    );

    const message = response.choices && response.choices[0]
      ? response.choices[0].message
      : null;
    const content = message && typeof message.content === "string"
      ? message.content
      : "";

    const trimmed = String(content || "").trim();
    if (!trimmed) {
      logInfo("Empty model output for agent", agentKey);
      return {};
    }

    // When using json_schema response_format, the model should emit a JSON object
    // as the message content.
    if (schema) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (e) {
        logInfo(
          "Failed to parse JSON for agent",
          agentKey,
          "error:",
          e.message,
          "raw:",
          trimmed
        );
        return {};
      }
    }

    // Text-only fallback: return a simple object with a generic field so callers
    // can still use the result if needed.
    return { text: trimmed };
  } catch (err) {
    logInfo("OpenAI error in callAgent for", agentKey, "-", err.message || err);
    if (config.DEBUG_LOGS) {
      logger.error("chatService", err);
    }
    return {};
  }
}


async function callDetective(openai, state, history, userInput, session) {
  return callAgent({
    openai,
    agentKey: "detective",
    conversationState: state,
    session,
    history,
    userInput,
  });
}

async function callLumen(openai, state, history, userInput, session) {
  return callAgent({
    openai,
    agentKey: "lumen",
    conversationState: state,
    session,
    history,
    userInput,
  });
}

async function callUmbra(openai, state, history, userInput, session) {
  return callAgent({
    openai,
    agentKey: "umbra",
    conversationState: state,
    session,
    history,
    userInput,
  });
}

// Bonus final exchange: detective persona + final (closing) instructions only
async function callFinalDetective(openai, state, history, userInput, session) {
  return callAgent({
    openai,
    agentKey: "final_detective",
    conversationState: state,
    session,
    history,
    userInput,
  });
}


// The Orchestrator Loop (the whole system
async function runTurn(openai, state, history, userInput, runtimeContext = {}) {
  logger.category("STATE", "chatService", "runTurn start");
  logInfo("runTurn start", {
    hasState: !!state,
    historyLength: history ? history.length : 0,
  });

  state = normalizeConversationState(state);
  const summarizedHistory = await maybeSummarize(openai, history);
  const summarized = summarizedHistory !== history;
  history = summarizedHistory;

  const transitioned = transitionMainState(state.mainStateSnapshots || null, {
    rehydrated:
      !!(state.mainState && state.mainState.rehydrationStatus === "REHYDRATED"),
    detective: {
      closureTurnThreshold: config.CLOSURE_TURN_THRESHOLD,
      summarized,
    },
    returnProfile:
      runtimeContext.session && runtimeContext.session.lastReturnClassification
        ? runtimeContext.session.lastReturnClassification
        : null,
  });
  state.mainStateSnapshots = transitioned.snapshots;
  state.mainState = transitioned.view;
  logState("main state transition", state.mainState);
  logDebug("main state after detective turn", JSON.stringify(state.mainState, null, 2));

  // 3. Normal multi‑agent turn (detective always sees should_begin_closure in state)
  const sessionForAgent = runtimeContext.session || null;
  const [lumenResult, umbraResult, detectiveResult] = await Promise.all([
    callLumen(openai, state, history, userInput, sessionForAgent),
    callUmbra(openai, state, history, userInput, sessionForAgent),
    callDetective(openai, state, history, userInput, sessionForAgent),
  ]);

  const merged = mergeAgentOutputs({
    userMessage: userInput,
    lumen: lumenResult,
    umbra: umbraResult,
    detective: detectiveResult,
  });

  history = appendTurnToHistory(history, merged);

  logDebug("runTurn end", { turn_count: state.mainState.detective.turnCount });

  const envelope = buildTurnEnvelope(state, userInput);
  const agents = {
    lumen: lumenResult,
    umbra: umbraResult,
    detective: detectiveResult,
  };
  return { history, state, merged, envelope, agents };
}

 

function loadRandomLineFromFile(filePath) {
  try {
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  } catch (_) {
    return null;
  }
}

function getRandomDetectiveOpeningLine() {
  return loadRandomLineFromFile(config.DETECTIVE_OPENING_LINES_FILE);
}

// ---------------------------------------------------------------------------
// HTTP-level helper: legacy-style chat handler used by Express & Functions
// ---------------------------------------------------------------------------

function buildDebugBody(userExchanges, dailyUsage) {
  return {
    userExchanges,
    maxUserExchanges: config.MAX_USER_EXCHANGES,
    dailyUsage,
    maxDailyUsage: config.MAX_DAILY_USAGE,
  };
}

function attachDebugBodyIfEnabled(body, userExchanges, dailyUsage) {
  if (!config.DEBUG_LOGS || !body || typeof body !== "object") return;
  body.debug = buildDebugBody(userExchanges, dailyUsage);
}

async function handleChatRequest(sessionId, trimmed, options) {
  const { openaiClient, dailyUsageStore, debug } = options || {};

  if (!openaiClient && !config.OFFLINE) {
    return {
      status: 500,
      body: {
        error: config.FRIENDLY_API_KEY_MESSAGE,
        errorKind: "bad_request",
      },
    };
  }

  const client = openaiClient || {}; // OFFLINE mode never uses the client

  const session = getOrCreateSessionState(sessionId);
  let hydratedDaily = null;
  if (shouldHydrateForRequest(session, trimmed)) {
    try {
      const h = await hydrateFromDurableStorage(sessionId);
      if (h && h.dailyCount != null) hydratedDaily = h.dailyCount;
      if (debug) {
        logger.category("STORAGE", "chatService", "durable hydrate executed", {
          sessionId,
          reason: !trimmed ? "empty_message_resume" : "uncertain_session_state",
        });
        if (session && session.state && session.state.mainState) {
          logState("hydrated main state", session.state.mainState);
        }
      }
    } catch (_) {}
  } else if (debug) {
    logger.debug("chatService", "durable hydrate skipped", {
      sessionId,
      hydrated: !!session._hydratedFromStorage,
      uncertain: isSessionStateUncertain(session),
      emptyMessage: !trimmed,
    });
  }

  maybeApplyReturnBaselineTransition(session);

  const prevUserCount = userExchangeCounts.get(sessionId) ?? 0;
  let dailyCount =
    hydratedDaily != null
      ? hydratedDaily
      : dailyUsageStore && typeof dailyUsageStore.readDailyUsage === "function"
        ? dailyUsageStore.readDailyUsage()
        : 0;
  let dossierUpdatedThisTurn = false;

  if (debug) {
    logger.debug(
      "chatService",
      "chat user exchanges:",
      prevUserCount + "/" + config.MAX_USER_EXCHANGES
    );
    logger.debug(
      "chatService",
      "chat daily usage:",
      dailyCount + "/" + config.MAX_DAILY_USAGE
    );
  }

  if (dailyCount >= config.MAX_DAILY_USAGE) {
    return {
      status: 429,
      body: {
        error: "Daily system limit reached. Try again tomorrow.",
        errorKind: "rate_limit",
      },
    };
  }

  // Over limit: no response, log only; frontend sees 204 and shows nothing (mysterious)
  if (prevUserCount > config.MAX_USER_EXCHANGES) {
    logInfo("max_user_exchanges exceeded; returning 204 (no body).");
    return { status: 204, body: null };
  }

  if (config.DEBUG_LOGS) {
    logDebug(
      "session dossier",
      session.dossier ? JSON.stringify(session.dossier, null, 2) : "(none)"
    );
  }
  const { history: prevHistory, state: prevState } = session;

  // Baseline Attaché phase comes before the multi-agent detective system.
  // The attaché owns the "prelude" until either:
  //   - The user has indicated close intent at least twice (primary rule), or
  //   - We hit the hard safety cap ATTACHE_MAX_TURNS inside attacheRuntime.
  // Once either condition is met, attacheRuntime marks sessionEnded=true and
  // we flip attacheCompleted, then the detective becomes the primary agent.
  const baselineActive = !session.attacheCompleted;

  // When baseline (attaché prelude) is active and no attaché state yet, we expect
  // the frontend to trigger the very first Attaché line with an empty message.
  if (baselineActive && !session.attacheState) {
    if (!trimmed) {
      // Initialize attaché session state but do NOT call the LLM yet.
      // On page load we only show a pre-written opening line and wait
      // for the user's first real message before the first attaché turn.
      session.attacheState = createInitialAttacheSessionState({});
      session.attacheCompleted = false;
      session.attacheIntroSent = true;

      const intro = getRandomIntroLine && getRandomIntroLine();
      const replyText = intro || "";

      // Seed the attaché chat_history with the pre-written opening line
      // so that it appears in the history passed to the first LLM call.
      if (intro && session.attacheState) {
        const base = session.attacheState;
        const prevHistory = Array.isArray(base.chat_history)
          ? base.chat_history.slice()
          : [];
        prevHistory.push({ role: "assistant", content: intro });
        session.attacheState = {
          ...base,
          chat_history: prevHistory,
        };
      }

      const transitioned = transitionMainState(session.state && session.state.mainStateSnapshots, {
        rehydrated: !!session._hydratedFromStorage,
        attache: { completed: false, closingDelivered: false },
      });
      session.state = {
        ...(session.state && typeof session.state === "object" ? session.state : {}),
        mainStateSnapshots: transitioned.snapshots,
        mainState: transitioned.view,
      };
      const envelope = buildTurnEnvelope(session.state, "");

      const body = {
        reply: replyText,
        leftPhilosopherUserResponse: "",
        leftPhilosopherOtherResponse: "",
        leftPhilosopherNotes: [],
        leftPhilosopherCallouts: [],
        rightPhilosopherUserResponse: "",
        rightPhilosopherOtherResponse: "",
        rightPhilosopherNotes: [],
        rightPhilosopherCallouts: [],
        philosophers: {
          lumen: { userResponse: "", otherResponse: "", notes: [], callouts: [] },
          umbra: { userResponse: "", otherResponse: "", notes: [], callouts: [] },
        },
        envelope,
        dossierUpdated: dossierUpdatedThisTurn,
      };

      const nextUserCount = prevUserCount + 1;
      userExchangeCounts.set(sessionId, nextUserCount);
      const newDailyCount = dailyCount + 1;
      if (
        dailyUsageStore &&
        typeof dailyUsageStore.writeDailyUsage === "function"
      ) {
        dailyUsageStore.writeDailyUsage(newDailyCount);
      }

      appendThreadEvent(session, {
        phase: "baseline",
        kind: "attache",
        text: replyText,
      });
      attachDebugBodyIfEnabled(body, nextUserCount, newDailyCount);
      enrichResponseBody(body, session);
      await persistDurableIfEnabled(sessionId, newDailyCount, {
        persistProfile: false,
      });
      return { status: 200, body };
    }
  }

  // When baseline (attaché prelude) is still active and already initialized,
  // route user turns through the new AttacheState-based orchestrator instead
  // of the multi-agent detective.
  if (baselineActive && session.attacheState) {
    const prevAttacheState = session.attacheState && session.attacheState.attacheState;

    const result = await runAttacheTurn({
      userMessage: trimmed,
      sessionState: session.attacheState,
      openaiClient: client,
    });

  session.attacheState = result.sessionState;

  const nextAttacheState = result.sessionState && result.sessionState.attacheState;
  const phaseNotes = getPhaseNotesForTransition(prevAttacheState, nextAttacheState);

    // Attaché baseline is considered fully done once the runtime has
    // observed user_intends_close twice (sessionEnded === true).
    const done = result.sessionEnded === true;
    let replyText = result.user_response || "";
    // NOTE: We previously appended an extra canned final line from
    // getRandomFinalLine() here to ensure a strong detective handoff.
    // In practice this often produced two very similar close lines in a row,
    // because the LLM is already instructed (via FINAL_CLOSE_INSTRUCTIONS)
    // to say essentially the same thing.
    //
    // Keeping this block commented out for now so the attaché's closing
    // message comes solely from the model. If we decide we want an
    // additional deterministic footer again, we can re-enable this block
    // and potentially add de-duplication/heuristics before appending.
    //
    // if (done) {
    //   const finalLine = getRandomFinalLine && getRandomFinalLine();
    //   if (finalLine) {
    //     replyText = replyText ? replyText + "\n\n" + finalLine : finalLine;
    //   }
    // }
    if (done && !session.attacheCompleted) {
      const turnCount =
        typeof result.sessionState.attache_turn_count === "number"
          ? result.sessionState.attache_turn_count
          : 0;
      const closeCount =
        typeof result.sessionState.attache_close_count === "number"
          ? result.sessionState.attache_close_count
          : 0;
      const baselineAnswers =
        typeof result.sessionState.baseline_answer_count === "number"
          ? result.sessionState.baseline_answer_count
          : 0;
      logInfo(
        "Attaché baseline complete; handing off to detective flow",
        {
          attache_turn_count: turnCount,
          attache_close_count: closeCount,
          baseline_answer_count: baselineAnswers,
        }
      );
      session.attacheCompleted = true;
      const completedBaselineRefresh = !!session.baselineRefreshInProgress;
      try {
        const baselineHistory = Array.isArray(result.sessionState.chat_history)
          ? result.sessionState.chat_history
              .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
              .join("\n\n")
          : "";

        if (completedBaselineRefresh) {
          await mergeSummariesAfterBaselineRefresh(client, session, baselineHistory);
          session.history = session.historyBeforeBaselineRefresh || "";
          session.baselineRefreshInProgress = false;
          session.baselineRefreshReturnCategory = null;
          session.historyBeforeBaselineRefresh = null;
          session.summariesBeforeBaselineRefresh = null;
        } else {
          const baselineSummaryText = await summarizeHistory(client, baselineHistory);
          session.conversationSummaries = {
            v: 1,
            updatedAt: new Date().toISOString(),
            baselineAttache: baselineSummaryText,
            userDetective: null,
            philosophersInternal: null,
          };
        }

        if (!config.OFFLINE && client) {
          const existingDossier = session.dossier || createEmptyDossier(sessionId);
          const recentMessages = Array.isArray(result.sessionState.chat_history)
            ? result.sessionState.chat_history
            : [];
          const analyzerOutput = await runDossierAnalyzer({
            userId: sessionId,
            recentMessages,
            currentDossier: existingDossier,
            openaiClient: client,
          });
          const baselineQuestionStats =
            result.sessionState.baseline_question_stats &&
            typeof result.sessionState.baseline_question_stats === "object"
              ? result.sessionState.baseline_question_stats
              : null;
          const nowMs = Date.now();
          session.dossier = user_dossier_updater(existingDossier, analyzerOutput, {
            baselineQuestionsAnswered: baselineAnswers,
            baselineQuestionStats,
            lastBaselineCompletedAt: nowMs,
          });
          dossierUpdatedThisTurn = true;
        }
      } catch (_) {
        if (!completedBaselineRefresh) {
          session.conversationSummaries = null;
        }
      }
    }

    const transitioned = transitionMainState(session.state && session.state.mainStateSnapshots, {
      rehydrated: !!session._hydratedFromStorage,
      attache: { completed: !!session.attacheCompleted, closingDelivered: !!session.attacheCompleted },
      returnProfile: session.lastReturnClassification || null,
    });
    session.state = {
      ...(session.state && typeof session.state === "object" ? session.state : {}),
      mainStateSnapshots: transitioned.snapshots,
      mainState: transitioned.view,
    };
    const envelope = buildTurnEnvelope(session.state, trimmed);

    const nextUserCount = prevUserCount + 1;
    userExchangeCounts.set(sessionId, nextUserCount);
    const newDailyCount = dailyCount + 1;
    if (
      dailyUsageStore &&
      typeof dailyUsageStore.writeDailyUsage === "function"
    ) {
      dailyUsageStore.writeDailyUsage(newDailyCount);
    }

    const body = {
      reply: replyText,
      leftPhilosopherUserResponse: "",
      leftPhilosopherOtherResponse: "",
      leftPhilosopherNotes: phaseNotes,
      leftPhilosopherCallouts: [],
      rightPhilosopherUserResponse: "",
      rightPhilosopherOtherResponse: "",
      rightPhilosopherNotes: [],
      rightPhilosopherCallouts: [],
      philosophers: {
        lumen: { userResponse: "", otherResponse: "", notes: phaseNotes.slice(), callouts: [] },
        umbra: { userResponse: "", otherResponse: "", notes: [], callouts: [] },
      },
      envelope,
      dossierUpdated: dossierUpdatedThisTurn,
    };
    attachDebugBodyIfEnabled(body, nextUserCount, newDailyCount);
    appendThreadEvent(session, { phase: "baseline", kind: "user", text: trimmed });
    appendThreadEvent(session, {
      phase: "baseline",
      kind: "attache",
      text: replyText,
    });
    enrichResponseBody(body, session);
    await persistDurableIfEnabled(sessionId, newDailyCount, {
      persistProfile: dossierUpdatedThisTurn,
    });
    return { status: 200, body };
  }

  // After attaché baseline completes but before the first full multi-agent turn, allow
  // an automatic detective opening line when the frontend sends an empty
  // message as a follow-up.
  if (session.attacheCompleted && !session.detectiveIntroSent && !trimmed) {
    const opener = getRandomDetectiveOpeningLine();
    session.detectiveIntroSent = true;

    const transitioned = transitionMainState(session.state && session.state.mainStateSnapshots, {
      rehydrated: !!session._hydratedFromStorage,
      startDetectiveOnly: true,
      returnProfile: session.lastReturnClassification || null,
    });
    session.state = {
      ...(session.state && typeof session.state === "object" ? session.state : {}),
      mainStateSnapshots: transitioned.snapshots,
      mainState: transitioned.view,
    };
    const envelope = buildTurnEnvelope(session.state, "");
    envelope.active_agent = "detective";

    const nextUserCount = prevUserCount + 1;
    userExchangeCounts.set(sessionId, nextUserCount);
    const newDailyCount = dailyCount + 1;
    if (
      dailyUsageStore &&
      typeof dailyUsageStore.writeDailyUsage === "function"
    ) {
      dailyUsageStore.writeDailyUsage(newDailyCount);
    }

    const body = {
      reply: opener || "",
      leftPhilosopherUserResponse: "",
      leftPhilosopherOtherResponse: "",
      leftPhilosopherNotes: [],
      leftPhilosopherCallouts: [],
      rightPhilosopherUserResponse: "",
      rightPhilosopherOtherResponse: "",
      rightPhilosopherNotes: [],
      rightPhilosopherCallouts: [],
      philosophers: {
        lumen: { userResponse: "", otherResponse: "", notes: [], callouts: [] },
        umbra: { userResponse: "", otherResponse: "", notes: [], callouts: [] },
      },
      envelope,
      dossierUpdated: dossierUpdatedThisTurn,
    };
    attachDebugBodyIfEnabled(body, nextUserCount, newDailyCount);
    appendThreadEvent(session, {
      phase: "detective",
      kind: "detective",
      text: opener || "",
    });
    enrichResponseBody(body, session);
    await persistDurableIfEnabled(sessionId, newDailyCount, {
      persistProfile: false,
    });
    return { status: 200, body };
  }

  // Bonus final exchange: one more turn with final_detective (persona + closing instructions) only
  if (prevUserCount === config.MAX_USER_EXCHANGES) {
    let history = await maybeSummarize(client, prevHistory);
    let state = normalizeConversationState(prevState);
    const transitioned = transitionMainState(state.mainStateSnapshots || null, {
      rehydrated: !!session._hydratedFromStorage,
      detective: { closureTurnThreshold: config.CLOSURE_TURN_THRESHOLD },
      returnProfile: session.lastReturnClassification || null,
    });
    state.mainStateSnapshots = transitioned.snapshots;
    state.mainState = transitioned.view;
    const finalResult = await callFinalDetective(
      client,
      state,
      history,
      trimmed,
      session
    );
    const merged = mergeAgentOutputs({
      userMessage: trimmed,
      lumen: null,
      umbra: null,
      detective: finalResult,
    });
    history = appendTurnToHistory(history, merged);
    session.history = history;
    session.state = state;

    const nextUserCount = prevUserCount + 1;
    userExchangeCounts.set(sessionId, nextUserCount);
    const newDailyCount = dailyCount + 1;
    if (
      dailyUsageStore &&
      typeof dailyUsageStore.writeDailyUsage === "function"
    ) {
      dailyUsageStore.writeDailyUsage(newDailyCount);
    }

    const envelope = buildTurnEnvelope(state, trimmed);
    envelope.active_agent = "detective";

    let reply = "";
    if (finalResult && finalResult.detective_response != null) {
      reply = String(finalResult.detective_response).trim();
    }
    if (!reply && merged) {
      const marker = "[DETECTIVE]:";
      const idx = merged.lastIndexOf(marker);
      if (idx >= 0) reply = merged.slice(idx + marker.length).trim();
    }
    const body = {
      reply: reply || "(No reply.)",
      leftPhilosopherUserResponse: "",
      leftPhilosopherOtherResponse: "",
      leftPhilosopherNotes: [],
      leftPhilosopherCallouts: [],
      rightPhilosopherUserResponse: "",
      rightPhilosopherOtherResponse: "",
      rightPhilosopherNotes: [],
      rightPhilosopherCallouts: [],
      philosophers: {
        lumen: {
          userResponse: "",
          otherResponse: "",
          notes: [],
          callouts: [],
        },
        umbra: {
          userResponse: "",
          otherResponse: "",
          notes: [],
          callouts: [],
        },
      },
      envelope,
      dossierUpdated: dossierUpdatedThisTurn,
    };
    attachDebugBodyIfEnabled(body, nextUserCount, newDailyCount);
    body.limitReached = true;
    appendThreadEvent(session, { phase: "detective", kind: "user", text: trimmed });
    appendThreadEvent(session, {
      phase: "detective",
      kind: "detective",
      text: reply || "(No reply.)",
    });
    enrichResponseBody(body, session);
    await persistDurableIfEnabled(sessionId, newDailyCount, {
      persistProfile: false,
    });

    return { status: 200, body };
  }

  let initialStateForDetective = normalizeConversationState(prevState || {});

  const { history, state, merged, envelope, agents } = await runTurn(
    client,
    initialStateForDetective,
    prevHistory,
    trimmed,
    { session, dossier: session.dossier || null, now: new Date() }
  );

  session.history = history;
  session.state = state;

  // 2) Periodically run dossier analyzer & updater every N turns
  if (!config.OFFLINE && client && shouldRunDossierUpdate(state.mainState.detective.turnCount)) {
    try {
      const existingDossier = session.dossier || createEmptyDossier(sessionId);
      const recentMessages = [
        { role: "user", content: trimmed },
      ];
      const analyzerOutput = await runDossierAnalyzer({
        userId: sessionId,
        recentMessages,
        currentDossier: existingDossier,
        openaiClient: client,
      });
      session.dossier = user_dossier_updater(existingDossier, analyzerOutput, {});
      dossierUpdatedThisTurn = true;
    } catch (e) {
      if (config.DEBUG_LOGS) {
        console.error("Error running dossier analyzer after turn", e);
      }
    }
  }

  // If merged is empty, we treat this as a no-reply turn (closure fully reached).
  if (!merged || !String(merged).trim()) {
    appendThreadEvent(session, { phase: "detective", kind: "user", text: trimmed });
    await persistDurableIfEnabled(sessionId, dailyCount, {
      persistProfile: dossierUpdatedThisTurn,
    });
    return { status: 204, body: null };
  }

  const nextUserCount = prevUserCount + 1;
  userExchangeCounts.set(sessionId, nextUserCount);
  const newDailyCount = dailyCount + 1;
  if (
    dailyUsageStore &&
    typeof dailyUsageStore.writeDailyUsage === "function"
  ) {
    dailyUsageStore.writeDailyUsage(newDailyCount);
  }

  const detectiveAgent = agents && agents.detective ? agents.detective : null;
  let reply = "";
  if (detectiveAgent && detectiveAgent.detective_response != null) {
    reply = String(detectiveAgent.detective_response).trim();
  }

  // Fallback: if schema missing or malformed, derive from merged transcript.
  if (!reply && merged) {
    const marker = "[DETECTIVE]:";
    const idx = merged.lastIndexOf(marker);
    if (idx >= 0) {
      reply = merged.slice(idx + marker.length).trim();
    }
  }

  const lumenAgent = agents && agents.lumen ? agents.lumen : null;
  const umbraAgent = agents && agents.umbra ? agents.umbra : null;

  function coerceArray(value) {
    // Generic helper for simple string arrays (e.g., notes).
    return Array.isArray(value) ? value.map(String) : [];
  }

  // Normalize philosopher callouts into a consistent shape expected by the
  // frontend: each entry is either [userText, mode] or { userText, mode }.
  // The JSON schema for *_philosopher_callouts is [[word_or_phrase, mode], ...],
  // but we also accept legacy string forms like "jaguar,keyword".
  function coerceCalloutsArray(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    for (var i = 0; i < value.length; i++) {
      var entry = value[i];
      var userText = "";
      var mode = "";

      if (Array.isArray(entry) && entry.length >= 2) {
        userText = String(entry[0] != null ? entry[0] : "").trim();
        mode = String(entry[1] != null ? entry[1] : "").toLowerCase();
      } else if (entry && typeof entry === "object" && "userText" in entry && "mode" in entry) {
        userText = String(entry.userText != null ? entry.userText : "").trim();
        mode = String(entry.mode != null ? entry.mode : "").toLowerCase();
      } else if (typeof entry === "string") {
        var parts = entry.split(",");
        if (parts.length >= 2) {
          userText = String(parts[0]).trim();
          mode = String(parts[1]).toLowerCase();
        }
      }

      if (!userText || !mode) continue;
      if (mode !== "keyword" && mode !== "highlight" && mode !== "strike") continue;
      // Use array form to match the JSON schema; frontend also accepts objects.
      out.push([userText, mode]);
    }
    return out;
  }

  // Map structured Lumen/Umbra outputs into legacy philosopher fields
  const lumenUser = lumenAgent && lumenAgent.lumen_philosopher_user_response
    ? String(lumenAgent.lumen_philosopher_user_response)
    : "";
  const lumenOther = lumenAgent && lumenAgent.lumen_philosopher_other_response
    ? String(lumenAgent.lumen_philosopher_other_response)
    : "";
  const lumenNotes = lumenAgent && lumenAgent.lumen_philosopher_notes
    ? coerceArray(lumenAgent.lumen_philosopher_notes)
    : [];
  const lumenCallouts = lumenAgent && lumenAgent.lumen_philosopher_callouts
    ? coerceCalloutsArray(lumenAgent.lumen_philosopher_callouts)
    : [];

  const umbraUser = umbraAgent && umbraAgent.umbra_philosopher_user_response
    ? String(umbraAgent.umbra_philosopher_user_response)
    : "";
  const umbraOther = umbraAgent && umbraAgent.umbra_philosopher_other_response
    ? String(umbraAgent.umbra_philosopher_other_response)
    : "";
  const umbraNotes = umbraAgent && umbraAgent.umbra_philosopher_notes
    ? coerceArray(umbraAgent.umbra_philosopher_notes)
    : [];
  const umbraCallouts = umbraAgent && umbraAgent.umbra_philosopher_callouts
    ? coerceCalloutsArray(umbraAgent.umbra_philosopher_callouts)
    : [];

  const enrichedEnvelope = {
    ...envelope,
    active_agent: "detective",
  };

  const body = {
    reply: reply || "(No reply.)",
    // Backward-compatible philosopher fields (left = Lumen, right = Umbra)
    leftPhilosopherUserResponse: lumenUser,
    leftPhilosopherOtherResponse: lumenOther,
    leftPhilosopherNotes: lumenNotes,
    leftPhilosopherCallouts: lumenCallouts,
    rightPhilosopherUserResponse: umbraUser,
    rightPhilosopherOtherResponse: umbraOther,
    rightPhilosopherNotes: umbraNotes,
    rightPhilosopherCallouts: umbraCallouts,
    // New structured form for future frontend versions
    philosophers: {
      lumen: {
        userResponse: lumenUser,
        otherResponse: lumenOther,
        notes: lumenNotes,
        callouts: lumenCallouts,
      },
      umbra: {
        userResponse: umbraUser,
        otherResponse: umbraOther,
        notes: umbraNotes,
        callouts: umbraCallouts,
      },
    },
    envelope: enrichedEnvelope,
    dossierUpdated: dossierUpdatedThisTurn,
  };

  attachDebugBodyIfEnabled(body, nextUserCount, newDailyCount);
  appendDetectiveTurnThreadEvents(session, trimmed, agents);
  enrichResponseBody(body, session);
  await persistDurableIfEnabled(sessionId, newDailyCount, {
    persistProfile: dossierUpdatedThisTurn,
  });

  // limitReached is set only in the bonus-final response (detective's closing message), never in normal turns.

  return { status: 200, body };
}

// Streaming wrapper used by the local Express dev server.
// It reuses handleChatRequest to get the full turn, then emits a series of
// small "delta" events followed by a single "final" event over an event
// callback (NDJSON on the HTTP layer).
async function handleChatStream(sessionId, trimmed, options, onEvent) {
  if (typeof onEvent !== "function") {
    throw new Error("handleChatStream requires an onEvent callback");
  }

  const result = await handleChatRequest(sessionId, trimmed, options);

  // No-reply closure turn
  if (result.status === 204) {
    await onEvent({ type: "final", status: 204, body: null });
    return result;
  }

  // Errors or non-OK responses: send a single final event.
  if (!result || typeof result.status !== "number" || result.status !== 200) {
    await onEvent({
      type: "final",
      status: result && typeof result.status === "number" ? result.status : 500,
      body: (result && result.body) || {
        error: "Unexpected error.",
        errorKind: "server_error",
      },
    });
    return result;
  }

  const body = result.body || {};
  const reply = typeof body.reply === "string" ? body.reply : "";
  const activeAgent =
    body && body.envelope && body.envelope.active_agent
      ? body.envelope.active_agent
      : "detective";

  // If there is no textual reply, just send the final container.
  if (!reply) {
    await onEvent({ type: "final", status: 200, body });
    return result;
  }

  const text = String(reply);
  const chunkSize = config.STREAM_CHUNK_SIZE;
  const delayMs = config.STREAM_DELAY_MS;

  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    if (!chunk) continue;
    await onEvent({ type: "delta", agent: activeAgent, text: chunk });
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  await onEvent({ type: "final", status: 200, body });

  return result;
}

// Using narrative‑arc flags like conversation_state.is_exposition, is_rising_action, is_climax, etc. is not only sensible — it’s one of the most powerful ways to turn your multi‑agent system into something that feels authored, intentional, and dramatic without hard‑coding plot.
// Think of it this way:
// Your developer prompts define who the philosophers are.
// Your JSON envelope defines where they are in the story.
// That separation keeps the characters stable while letting the story evolve.
// the philosophers have deep backstories.
// You don’t want them to reveal everything at once.
// A narrative state machine lets you gate revelations:
// - Exposition → small hints
// - Rising action → partial truths
// - Climax → the big reveal
// - Denouement → reflection
// This creates a novel‑like arc across many sessions.

// if (turnCount < 5) narrative_phase = "exposition";
// else if (turnCount < 15) narrative_phase = "rising_action";
// else if (turnCount < 20) narrative_phase = "climax";
// else if (turnCount < 25) narrative_phase = "falling_action";
// else narrative_phase = "denouement";


// if (userEmotion == "distress") narrative_phase = "rising_action";
// if (optimistRevealedSecret && pessimistReacted) narrative_phase = "climax";
module.exports = {
  // Paths and configuration (re-exported from config for shared/server)
  PROMPTS_DIR: config.PROMPTS_DIR,
  DETECTIVE_PERSONA_FILE: config.DETECTIVE_PERSONA_FILE,
  LUMEN_PERSONA_FILE: config.LUMEN_PERSONA_FILE,
  UMBRA_PERSONA_FILE: config.UMBRA_PERSONA_FILE,
  DETECTIVE_INSTRUCTIONS_FILE: config.DETECTIVE_INSTRUCTIONS_FILE,
  LUMEN_INSTRUCTIONS_FILE: config.LUMEN_INSTRUCTIONS_FILE,
  UMBRA_INSTRUCTIONS_FILE: config.UMBRA_INSTRUCTIONS_FILE,
  CLOSERS_FILE: config.CLOSERS_FILE,
  CLOSING_INSTRUCTIONS_FILE: config.CLOSING_INSTRUCTIONS_FILE,
  PHIL_ANNOTATIONS_FILE: config.PHIL_ANNOTATIONS_FILE,
  MODEL: config.MODEL,
  SERVICE_TIER: config.SERVICE_TIER,
  MAX_HISTORY_LENGTH: config.MAX_HISTORY_LENGTH,
  MAX_USER_EXCHANGES: config.MAX_USER_EXCHANGES,
  MAX_DAILY_USAGE: config.MAX_DAILY_USAGE,
  DEV: config.DEV,
  OFFLINE: config.OFFLINE,
  DEBUG_LOGS: config.DEBUG_LOGS,
  DEBUG_LLM: config.DEBUG_LLM,
  DEBUG_STATE: config.DEBUG_STATE,

  // In-memory usage state
  userExchangeCounts,

  // Daily usage stores
  createFileDailyUsageStore,
  createMemoryDailyUsageStore,

  // Core orchestrator
  runTurn,

  // Envelope / serialization helpers for callers & streaming layers
  buildTurnEnvelope,
  buildTurnResponseForCaller,

  // Lower-level utilities left exported in case you want them
  normalizeConversationState,
  buildSystemMessageForAgent,
  buildUserMessage,
  mergeAgentOutputs,
  appendTurnToHistory,

  // HTTP-style handler used by Express dev server and Azure Functions
  handleChatRequest,
  handleChatStream,

  // Durable storage / restore
  getChatStateForSession,
  reloadSessionFromDurable: hydrateFromDurableStorage,
  ENABLE_DURABLE_STORAGE: config.ENABLE_DURABLE_STORAGE,
  DOSSIER_TABLE_NAME: config.DOSSIER_TABLE_NAME,
  ENABLE_RETURN_POLICY: config.ENABLE_RETURN_POLICY,
  RETURN_POLICY_LOG_ONLY: config.RETURN_POLICY_LOG_ONLY,
  TIME_AWAY_DISABLE_MIN_GUARDS: config.TIME_AWAY_DISABLE_MIN_GUARDS,
  TIME_AWAY_BRIEF_MS: config.TIME_AWAY_BRIEF_MS,
  TIME_AWAY_LONG_MS: config.TIME_AWAY_LONG_MS,
  TIME_AWAY_STALE_MS: config.TIME_AWAY_STALE_MS,
};



