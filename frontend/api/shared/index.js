"use strict";

const path = require("path");
const fs = require("fs");

const SHARED_DIR = __dirname;
const FRONTEND_DIR = path.join(SHARED_DIR, "..");

function resolvePromptsDir() {
  if (process.env.PROMPTS_DIR) {
    const envDir = path.resolve(process.cwd(), process.env.PROMPTS_DIR);
    if (fs.existsSync(envDir)) return envDir;
    if (fs.existsSync(process.env.PROMPTS_DIR)) return path.resolve(process.env.PROMPTS_DIR);
  }
  // When running from api/shared (e.g. Azure Functions), prompts live at api/prompts
  const apiLocalPrompts = path.resolve(__dirname, "..", "prompts");
  if (fs.existsSync(apiLocalPrompts)) return apiLocalPrompts;
  const candidates = [
    path.join(FRONTEND_DIR, "api", "prompts"),
    path.resolve(process.cwd(), "api", "prompts"),
    path.resolve(process.cwd(), "frontend", "api", "prompts"),
    path.resolve(process.cwd(), "prompts"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return path.resolve(dir);
    } catch (_) {}
  }
  return path.resolve(FRONTEND_DIR, "api", "prompts");
}

const PROMPTS_DIR = resolvePromptsDir();
const PROMPT_FILE =
  process.env.AGENT_PROMPT_FILE || path.join(PROMPTS_DIR, "prompt.md");
const CLOSERS_FILE =
  process.env.CLOSERS_FILE || path.join(PROMPTS_DIR, "closers.md");
const EASTER_EGG_PROMPT_FILE =
  process.env.EASTER_EGG_PROMPT_FILE ||
  path.join(PROMPTS_DIR, "easter_egg_prompt.md");
const PHIL_ANNOTATIONS_FILE =
  process.env.PHIL_ANNOTATIONS_FILE ||
  path.join(PROMPTS_DIR, "phil_annotations.json");
const LEFT_PHILOSOPHER_PROMPT_FILE = path.join(PROMPTS_DIR, "left_philospher.md");
const RIGHT_PHILOSOPHER_PROMPT_FILE = path.join(PROMPTS_DIR, "right_philospher.md");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const SERVICE_TIER = process.env.OPENAI_SERVICE_TIER || null;
const MAX_USER_EXCHANGES = parseInt(process.env.MAX_USER_EXCHANGES, 10) || 5;
const MAX_DAILY_USAGE = parseInt(process.env.MAX_DAILY_USAGE, 10) || 100;
const DEBUG = /^(1|true|yes)$/i.test(process.env.DEBUG || "");
const DEV_MODE = process.env.MODE === "dev";
const DEV_MODE_REPLY =
  "This is a dev-mode reply. The AI backend is disabled. Set MODE to something other than 'dev' to use the real model.";

const userExchangeCounts = new Map();
const sessionHistories = new Map();

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

function getOrCreateSessionHistory(sessionId) {
  let h = sessionHistories.get(sessionId);
  if (!h) {
    h = {
      messages: [],
      usedCloserIndexes: new Set(),
      closerCount: 0,
      noReplyTarget: null,
      noReplyCount: 0,
      bonusResponseGiven: false,
    };
    sessionHistories.set(sessionId, h);
  }
  return h;
}

function getStructuredOutputSchema() {
  return {
    type: "object",
    properties: {
      agent_response: { type: "string", description: "Your reply in character as the existential detective." },
      left_philosopher_response: { type: "string", description: "In-character response from the left philosopher." },
      left_philosopher_notes: {
        type: "array",
        items: { type: "string" },
        description: "Words or phrases the left philosopher jots down.",
      },
      right_philosopher_response: { type: "string", description: "In-character response from the right philosopher." },
      right_philosopher_notes: {
        type: "array",
        items: { type: "string" },
        description: "Words or phrases the right philosopher jots down.",
      },
    },
    required: [
      "agent_response",
      "left_philosopher_response",
      "left_philosopher_notes",
      "right_philosopher_response",
      "right_philosopher_notes",
    ],
    additionalProperties: false,
  };
}

