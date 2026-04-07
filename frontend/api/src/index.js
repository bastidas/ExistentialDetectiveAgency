"use strict";

// Load frontend/.env when this entry runs without frontend/server.js (e.g. Azure Functions local).
try {
  const path = require("path");
  require("dotenv").config({
    path: path.join(__dirname, "..", "..", ".env"),
  });
} catch (_) {
  /* optional dev dependency path */
}

const { app } = require("@azure/functions");
const OpenAI = require("openai");
const config = require("./config");
const shared = require("./shared");

const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey
  ? new OpenAI({
      apiKey,
      timeout: config.OPENAI_TIMEOUT_MS,
      maxRetries: 1,
    })
  : null;
const dailyUsageStore = shared.createMemoryDailyUsageStore();

// ---------------------------------------------------------------------------
// Azure Functions HTTP endpoints
// ---------------------------------------------------------------------------

app.http("config", {
	route: "config",
	methods: ["GET"],
	authLevel: "anonymous",
	handler: async (request) => {
		return {
			status: 200,
			jsonBody: {
				devMode: !!shared.DEV,
				debugLogs: !!shared.DEBUG_LOGS,
				debugLlm: !!shared.DEBUG_LLM,
				debugState: shared.DEBUG_STATE_LEVEL,
			},
		};
	},
});

app.http("chatState", {
	route: "chat-state",
	methods: ["GET"],
	authLevel: "anonymous",
	handler: async (request) => {
		const sessionId = shared.getOrCreateSessionId(request);
		const snapshot = await shared.getChatStateForSession(sessionId);
		return {
			status: 200,
			jsonBody: snapshot,
			headers: {
				"Set-Cookie": shared.sessionCookieHeader(sessionId),
			},
		};
	},
});

app.http("chat", {
	route: "chat",
	methods: ["POST"],
	authLevel: "anonymous",
	handler: async (request) => {
		const sessionId = shared.getOrCreateSessionId(request);
		let body;
		try {
			body = await request.json();
		} catch (_) {
			body = null;
		}
		const message = body && typeof body.message === "string" ? body.message : "";
		if (typeof message !== "string") {
			return {
				status: 400,
				jsonBody: { error: "Missing or invalid message." },
				headers: {
					"Set-Cookie": shared.sessionCookieHeader(sessionId),
				},
			};
		}
		const trimmed = message.trim();

		const result = await shared.handleChatRequest(sessionId, trimmed, {
			openaiClient: client,
			dailyUsageStore,
			debug: shared.DEBUG_LOGS,
		});

		if (result.status === 204) {
			return {
				status: 204,
				body: "",
				headers: {
					"Set-Cookie": shared.sessionCookieHeader(sessionId),
				},
			};
		}

		return {
			status: result.status,
			jsonBody: result.body,
			headers: {
				"Set-Cookie": shared.sessionCookieHeader(sessionId),
			},
		};
	},
});

app.http("philosopherDialog", {
	route: "philosopher-dialog",
	methods: ["POST"],
	authLevel: "anonymous",
	handler: async () => {
		// Endpoint kept for backward compatibility; frontend no longer uses it.
		return {
			status: 410,
			jsonBody: { error: "philosopher-dialog endpoint has been deprecated." },
		};
	},
});
