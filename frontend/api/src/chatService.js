"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function logInfo(...args) {
  console.log("[chatService]", ...args);
}

function logDebug(...args) {
  if (config.DEBUG_LOGS) {
    console.log("[chatService DEBUG]", ...args);
  }
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
  const currentTurn =
    typeof next.turn_count === "number" && Number.isFinite(next.turn_count)
      ? next.turn_count
      : 0;

  next.turn_count = currentTurn + 1;

  const shouldBeginClosure = next.turn_count >= config.CLOSURE_TURN_THRESHOLD;
  next.should_begin_closure = shouldBeginClosure;
  next.mode = shouldBeginClosure ? "closure" : "normal";

  return next;
}


// ---------------------------------------------------------------------------
// Turn envelope helpers (for callers / client surface)
// ---------------------------------------------------------------------------

function buildTurnEnvelope(state, userInput) {
  const s = state && typeof state === "object" ? state : {};
  const turnCount =
    typeof s.turn_count === "number" && Number.isFinite(s.turn_count)
      ? s.turn_count
      : 0;

  return {
    // Raw machine state we evolve each turn
    conversation_state: s,

    // Convenience top-level mirrors
    turn_count: turnCount,
    should_begin_closure: !!s.should_begin_closure,
    mode: s.mode || "normal",

    // Alias used by the detective in prompts – kept explicit
    detective_mode: s.mode || "normal",

    // What the user just said for this turn
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

function getOrCreateSessionState(sessionId) {
  let entry = sessionStates.get(sessionId);
  if (!entry) {
    entry = {
      state: null,
      history: "",
    };
    sessionStates.set(sessionId, entry);
  }
  return entry;
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

function buildSystemMessageForAgent(agentKey, conversationState) {
  const prompts = config.agentPrompts[agentKey] || { self: "", others: "" };
  const schema = config.agentSchemas[agentKey] || null;

  return {
    role: "system",
    content: JSON.stringify({
      type: "agent_context",
      identity: String(prompts.self || "").trim(),
      other_agents: String(prompts.others || "").trim(),
      conversation_state: conversationState,
      output_schema: schema,
      rules: {
        detective_speaks_to_user_only: true,
        philosophers_may_debate_each_other: true,
        philosophers_do_not_address_user: true,
        revelation_follows_narrative_phase: true
      }
    })
  };
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
  history,
  userInput,
}) {
  const systemMessage = buildSystemMessageForAgent(agentKey, conversationState);
  const userMessage = buildUserMessage(history, userInput);
  const schema = config.agentSchemas[agentKey] || null;

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

  logDebug("callAgent params for", agentKey, JSON.stringify(params, null, 2));

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
      console.error(err);
    }
    return {};
  }
}


async function callDetective(openai, state, history, userInput) {
  return callAgent({
    openai,
    agentKey: "detective",
    conversationState: state,
    history,
    userInput,
  });
}

async function callLumen(openai, state, history, userInput) {
  return callAgent({
    openai,
    agentKey: "lumen",
    conversationState: state,
    history,
    userInput,
  });
}

async function callUmbra(openai, state, history, userInput) {
  return callAgent({
    openai,
    agentKey: "umbra",
    conversationState: state,
    history,
    userInput,
  });
}

// Bonus final exchange: detective persona + final (closing) instructions only
async function callFinalDetective(openai, state, history, userInput) {
  return callAgent({
    openai,
    agentKey: "final_detective",
    conversationState: state,
    history,
    userInput,
  });
}


// The Orchestrator Loop (the whole system
async function runTurn(openai, state, history, userInput) {
  logInfo("runTurn start", {
    hasState: !!state,
    historyLength: history ? history.length : 0,
  });

  // 1. Summarize if needed
  history = await maybeSummarize(openai, history);

  // 2. Advance conversation_state (turn_count, should_begin_closure for detective)
  state = normalizeConversationState(state);
  logDebug("conversation_state after normalize", JSON.stringify(state, null, 2));

  // 3. Normal multi‑agent turn (detective always sees should_begin_closure in state)
  const [lumenResult, umbraResult, detectiveResult] = await Promise.all([
    callLumen(openai, state, history, userInput),
    callUmbra(openai, state, history, userInput),
    callDetective(openai, state, history, userInput),
  ]);

  const merged = mergeAgentOutputs({
    userMessage: userInput,
    lumen: lumenResult,
    umbra: umbraResult,
    detective: detectiveResult,
  });

  history = appendTurnToHistory(history, merged);

  logDebug("runTurn end", { turn_count: state.turn_count });

  const envelope = buildTurnEnvelope(state, userInput);
  const agents = {
    lumen: lumenResult,
    umbra: umbraResult,
    detective: detectiveResult,
  };
  return { history, state, merged, envelope, agents };
}