function loadAgentPrompt() {
  try {
    if (fs.existsSync(PROMPT_FILE)) {
      return fs.readFileSync(PROMPT_FILE, "utf8").trim();
    }
  } catch (err) {
    console.warn("Could not load agent prompt from", PROMPT_FILE, err.message);
  }
  return null;
}

function loadLeftPhilosopherPrompt() {
  try {
    if (fs.existsSync(LEFT_PHILOSOPHER_PROMPT_FILE)) {
      return fs.readFileSync(LEFT_PHILOSOPHER_PROMPT_FILE, "utf8").trim();
    }
  } catch (err) {
    console.warn("Could not load left philosopher prompt from", LEFT_PHILOSOPHER_PROMPT_FILE, err.message);
  }
  return null;
}

function loadRightPhilosopherPrompt() {
  try {
    if (fs.existsSync(RIGHT_PHILOSOPHER_PROMPT_FILE)) {
      return fs.readFileSync(RIGHT_PHILOSOPHER_PROMPT_FILE, "utf8").trim();
    }
  } catch (err) {
    console.warn("Could not load right philosopher prompt from", RIGHT_PHILOSOPHER_PROMPT_FILE, err.message);
  }
  return null;
}

function getPromptFirstLines(maxLines = 5) {
  const toTry = [
    PROMPT_FILE,
    path.resolve(__dirname, "..", "prompts", "prompt.md"),
    path.join(process.cwd(), "api", "prompts", "prompt.md"),
    path.join(process.cwd(), "prompts", "prompt.md"),
    path.join(FRONTEND_DIR, "api", "prompts", "prompt.md"),
  ];
  for (const filePath of toTry) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        const text = fs.readFileSync(filePath, "utf8");
        const lines = text.split(/\r?\n/).slice(0, maxLines);
        if (lines.length) return lines;
      }
    } catch (err) {
      if (filePath === PROMPT_FILE) {
        console.warn("Could not read prompt file from", PROMPT_FILE, err.message);
      }
    }
  }
  return [];
}

function loadClosers() {
  try {
    if (fs.existsSync(CLOSERS_FILE)) {
      const text = fs.readFileSync(CLOSERS_FILE, "utf8");
      return text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch (err) {
    console.warn("Could not load closers from", CLOSERS_FILE, err.message);
  }
  return [
    "I find this line of questioning overwhelming.",
    "Ahh I think our time is up.",
  ];
}

const VALID_MODES = ["note", "rewrite", "keyword", "strike", "highlight"];

function loadPhilAnnotations() {
  const candidates = [
    path.resolve(__dirname, "..", "prompts", "phil_annotations.json"),
    PHIL_ANNOTATIONS_FILE,
    path.join(FRONTEND_DIR, "public", "data", "phil_annotations.json"),
    path.join(PROMPTS_DIR, "phil_annotations.json"),
    path.resolve(process.cwd(), "api", "prompts", "phil_annotations.json"),
    path.resolve(process.cwd(), "frontend", "api", "prompts", "phil_annotations.json"),
    path.resolve(process.cwd(), "frontend", "public", "data", "phil_annotations.json"),
    path.resolve(process.cwd(), "prompts", "phil_annotations.json"),
  ];
  if (process.env.PHIL_ANNOTATIONS_FILE) {
    candidates.unshift(path.resolve(process.cwd(), process.env.PHIL_ANNOTATIONS_FILE));
  }
  if (process.env.PROMPTS_DIR) {
    candidates.push(
      path.join(path.resolve(process.env.PROMPTS_DIR), "phil_annotations.json")
    );
  }
  let filePath = null;
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      filePath = p;
      break;
    }
  }
  if (!filePath) {
    console.log("[phil-annotations] File not found. Tried:", candidates);
    return [];
  }
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      console.warn("[phil-annotations] Expected JSON array:", filePath);
      return [];
    }
    const rules = data
      .map((item) => {
        const userText = (item.userText != null ? String(item.userText) : "").trim();
        const respondText = item.respondText != null ? String(item.respondText) : "";
        const mode = (item.mode != null ? String(item.mode) : "").toLowerCase();
        return { userText, respondText, mode };
      })
      .filter(
        (r) =>
          r.userText &&
          VALID_MODES.includes(r.mode)
      );
    console.log("[phil-annotations] Loaded rules:", rules.length, "from", filePath);
    return rules;
  } catch (err) {
    console.warn(
      "[phil-annotations] Could not load:",
      filePath,
      err.message
    );
    return [];
  }
}

