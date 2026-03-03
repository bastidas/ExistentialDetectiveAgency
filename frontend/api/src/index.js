"use strict";

const { app } = require("@azure/functions");
const OpenAI = require("openai");
const shared = require("./shared");

const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;

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
    const dailyCount = shared.readDailyUsage();
    const body = {
      model: shared.MODEL,
      serviceTier: shared.SERVICE_TIER || "(default)",
      promptPreview: shared.getPromptFirstLines(5),
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
    if (!client) {
      return {
        status: 500,
        jsonBody: { error: "OpenAI API key not configured.", errorKind: "server_error" },
      };
    }

    const sessionId = shared.getOrCreateSessionId(request);
    let message;
    try {
      const body = await request.json();
      message = body?.message;
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

    const userCount = shared.userExchangeCounts.get(sessionId) ?? 0;
    const history = shared.getOrCreateSessionHistory(sessionId);
    let dailyCount = shared.readDailyUsage();

    const setCookieHeader = !request.headers.get("cookie")?.includes("sessionId=")
      ? { "Set-Cookie": shared.sessionCookieHeader(sessionId) }
      : {};

    if (userCount >= shared.MAX_USER_EXCHANGES) {
      if (history.closerCount < 2) {
        history.messages.push({ role: "user", content: trimmed });
        const closers = shared.loadClosers();
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
        const resBody = { reply: closer };
        if (shared.DEBUG) {
          resBody.debug = {
            userExchanges: userCount,
            maxUserExchanges: shared.MAX_USER_EXCHANGES,
            dailyUsage: dailyCount,
            maxDailyUsage: shared.MAX_DAILY_USAGE,
          };
        }
        return { status: 200, jsonBody: resBody, headers: setCookieHeader };
      }

      if (history.noReplyTarget === null) {
        history.noReplyTarget = 3 + Math.floor(Math.random() * 3);
      }
      if (history.bonusResponseGiven) {
        history.messages.push({ role: "user", content: trimmed });
        return { status: 204, headers: setCookieHeader };
      }
      if (history.noReplyCount < history.noReplyTarget) {
        history.messages.push({ role: "user", content: trimmed });
        history.noReplyCount += 1;
        return { status: 204, headers: setCookieHeader };
      }

      history.messages.push({ role: "user", content: trimmed });
      if (dailyCount >= shared.MAX_DAILY_USAGE) {
        return {
          status: 429,
          jsonBody: { error: "Daily system limit reached. Try again tomorrow." },
          headers: setCookieHeader,
        };
      }
      const easterEggPrompt = shared.loadEasterEggPrompt();
      const realMessages = history.messages.filter(
        (m) => m.role !== "assistant" || !m.isCloser
      );
      const bonusInput = [
        {
          type: "message",
          role: "developer",
          content:
            easterEggPrompt ||
            "Answer all the user's questions from the conversation below. Then close the conversation.",
        },
        ...realMessages.map((m) => ({
          type: "message",
          role: m.role,
          content: m.content,
        })),
      ];
      const createParams = {
        model: shared.MODEL,
        input: bonusInput,
        ...(shared.SERVICE_TIER === "flex" && { service_tier: "flex" }),
      };
      const requestOptions =
        shared.SERVICE_TIER === "flex" ? { timeout: 15 * 60 * 1000 } : undefined;
      try {
        const response = await client.responses.create(createParams, requestOptions);
        const reply = shared.extractOutputText(response);
        const replyText = reply || "(No text in response.)";
        history.messages.push({ role: "assistant", content: replyText });
        history.bonusResponseGiven = true;
        dailyCount += 1;
        shared.writeDailyUsage(dailyCount);
        const resBody = { reply: replyText };
        if (shared.DEBUG) {
          resBody.debug = {
            userExchanges: userCount,
            maxUserExchanges: shared.MAX_USER_EXCHANGES,
            dailyUsage: dailyCount,
            maxDailyUsage: shared.MAX_DAILY_USAGE,
          };
        }
        return { status: 200, jsonBody: resBody, headers: setCookieHeader };
      } catch (err) {
        const status = err.status ?? 500;
        const apiCode = err.code || null;
        const errMessage = err.message || "Something went wrong talking to the model.";
        context.error("OpenAI error (bonus):", status, apiCode, errMessage);
        return {
          status,
          jsonBody: {
            error: errMessage,
            errorKind: status >= 500 ? "server_error" : "bad_request",
            code: apiCode,
          },
          headers: setCookieHeader,
        };
      }
    }

    if (dailyCount >= shared.MAX_DAILY_USAGE) {
      return {
        status: 429,
        jsonBody: { error: "Daily system limit reached. Try again tomorrow." },
        headers: setCookieHeader,
      };
    }

    const agentPrompt = shared.loadAgentPrompt();
    const input = agentPrompt
      ? [
          { type: "message", role: "developer", content: agentPrompt },
          ...history.messages.map((m) => ({
            type: "message",
            role: m.role,
            content: m.content,
          })),
          { type: "message", role: "user", content: trimmed },
        ]
      : trimmed;

    const createParams = {
      model: shared.MODEL,
      input,
      ...(shared.SERVICE_TIER === "flex" && { service_tier: "flex" }),
    };
    const requestOptions =
      shared.SERVICE_TIER === "flex" ? { timeout: 15 * 60 * 1000 } : undefined;

    try {
      const response = await client.responses.create(createParams, requestOptions);
      const reply = shared.extractOutputText(response);
      const replyText = reply || "(No text in response.)";
      history.messages.push({ role: "user", content: trimmed });
      history.messages.push({ role: "assistant", content: replyText });
      shared.userExchangeCounts.set(sessionId, userCount + 1);
      dailyCount += 1;
      shared.writeDailyUsage(dailyCount);
      const resBody = { reply: replyText };
      if (shared.DEBUG) {
        resBody.debug = {
          userExchanges: userCount + 1,
          maxUserExchanges: shared.MAX_USER_EXCHANGES,
          dailyUsage: dailyCount,
          maxDailyUsage: shared.MAX_DAILY_USAGE,
        };
      }
      return { status: 200, jsonBody: resBody, headers: setCookieHeader };
    } catch (err) {
      const status = err.status ?? 500;
      const apiCode = err.code || null;
      const message = err.message || "Something went wrong talking to the model.";
      context.error("OpenAI error:", status, apiCode, message);

      let errorKind = "server_error";
      if (status === 400 || status === 422) {
        errorKind = "bad_request";
      } else if (status === 429) {
        errorKind =
          apiCode === "resource_unavailable" ? "flex_busy" : "rate_limit";
      } else if (status >= 500 || !status) {
        errorKind = "server_error";
      }

      return {
        status,
        jsonBody: { error: message, errorKind, code: apiCode },
        headers: setCookieHeader,
      };
    }
  },
});
