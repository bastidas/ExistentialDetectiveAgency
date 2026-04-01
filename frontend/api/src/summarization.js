"use strict";

const config = require("./config");
const logger = require("./logger");

// ---------------------------------------------------------------------------
// Configuration knobs for memory & dossier triggers
// ---------------------------------------------------------------------------

// How many detective turns between dossier analyzer runs
const N_DOSSIER_UPDATE_TURNS =
	parseInt(process.env.N_DOSSIER_UPDATE_TURNS, 10) || 12;

// Keep a trailing slice of history so the model still sees recent dialogue
// after summarization.
const RECENT_HISTORY_TAIL_LENGTH = Math.min(
	2000,
	Math.floor(config.MAX_HISTORY_LENGTH / 2)
);

function logInfo(...args) {
	logger.info("summarization", ...args);
}

// ---------------------------------------------------------------------------
// Conversation summarizer
// ---------------------------------------------------------------------------

async function summarizeHistory(openai, history) {
	const text = String(history || "");

	// In OFFLINE mode, we cannot call the model; return a crude truncation.
	if (config.OFFLINE) {
		logInfo("OFFLINE=1: skipping summarizeHistory model call");
		if (text.length <= config.MAX_HISTORY_LENGTH) return text;
		return text.slice(-config.MAX_HISTORY_LENGTH);
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
${text}

Summary:
`;

	try {
		const messages = [{ role: "user", content: prompt }];
		logger.logLLMCall("summarization", {
			label: "summarizeHistory",
			messages,
			params: { model: config.MODEL },
		});
		const response = await openai.chat.completions.create({
			model: config.MODEL,
			messages,
		});

		const content = response.choices?.[0]?.message?.content || "";
		return String(content || "").trim();
	} catch (err) {
		logInfo("Error in summarizeHistory:", err.message || err);
		if (config.DEBUG_LOGS) logger.error("summarization", err);
		if (text.length <= config.MAX_HISTORY_LENGTH) return text;
		return text.slice(-config.MAX_HISTORY_LENGTH);
	}
}

async function maybeSummarize(openai, history, maxLength = config.MAX_HISTORY_LENGTH) {
	const text = String(history || "");
	if (!text || text.length < maxLength) return text;

	logInfo("History exceeds max length; summarizing.");
	const summary = await summarizeHistory(openai, text);
	const recentTail =
		text.length > RECENT_HISTORY_TAIL_LENGTH
			? text.slice(-RECENT_HISTORY_TAIL_LENGTH).trim()
			: text.trim();

	return `# MEMORY SUMMARY\n${summary}\n\n# RECENT HISTORY\n${recentTail}`;
}

// ---------------------------------------------------------------------------
// Dossier trigger helper
// ---------------------------------------------------------------------------

function shouldRunDossierUpdate(turnCount) {
	const n = Number(turnCount) || 0;
	if (n <= 0) return false;
	return n % N_DOSSIER_UPDATE_TURNS === 0;
}

module.exports = {
	N_DOSSIER_UPDATE_TURNS,
	RECENT_HISTORY_TAIL_LENGTH,
	summarizeHistory,
	maybeSummarize,
	shouldRunDossierUpdate,
};