function loadEasterEggPrompt() {
  try {
    if (fs.existsSync(EASTER_EGG_PROMPT_FILE)) {
      return fs.readFileSync(EASTER_EGG_PROMPT_FILE, "utf8").trim();
    }
  } catch (err) {
    console.warn(
      "Could not load easter egg prompt from",
      EASTER_EGG_PROMPT_FILE,
      err.message
    );
  }
  return null;
}

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  if (!response.output || !Array.isArray(response.output)) return "";
  for (const item of response.output) {
    if (item.content && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" && c.text) return c.text;
      }
    }
  }
  return "";
}

function buildDebugBody(userExchanges, dailyUsage) {
  return {
    userExchanges,
    maxUserExchanges: MAX_USER_EXCHANGES,
    dailyUsage,
    maxDailyUsage: MAX_DAILY_USAGE,
  };
}

function handleUserAtLimitCloser(history, trimmed, userCount, dailyCount, debug) {
  history.messages.push({ role: "user", content: trimmed });
  const closers = loadClosers();
  const available = closers.length
    ? closers.map((_, i) => i).filter((i) => !history.usedCloserIndexes.has(i))
    : [];
  const index = available.length
    ? available[Math.floor(Math.random() * available.length)]
    : Math.floor(Math.random() * closers.length);
  const closer = closers[index] ?? "I think our time is up.";
  history.messages.push({ role: "assistant", content: closer, isCloser: true });
  history.usedCloserIndexes.add(index);
  history.closerCount += 1;
  if (debug) console.log("[DEBUG] user limit reached: replying with closer, stored user message and closer in history");
  const body = { reply: closer };
  if (debug) body.debug = buildDebugBody(userCount, dailyCount);
  return { status: 200, body };
}

async function handleBonusTurn(client, history, userCount, dailyUsageStore, debug) {
  const easterEggPrompt = loadEasterEggPrompt();
  if (!easterEggPrompt) console.warn("[DEBUG] No easter egg prompt found, using fallback");
  const realMessages = history.messages.filter((m) => m.role !== "assistant" || !m.isCloser);
  const bonusInput = [
    {
      type: "message",
      role: "developer",
      content: easterEggPrompt || "Answer all the user's questions from the conversation below. Then close the conversation.",
    },
    ...realMessages.map((m) => ({ type: "message", role: m.role, content: m.content })),
  ];
  if (debug) {
    console.log("[DEBUG] Easter egg: using easter_egg_prompt, history has", realMessages.length, "messages (real Q&A only, no closers)");
    console.log("[DEBUG] Sending to OpenAI (bonus turn):");
    console.log(JSON.stringify(bonusInput, null, 2));
  }
  const createParams = { model: MODEL, input: bonusInput, ...(SERVICE_TIER === "flex" && { service_tier: "flex" }) };
  const requestOptions = SERVICE_TIER === "flex" ? { timeout: 15 * 60 * 1000 } : undefined;
  const response = await client.responses.create(createParams, requestOptions);
  const replyText = extractOutputText(response) || "(No text in response.)";
  history.messages.push({ role: "assistant", content: replyText });
  history.bonusResponseGiven = true;
  const dailyCount = dailyUsageStore.readDailyUsage() + 1;
  dailyUsageStore.writeDailyUsage(dailyCount);
  if (debug) console.log("[DEBUG] Easter egg bonus response sent, will not reply again for this session");
  const body = { reply: replyText };
  if (debug) body.debug = buildDebugBody(userCount, dailyCount);
  return { status: 200, body };
}

