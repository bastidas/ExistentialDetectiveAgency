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
			jsonBody: { devMode: !!shared.DEV },
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
		const userExchangeCount = shared.userExchangeCounts.get(sessionId) ?? 0;
		const dailyCount = dailyUsageStore.readDailyUsage();
		return {
			status: 200,
			jsonBody: {
				devMode: shared.DEV,
				offline: shared.OFFLINE,
				debugLogs: true,
				model: shared.MODEL,
				serviceTier: shared.SERVICE_TIER || "(default)",
				userExchangeCount,
				maxUserExchanges: shared.MAX_USER_EXCHANGES,
				dailyCount,
				maxDailyUsage: shared.MAX_DAILY_USAGE,
			},
			headers: {
				"Set-Cookie": shared.sessionCookieHeader(sessionId),
			},
		};
	},
});

app.http("initialIntros", {
	route: "initial-intros",
	methods: ["GET"],
	authLevel: "anonymous",
	handler: async (request) => {
		const sessionId = shared.getOrCreateSessionId(request);
		let attacheIntro = "";
		let detectiveIntro = "";
		try {
			if (typeof shared.chooseInitialIntros === "function") {
				const intros = shared.chooseInitialIntros();
				if (intros && typeof intros === "object") {
					if (typeof intros.attacheIntro === "string") {
						attacheIntro = intros.attacheIntro;
					}
					if (typeof intros.detectiveIntro === "string") {
						detectiveIntro = intros.detectiveIntro;
					}
				}
			}
		} catch (_) {}
		return {
			status: 200,
			jsonBody: { attacheIntro, detectiveIntro },
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
		if (!message.trim()) {
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
