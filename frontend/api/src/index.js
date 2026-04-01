"use strict";

const { app } = require("@azure/functions");
const OpenAI = require("openai");
const shared = require("./shared");

const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;
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
				debugState: !!shared.DEBUG_STATE,
			},
		};
	},
});

app.http("debug", {
	route: "debug",
	methods: ["GET"],
	authLevel: "anonymous",
	handler: async (request) => {
		if (!shared.DEBUG_LOGS) {
			return { status: 404, body: "" };
		}
		const sessionId = shared.getOrCreateSessionId(request);
		let dailyCount = dailyUsageStore.readDailyUsage();
		if (shared.ENABLE_DURABLE_STORAGE && shared.reloadSessionFromDurable) {
			try {
				const h = await shared.reloadSessionFromDurable(sessionId);
				if (h && h.dailyCount != null) dailyCount = h.dailyCount;
			} catch (_) {}
		}
		const userExchangeCount = shared.userExchangeCounts.get(sessionId) ?? 0;
		return {
			status: 200,
			jsonBody: {
				devMode: shared.DEV,
				offline: shared.OFFLINE,
				debugLogs: !!shared.DEBUG_LOGS,
				debugLlm: !!shared.DEBUG_LLM,
				debugState: !!shared.DEBUG_STATE,
				model: shared.MODEL,
				serviceTier: shared.SERVICE_TIER || "(default)",
				userExchangeCount,
				maxUserExchanges: shared.MAX_USER_EXCHANGES,
				dailyCount,
				maxDailyUsage: shared.MAX_DAILY_USAGE,
				durableStorage: !!shared.ENABLE_DURABLE_STORAGE,
				dossierTable: shared.DOSSIER_TABLE_NAME || null,
				returnPolicy: !!shared.ENABLE_RETURN_POLICY,
				returnPolicyLogOnly: !!shared.RETURN_POLICY_LOG_ONLY,
				timeAwayDisableMinGuards: !!shared.TIME_AWAY_DISABLE_MIN_GUARDS,
				timeAwayBriefMs: shared.TIME_AWAY_BRIEF_MS,
				timeAwayLongMs: shared.TIME_AWAY_LONG_MS,
				timeAwayStaleMs: shared.TIME_AWAY_STALE_MS,
			},
			headers: {
				"Set-Cookie": shared.sessionCookieHeader(sessionId),
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
