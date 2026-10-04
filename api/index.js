"use strict";

// Load repo-root .env when this entry runs without server-dev.js (e.g. Azure Functions).
try {
  const path = require("path");
  require("dotenv").config({
    path: path.join(__dirname, "..", ".env"),
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
				lastNClientTranscriptTurns: config.LAST_N_CLIENT_TRANSCRIPT_TURNS,
				sessionCheckpointEveryKTurns: config.SESSION_CHECKPOINT_EVERY_K_TURNS,
				sessionCheckpointMinIntervalMs: config.SESSION_CHECKPOINT_MIN_INTERVAL_MS,
				durableStorageMode: config.resolveDurableStorageMode(),
			},
		};
	},
});

app.http("chatState", {
	route: "chat-state",
	methods: ["GET"],
	authLevel: "anonymous",
	handler: async (request) => {
		const identity = shared.getOrCreateIdentity(request);
		const sessionId = identity.sessionId;
		const snapshot = await shared.getChatStateForSession(sessionId, identity.userId);
		return {
			status: 200,
			jsonBody: snapshot,
			headers: {
				"Set-Cookie": shared.identityCookieHeaders(identity),
			},
		};
	},
});

app.http("chat", {
	route: "chat",
	methods: ["POST"],
	authLevel: "anonymous",
	handler: async (request) => {
		const identity = shared.getOrCreateIdentity(request);
		const sessionId = identity.sessionId;
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
					"Set-Cookie": shared.identityCookieHeaders(identity),
				},
			};
		}
		const trimmed = message.trim();

		const result = await shared.handleChatRequest(sessionId, trimmed, {
			openaiClient: client,
			dailyUsageStore,
			debug: shared.DEBUG_LOGS,
			userId: identity.userId,
		});

		if (result.status === 204) {
			return {
				status: 204,
				body: "",
				headers: {
					"Set-Cookie": shared.identityCookieHeaders(identity),
				},
			};
		}

		return {
			status: result.status,
			jsonBody: result.body,
			headers: {
				"Set-Cookie": shared.identityCookieHeaders(identity),
			},
		};
	},
});

app.http("chatSync", {
	route: "chat-sync",
	methods: ["POST"],
	authLevel: "anonymous",
	handler: async (request) => {
		const identity = shared.getOrCreateIdentity(request);
		let body;
		try {
			body = await request.json();
		} catch (_) {
			body = {};
		}
		const result = await shared.handleChatSync(identity.sessionId, identity.userId, body || {});
		return {
			status: 200,
			jsonBody: result,
			headers: {
				"Set-Cookie": shared.identityCookieHeaders(identity),
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