function buildChatDeveloperContent(contentWidthChars) {
  const structuredOutputInstruction = [
    "You must respond with a single JSON object with exactly these five keys (no extra keys):",
    "agent_response, left_philosopher_response, left_philosopher_notes, right_philosopher_response, right_philosopher_notes.",
    "agent_response: your reply in character as the existential detective (main reply to the user).",
    "left_philosopher_response: a short in-character response from the left philosopher persona.",
    "left_philosopher_notes: array of words or phrases the left philosopher jots down.",
    "right_philosopher_response: a short in-character response from the right philosopher persona.",
    "right_philosopher_notes: array of words or phrases the right philosopher jots down.",
  ].join("\n");
  const developerParts = [structuredOutputInstruction];
  if (typeof contentWidthChars === "number" && contentWidthChars > 0) {
    developerParts.push(
      "## Note paper\n\nThe philosopher note paper has approximately " +
        contentWidthChars +
        " characters per line. Use the full width when helpful—phrases and marginal notes may be longer when the paper is larger."
    );
  }
  const agentPrompt = loadAgentPrompt();
  const leftPhilosopherPrompt = loadLeftPhilosopherPrompt();
  const rightPhilosopherPrompt = loadRightPhilosopherPrompt();
  if (agentPrompt) developerParts.push("## Agent (existential detective)\n\n" + agentPrompt);
  if (leftPhilosopherPrompt) developerParts.push("## Left philosopher\n\n" + leftPhilosopherPrompt);
  if (rightPhilosopherPrompt) developerParts.push("## Right philosopher\n\n" + rightPhilosopherPrompt);
  return developerParts.join("\n\n---\n\n");
}

function parseStructuredResponse(rawText, logPrefix) {
  let parsed;
  try {
    parsed = JSON.parse(rawText || "{}");
  } catch (parseErr) {
    console.error((logPrefix || "[structured-output]") + " JSON parse failed:", parseErr.message, "raw:", rawText?.slice(0, 200));
    parsed = {};
  }
  const replyText = parsed.agent_response != null && String(parsed.agent_response).trim()
    ? String(parsed.agent_response).trim()
    : rawText?.trim() || "(No reply.)";
  const leftPhilosopherResponse = parsed.left_philosopher_response != null ? String(parsed.left_philosopher_response) : "";
  const leftPhilosopherNotes = Array.isArray(parsed.left_philosopher_notes) ? parsed.left_philosopher_notes.map((s) => String(s)) : [];
  const rightPhilosopherResponse = parsed.right_philosopher_response != null ? String(parsed.right_philosopher_response) : "";
  const rightPhilosopherNotes = Array.isArray(parsed.right_philosopher_notes) ? parsed.right_philosopher_notes.map((s) => String(s)) : [];
  return { replyText, leftPhilosopherResponse, leftPhilosopherNotes, rightPhilosopherResponse, rightPhilosopherNotes };
}

function normalizeOpenAIError(err) {
  const status = err.status ?? 500;
  const apiCode = err.code || null;
  const message = err.message || "Something went wrong talking to the model.";
  let errorKind = "server_error";
  if (status === 400 || status === 422) errorKind = "bad_request";
  else if (status === 429) errorKind = apiCode === "resource_unavailable" ? "flex_busy" : "rate_limit";
  else if (status >= 500 || !status) errorKind = "server_error";
  return { status, body: { error: message, errorKind, code: apiCode } };
}

