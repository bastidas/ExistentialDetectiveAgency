"use strict";

const { app } = require("@azure/functions");
const OpenAI = require("openai");
const shared = require("./shared");

const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;
const dailyUsageStore = shared.createMemoryDailyUsageStore();

app.http("debug", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "debug",
  handler: async (request, context) => {
    if (!shared.DEBUG) {
      return { status: 404 };
    }
    const sessionId = shared.getOrCreateSessionId(request);
    const userExchangeCount = shared.userExchangeCounts.get(sessionId) ?? 0;
    const dailyCount = dailyUsageStore.readDailyUsage();
    const promptPreview = shared.getPromptFirstLines(5);
    const body = {
      devMode: shared.DEV_MODE,
      model: shared.MODEL,
      serviceTier: shared.SERVICE_TIER || "(default)",
      promptPreview,
      promptFilePath: shared.PROMPT_FILE,
      promptPreviewFound: promptPreview.length > 0,
      userExchangeCount,
      maxUserExchanges: shared.MAX_USER_EXCHANGES,
      dailyCount,
      maxDailyUsage: shared.MAX_DAILY_USAGE,
    };
    const headers = {};
    const cookies = shared.parseCookieHeader(request.headers.get("cookie"));
    if (!cookies.sessionId) {
      headers["Set-Cookie"] = shared.sessionCookieHeader(sessionId);
    }
    return {
      status: 200,
      jsonBody: body,
      headers,
    };
  },
});

app.http("chat", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "chat",
  handler: async (request, context) => {
    const sessionId = shared.getOrCreateSessionId(request);
    let message;
    let contentWidthChars = null;
    try {
      const body = await request.json();
      message = body?.message;
      const raw = body?.contentWidthChars;
      if (typeof raw === "number" && raw > 0) contentWidthChars = Math.round(raw);
    } catch (_) {
      message = null;
    }
    if (typeof message !== "string" || !message.trim()) {
      return {
        status: 400,
        jsonBody: { error: "Missing or invalid message." },
      };
    }
    const trimmed = message.trim();

    const headers = !request.headers.get("cookie")?.includes("sessionId=")
      ? { "Set-Cookie": shared.sessionCookieHeader(sessionId) }
      : {};

    if (!client && !shared.DEV_MODE) {
      return {
        status: 500,
        jsonBody: {
          error:
            shared.FRIENDLY_API_KEY_MESSAGE ||
            "The keys to this universe are in your hand, but where is the lock?",
          errorKind: "server_error",
        },
        headers,
      };
    }

    const result = await shared.handleChatRequest(sessionId, trimmed, {
      openaiClient: client,
      dailyUsageStore,
      debug: shared.DEBUG,
      contentWidthChars: contentWidthChars ?? undefined,
    });

    if (result.status === 204) {
      return { status: 204, headers };
    }
    return {
      status: result.status,
      jsonBody: result.body,
      headers,
    };
  },
});

app.http("philosopherDialog", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "philosopher-dialog",
  handler: async (request, context) => {
    const sessionId = shared.getOrCreateSessionId(request);
    const headers = !request.headers.get("cookie")?.includes("sessionId=")
      ? { "Set-Cookie": shared.sessionCookieHeader(sessionId) }
      : {};
    let body = {};
    try {
      body = (await request.json()) || {};
    } catch (_) {}
    const result = await shared.handlePhilosopherDialogRequest(sessionId, body, {
      openaiClient: client,
      debug: shared.DEBUG,
    });
    return {
      status: result.status,
      jsonBody: result.body,
      headers,
    };
  },
});