async function summarizeHistory(openai, history) {
  // In OFFLINE mode, we cannot call the model; return a crude truncation.
  if (config.OFFLINE) {
    logInfo("OFFLINE=1: skipping summarizeHistory model call");
    if (history.length <= config.MAX_HISTORY_LENGTH) return history;
    return history.slice(-config.MAX_HISTORY_LENGTH);
  }

  const prompt = `
Summarize the following conversation into a compact memory that preserves:
- user goals
- emotional state
- key insights from each agent
- unresolved questions
- important philosophical tensions
- narrative arc progression

Do NOT include dialogue. Produce a neutral summary.

Conversation:
${history}

Summary:
`;
  try {
    const response = await openai.chat.completions.create({
      model: config.MODEL,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices?.[0]?.message?.content || "";
    return String(content || "").trim();
  } catch (err) {
    logInfo("Error in summarizeHistory:", err.message || err);
    if (config.DEBUG_LOGS) console.error(err);
    if (history.length <= config.MAX_HISTORY_LENGTH) return history;
    return history.slice(-config.MAX_HISTORY_LENGTH);
  }
}

// Keep a trailing slice of history so the model still sees recent dialogue after summarization
const RECENT_HISTORY_TAIL_LENGTH = Math.min(
  2000,
  Math.floor(config.MAX_HISTORY_LENGTH / 2)
);

async function maybeSummarize(openai, history, maxLength = config.MAX_HISTORY_LENGTH) {
  if (!history || history.length < maxLength) return history || "";

  logInfo("History exceeds max length; summarizing.");
  const summary = await summarizeHistory(openai, history);
  const recentTail =
    history.length > RECENT_HISTORY_TAIL_LENGTH
      ? history.slice(-RECENT_HISTORY_TAIL_LENGTH).trim()
      : history.trim();

  return `# MEMORY SUMMARY\n${summary}\n\n# RECENT HISTORY\n${recentTail}`;
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

  const prevUserCount = userExchangeCounts.get(sessionId) ?? 0;
  let dailyCount =
    dailyUsageStore && typeof dailyUsageStore.readDailyUsage === "function"
      ? dailyUsageStore.readDailyUsage()
      : 0;

  if (debug) {
    console.log(
      "[DEBUG] chat user exchanges:",
      prevUserCount + "/" + config.MAX_USER_EXCHANGES
    );
    console.log(
      "[DEBUG] chat daily usage:",
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

  const session = getOrCreateSessionState(sessionId);
  const { history: prevHistory, state: prevState } = session;

  // Bonus final exchange: one more turn with final_detective (persona + closing instructions) only
  if (prevUserCount === config.MAX_USER_EXCHANGES) {
    let history = await maybeSummarize(client, prevHistory);
    let state = normalizeConversationState(prevState);
    const finalResult = await callFinalDetective(client, state, history, trimmed);
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

    let reply = "";
    if (finalResult && finalResult.detective_response != null) {
      reply = String(finalResult.detective_response).trim();
    }
    if (!reply && merged) {
      const marker = "[DETECTIVE]:";
      const idx = merged.lastIndexOf(marker);
      if (idx >= 0) reply = merged.slice(idx + marker.length).trim();
    }

    const envelope = buildTurnEnvelope(state, trimmed);
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
    };
    body.debug = buildDebugBody(nextUserCount, newDailyCount);
    body.limitReached = true;

    return { status: 200, body };
  }

  const { history, state, merged, envelope, agents } = await runTurn(
    client,
    prevState,
    prevHistory,
    trimmed
  );

  session.history = history;
  session.state = state;

  // If merged is empty, we treat this as a no-reply turn (closure fully reached).
  if (!merged || !String(merged).trim()) {
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
    envelope,
  };

  body.debug = buildDebugBody(nextUserCount, newDailyCount);

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

  // If there is no textual reply, just send the final container.
  if (!reply) {
    await onEvent({ type: "final", status: 200, body });
    return result;
  }

  const text = String(reply);
  const chunkSize = 12;
  const delayMs = 30;

  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    if (!chunk) continue;
    await onEvent({ type: "delta", agent: "detective", text: chunk });
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
};