async function handleChatRequest(sessionId, trimmed, options) {
  const { openaiClient: client, dailyUsageStore, debug, contentWidthChars } = options || {};
  const userCount = userExchangeCounts.get(sessionId) ?? 0;
  const history = getOrCreateSessionHistory(sessionId);
  let dailyCount = dailyUsageStore.readDailyUsage();

  if (DEV_MODE) {
    history.messages.push({ role: "user", content: trimmed });
    history.messages.push({ role: "assistant", content: DEV_MODE_REPLY });
    userExchangeCounts.set(sessionId, userCount + 1);
    const body = { reply: DEV_MODE_REPLY };
    if (debug) body.debug = buildDebugBody(userCount + 1, dailyCount);
    return { status: 200, body };
  }

  if (debug) {
    console.log("[DEBUG] user exchanges:", userCount + "/" + MAX_USER_EXCHANGES);
    console.log("[DEBUG] daily usage:", dailyCount + "/" + MAX_DAILY_USAGE);
  }

  if (userCount >= MAX_USER_EXCHANGES) {
    if (history.closerCount < 2) {
      return handleUserAtLimitCloser(history, trimmed, userCount, dailyCount, debug);
    }
    if (history.noReplyTarget === null) {
      history.noReplyTarget = 3 + Math.floor(Math.random() * 3);
      if (debug) console.log("[DEBUG] noReplyTarget set to", history.noReplyTarget);
    }
    if (history.bonusResponseGiven) {
      history.messages.push({ role: "user", content: trimmed });
      if (debug) console.log("[DEBUG] no response (bonus already given), stored user message in history");
      return { status: 204, body: null };
    }
    if (history.noReplyCount < history.noReplyTarget) {
      history.messages.push({ role: "user", content: trimmed });
      history.noReplyCount += 1;
      if (debug) console.log("[DEBUG] no response", history.noReplyCount + "/" + history.noReplyTarget, ", stored user message in history");
      return { status: 204, body: null };
    }
    history.messages.push({ role: "user", content: trimmed });
    if (dailyCount >= MAX_DAILY_USAGE) {
      return { status: 429, body: { error: "Daily system limit reached. Try again tomorrow." } };
    }
    try {
      return await handleBonusTurn(client, history, userCount, dailyUsageStore, debug);
    } catch (err) {
      console.error("OpenAI error (bonus):", err.status ?? 500, err.code || null, err.message);
      return normalizeOpenAIError(err);
    }
  }

  if (dailyCount >= MAX_DAILY_USAGE) {
    return { status: 429, body: { error: "Daily system limit reached. Try again tomorrow." } };
  }

  const developerContent = buildChatDeveloperContent(contentWidthChars);
  const input = developerContent.trim().length > 0
    ? [
        { type: "message", role: "developer", content: developerContent },
        ...history.messages.map((m) => ({ type: "message", role: m.role, content: m.content })),
        { type: "message", role: "user", content: trimmed },
      ]
    : [
        ...history.messages.map((m) => ({ type: "message", role: m.role, content: m.content })),
        { type: "message", role: "user", content: trimmed },
      ];

  if (debug) {
    console.log("[DEBUG] Sending to OpenAI (structured output):");
    console.log(JSON.stringify(input, null, 2));
  }

  const schema = getStructuredOutputSchema();
  const createParams = {
    model: MODEL,
    input,
    text: { format: { type: "json_schema", name: "existential_detective_response", strict: true, schema } },
    ...(SERVICE_TIER === "flex" && { service_tier: "flex" }),
  };
  const requestOptions = SERVICE_TIER === "flex" ? { timeout: 15 * 60 * 1000 } : undefined;

  try {
    const response = await client.responses.create(createParams, requestOptions);
    const rawText = extractOutputText(response);
    const parsed = parseStructuredResponse(rawText, "[structured-output]");
    history.messages.push({ role: "user", content: trimmed });
    history.messages.push({ role: "assistant", content: parsed.replyText });
    userExchangeCounts.set(sessionId, userCount + 1);
    dailyCount += 1;
    dailyUsageStore.writeDailyUsage(dailyCount);
    const body = {
      reply: parsed.replyText,
      leftPhilosopherResponse: parsed.leftPhilosopherResponse,
      leftPhilosopherNotes: parsed.leftPhilosopherNotes,
      rightPhilosopherResponse: parsed.rightPhilosopherResponse,
      rightPhilosopherNotes: parsed.rightPhilosopherNotes,
    };
    if (debug) body.debug = buildDebugBody(userCount + 1, dailyCount);
    return { status: 200, body };
  } catch (err) {
    console.error("OpenAI error:", err.status ?? 500, err.code || null, err.message);
    if (err.status === 400 && err.error) console.error("OpenAI 400 body:", JSON.stringify(err.error, null, 2));
    return { ...normalizeOpenAIError(err) };
  }
}

async function handlePhilosopherDialogRequest(sessionId, body, options) {
  const { openaiClient: client, debug } = options || {};
  const leftTurns = Array.isArray(body.leftPhilosopherTurns) ? body.leftPhilosopherTurns : [];
  const rightTurns = Array.isArray(body.rightPhilosopherTurns) ? body.rightPhilosopherTurns : [];
  const requestLeft = Boolean(body.requestLeft);
  const requestRight = Boolean(body.requestRight);

  if (!requestLeft && !requestRight) {
    return {
      status: 400,
      body: { error: "At least one of requestLeft or requestRight must be true." },
    };
  }

  if (!client && !DEV_MODE) {
    return {
      status: 500,
      body: { error: "OpenAI API key not configured.", errorKind: "server_error" },
    };
  }

  if (DEV_MODE) {
    if (debug) console.log("[DEBUG] Philosopher-dialog: DEV_MODE, returning empty philosopher content.");
    return {
      status: 200,
      body: {
        leftPhilosopherResponse: "",
        leftPhilosopherNotes: [],
        rightPhilosopherResponse: "",
        rightPhilosopherNotes: [],
      },
    };
  }

  const history = getOrCreateSessionHistory(sessionId);
  const leftPhilosopherPrompt = loadLeftPhilosopherPrompt();
  const rightPhilosopherPrompt = loadRightPhilosopherPrompt();

  const conversationText =
    history.messages
      .map((m) => (m.role === "user" ? "User: " : "Assistant: ") + (m.content || ""))
      .join("\n\n") || "(No conversation yet.)";

  const leftHistoryText =
    leftTurns
      .map((t, i) => {
        const r = (t.response || "").trim();
        const n = Array.isArray(t.notes) ? t.notes.filter(Boolean).join("; ") : "";
        return `Turn ${i + 1}: ${r}${r && n ? " | Notes: " + n : n ? "Notes: " + n : ""}`;
      })
      .join("\n") || "(No left philosopher history yet.)";

  const rightHistoryText =
    rightTurns
      .map((t, i) => {
        const r = (t.response || "").trim();
        const n = Array.isArray(t.notes) ? t.notes.filter(Boolean).join("; ") : "";
        return `Turn ${i + 1}: ${r}${r && n ? " | Notes: " + n : n ? "Notes: " + n : ""}`;
      })
      .join("\n") || "(No right philosopher history yet.)";

  const taskParts = [];
  if (requestLeft) taskParts.push("Left philosopher: respond to the right philosopher's recent notes/response (take your holistic metaphysical perspective).");
  if (requestRight) taskParts.push("Right philosopher: respond to the left philosopher's recent notes/response (take your reductionist metaphysical perspective).");
  const outputInstruction = [
    "You must respond with a single JSON object with exactly these five keys: agent_response, left_philosopher_response, left_philosopher_notes, right_philosopher_response, right_philosopher_notes.",
    "agent_response: leave empty string (this is a philosopher-only turn).",
    "For the philosopher side(s) NOT requested above, use empty string for response and empty array for notes.",
    "For the requested side(s): left_philosopher_response / left_philosopher_notes and/or right_philosopher_response / right_philosopher_notes as usual (short in-character response and list of words/phrases).",
  ].join("\n");

  const developerParts = [
    "## Philosopher self-dialog (no main agent reply)",
    "Below is the user–detective conversation, then the left philosopher's history, then the right philosopher's history.",
    "Your task: " + taskParts.join(" "),
    outputInstruction,
    "## User–detective conversation\n\n" + conversationText,
    "## Left philosopher history\n\n" + leftHistoryText,
    "## Right philosopher history\n\n" + rightHistoryText,
  ];
  if (leftPhilosopherPrompt) developerParts.push("## Left philosopher persona\n\n" + leftPhilosopherPrompt);
  if (rightPhilosopherPrompt) developerParts.push("## Right philosopher persona\n\n" + rightPhilosopherPrompt);

  const developerContent = developerParts.join("\n\n---\n\n");
  const input = [
    { type: "message", role: "developer", content: developerContent },
  ];

  if (debug) {
    console.log("[DEBUG] Philosopher-dialog: requestLeft=", requestLeft, "requestRight=", requestRight);
    console.log("[DEBUG] Philosopher-dialog prompt preview (first 500 chars):", developerContent.slice(0, 500));
  }

  const schema = getStructuredOutputSchema();
  const createParams = {
    model: MODEL,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "existential_detective_response",
        strict: true,
        schema,
      },
    },
    ...(SERVICE_TIER === "flex" && { service_tier: "flex" }),
  };
  const requestOptions = SERVICE_TIER === "flex" ? { timeout: 15 * 60 * 1000 } : undefined;

  try {
    const response = await client.responses.create(createParams, requestOptions);
    const rawText = extractOutputText(response);
    const parsed = parseStructuredResponse(rawText, "[philosopher-dialog]");
    const bodyOut = {
      leftPhilosopherResponse: parsed.leftPhilosopherResponse,
      leftPhilosopherNotes: parsed.leftPhilosopherNotes,
      rightPhilosopherResponse: parsed.rightPhilosopherResponse,
      rightPhilosopherNotes: parsed.rightPhilosopherNotes,
    };
    if (debug) {
      console.log("[DEBUG] Philosopher-dialog response:", {
        leftLen: parsed.leftPhilosopherResponse.length,
        leftNotes: parsed.leftPhilosopherNotes.length,
        rightLen: parsed.rightPhilosopherResponse.length,
        rightNotes: parsed.rightPhilosopherNotes.length,
      });
    }
    return { status: 200, body: bodyOut };
  } catch (err) {
    console.error("OpenAI error (philosopher-dialog):", err.status ?? 500, err.code || null, err.message);
    return normalizeOpenAIError(err);
  }
}

module.exports = {
  PROMPTS_DIR,
  PROMPT_FILE,
  CLOSERS_FILE,
  EASTER_EGG_PROMPT_FILE,
  PHIL_ANNOTATIONS_FILE,
  LEFT_PHILOSOPHER_PROMPT_FILE,
  RIGHT_PHILOSOPHER_PROMPT_FILE,
  MODEL,
  SERVICE_TIER,
  MAX_USER_EXCHANGES,
  MAX_DAILY_USAGE,
  DEBUG,
  DEV_MODE,
  DEV_MODE_REPLY,
  userExchangeCounts,
  sessionHistories,
  getOrCreateSessionHistory,
  createFileDailyUsageStore,
  createMemoryDailyUsageStore,
  getStructuredOutputSchema,
  loadAgentPrompt,
  loadLeftPhilosopherPrompt,
  loadRightPhilosopherPrompt,
  getPromptFirstLines,
  loadClosers,
  loadPhilAnnotations,
  loadPhilosopherNotes: loadPhilAnnotations,
  loadEasterEggPrompt,
  extractOutputText,
  handleChatRequest,
  handlePhilosopherDialogRequest,
};
