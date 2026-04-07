const config = require("../config");
const logger = require("../logger");

/**
 * Dossier model (Existential Detective Agency)
 *
 * **Knowledge classes**
 * - **explicit** — Identity/consent: name, pronouns, languages.
 * - **inferred** — LLM-merged traits (demographics, psychographics, Big Five, worldviews). Merge logic in
 *   `updateTraitArray` / `user_dossier_updater`; treat changes cautiously and test.
 * - **meta** — Agency protocol: `baselineQuestionsAnswered`, `baselineQuestionStats`, `lastBaselineCompletedAt`
 *   (used by `isDossierStaleByAge` vs `longMs`), `createdAt`, `lastUpdated`, `updateHistory`, optional `lastUserMessageAt`.
 * - **meta.environment** — Technical/session: `firstSeenAt`, `lastSeenAt`, UA, device, browser (not shown in therapist-safe LLM view).
 *
 * **Three clocks** (distinct): `meta.createdAt` (row lifetime), `meta.environment.lastSeenAt` / client `msSinceLastVisit`
 * (visit activity for routing tiers), `meta.lastBaselineCompletedAt` (baseline freshness for attaché/detective policy).
 *
 * **LLM-facing summary:** `buildTherapistSafeDossierSummary` for detective/philosophers; full `buildDossierSnippet` for internal/analyzer context where needed.
 */

// High-level, easily editable summary for the dossier analyzer prompt.
// Edit these strings to change how the analyzer behaves.
const DOSSIER_ANALYZER_PROMPT_SUMMARY =
	"You are the User Profile Analyzer for the Existential Detective Agency. " +
	"Your job is to infer soft traits about the user based primarily on the user's own responses, " +
	"not on the wording of the questions they were asked.";

// System prompt focused on more concrete / demographic traits
const DOSSIER_DEMOGRAPHIC_SYSTEM_PROMPT =
	`${DOSSIER_ANALYZER_PROMPT_SUMMARY}\n\n` +
	"You must:\n" +
	"- Make cautious, probabilistic inferences\n" +
	"- Provide multiple possible hypotheses when uncertain\n" +
	"- Never assume facts not supported by evidence\n" +
	"- Clearly distinguish between the text of questions and the user's own responses.\n" +
	"  If a concept (for example, \"familial love\") appears only in a question, do not treat it as evidence\n" +
	"  about the user unless the user affirms, echoes, or elaborates on it in their reply.\n" +
	"- Output only structured JSON\n" +
	"- Use qualitative likelihood labels: \"low\", \"medium\", \"high\"\n\n" +
	"Target demographic traits (traitName values) you may infer include, but are not limited to:\n" +
	"- ageRange\n" +
	"- genderIdentity\n" +
	"- locationHypotheses\n" +
	"- householdIncome\n" +
	"- parentalStatus\n" +
	"- jobTitle\n" +
	"- jobRole\n" +
	"- companySize\n" +
	"- industry\n" +
	"- deviceTypePreference\n" +
	"- browserPreference\n\n" +
	"Value conventions for demographics:\n" +
	"- For ageRange, choose a labeled band such as: '0-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'.\n" +
	"- For householdIncome, choose an income band such as: '<25k', '25k-50k', '50k-75k', '75k-100k', '100k-150k', '150k+'.\n" +
	"- For categorical traits (for example, jobRole, industry), use short, human-readable labels and use likelihood for confidence.\n\n" +
	"If there is effectively no evidence for a trait, you may either omit that trait entirely\n" +
	"or include a single hypothesis with value \"unknown\" and likelihood \"low\" and set evidence to\n" +
	"a short explanation such as \"No direct evidence in the conversation.\"\n\n" +
	"You are not updating the profile yourself. You are providing evidence for a separate merging algorithm.\n\n" +
	"For each trait you infer, include:\n" +
	"- traitName\n" +
	"- hypotheses: an array of { value, likelihood, evidence }\n" +
	"- notes: brief reasoning\n\n" +
	"Likelihood meanings:\n" +
	"- \"low\" = weak evidence\n" +
	"- \"medium\" = moderate evidence\n" +
	"- \"high\" = strong evidence\n";

// System prompt focused on psychographics, worldviews, and Big Five
const DOSSIER_PSYCH_SYSTEM_PROMPT =
	`${DOSSIER_ANALYZER_PROMPT_SUMMARY}\n\n` +
	"You must:\n" +
	"- Make cautious, probabilistic inferences\n" +
	"- Provide multiple possible hypotheses when uncertain\n" +
	"- Never assume facts not supported by evidence\n" +
	"- Clearly distinguish between the text of questions and the user's own responses.\n" +
	"  If a concept (for example, \"familial love\") appears only in a question, do not treat it as evidence\n" +
	"  about the user unless the user affirms, echoes, or elaborates on it in their reply.\n" +
	"- Output only structured JSON\n" +
	"- Use qualitative likelihood labels: \"low\", \"medium\", \"high\"\n\n" +
	"Target psychographic traits (traitName values) you may infer include, but are not limited to:\n" +
	"- interests\n" +
	"- lifestylePreferences\n" +
	"- personalityTraits\n" +
	"- worldviews\n" +
	"- bigFive_openness\n" +
	"- bigFive_conscientiousness\n" +
	"- bigFive_extraversion\n" +
	"- bigFive_agreeableness\n" +
	"- bigFive_neuroticism\n\n" +
	"Value conventions for psych traits:\n" +
	"- For binary or categorical beliefs (for example, worldviews), use short snake_case labels as values, and use likelihood for confidence.\n" +
	"- For Big Five traits (bigFive_*), encode the user's level in value as one of: 'very_low', 'low', 'medium', 'high', 'very_high'. Use likelihood only for confidence in that rating, not for intensity.\n\n" +
	"If there is effectively no evidence for a trait, you may either omit that trait entirely\n" +
	"or include a single hypothesis with value \"unknown\" and likelihood \"low\" and set evidence to\n" +
	"a short explanation such as \"No direct evidence in the conversation.\"\n\n" +
	"For worldviews, use traitName \"worldviews\" with hypotheses whose value is a short label such as:\n" +
	"- belief_in_god, belief_in_aliens, belief_in_afterlife, belief_in_reincarnation, nihilism, animism, materialism_naturalism, humanism, stoicism.\n" +
	"Only propose a worldview when there is clear evidence in the user's responses; otherwise omit it or mark it as unknown with low likelihood.\n\n" +
	"You are not updating the profile yourself. You are providing evidence for a separate merging algorithm.\n\n" +
	"For each trait you infer, include:\n" +
	"- traitName\n" +
	"- hypotheses: an array of { value, likelihood, evidence }\n" +
	"- notes: brief reasoning\n\n" +
	"Likelihood meanings:\n" +
	"- \"low\" = weak evidence\n" +
	"- \"medium\" = moderate evidence\n" +
	"- \"high\" = strong evidence\n";


// Basic dossier shape helpers

function createEmptyDossier(userId) {
	const now = Date.now();
	return {
		partitionKey: "profile",
		rowKey: userId ? `user_${userId}` : undefined,
		userId: userId || null,
		explicit: {
			name: null,
			preferredPronouns: null,
			languages: [],
		},
		inferred: {
			ageRange: [],
			personalityTraits: [],
			interests: [],
			locationHypotheses: [],
			// Philosophical / religious / existential orientation tags
			worldviews: [],
			genderIdentity: [],
			householdIncome: [],
			parentalStatus: [],
			lifestylePreferences: [],
			jobTitle: [],
			jobRole: [],
			companySize: [],
			industry: [],
			deviceTypePreference: [],
			browserPreference: [],
			bigFive_openness: [],
			bigFive_conscientiousness: [],
			bigFive_extraversion: [],
			bigFive_agreeableness: [],
			bigFive_neuroticism: [],
		},
		meta: {
			createdAt: now,
			lastUpdated: now,
			updateHistory: [],
			// How many baseline questions the user has answered overall
			baselineQuestionsAnswered: 0,
			/** Unix ms when baseline prelude last completed (handoff to detective). */
			lastBaselineCompletedAt: null,
			/** Optional: last time a user message was merged into the dossier (e.g. detective refresh). */
			lastUserMessageAt: null,
			// Optional, richer stats about baseline questions asked vs answered
			baselineQuestionStats: {
				askedTotal: 0,
				answeredTotal: 0,
				byBaseline: {
					1: { asked: 0, answered: 0 },
					2: { asked: 0, answered: 0 },
					3: { asked: 0, answered: 0 },
				},
			},
			// Hard, observational environment data about this profile
			environment: {
				firstSeenAt: now,
				lastSeenAt: now,
				userAgent: null,
				deviceType: "unknown", // e.g. "mobile", "desktop", "tablet"
				browser: "unknown",
				platform: "unknown",
			},
		},
	};
}

function normalizeDossier(raw, userId) {
	if (!raw || typeof raw !== "object") {
		return createEmptyDossier(userId);
	}
	const base = createEmptyDossier(raw.userId || userId);
	const merged = {
		...base,
		...raw,
		explicit: {
			...base.explicit,
			...(raw.explicit || {}),
		},
		inferred: {
			...base.inferred,
			...(raw.inferred || {}),
		},
		meta: {
			...base.meta,
			...(raw.meta || {}),
		},
	};
	return merged;
}

// Likelihood mapping for analyzer outputs

const LIKELIHOOD_WEIGHTS = {
	low: 0.2,
	medium: 0.5,
	high: 0.8,
};

// Traits that should be treated as having a single current value
// in the dossier, with `confidence` acting as the belief strength
// for that chosen value. Internally we still use the existing
// array structure, but we enforce maxEntriesPerTrait: 1 for
// these names so only the best-supported hypothesis is kept.
const SINGLE_VALUE_TRAITS = new Set([
	"ageRange",
	"genderIdentity",
	"householdIncome",
	"parentalStatus",
	"jobTitle",
	"jobRole",
	"companySize",
	"industry",
	"deviceTypePreference",
	"browserPreference",
]);

/** Inferred hypotheses at or above this confidence are included in therapist-facing summaries. */
const THERAPIST_SAFE_MIN_CONFIDENCE = 0.5;
const THERAPIST_EXCLUDED_INFERRED_KEYS = new Set(["deviceTypePreference", "browserPreference"]);

/**
 * @param {unknown[]} entries
 * @returns {unknown[]}
 */
function filterTraitEntriesByConfidence(entries) {
	if (!Array.isArray(entries)) return [];
	return entries.filter((e) => {
		if (!e || typeof e !== "object") return false;
		const c = typeof /** @type {{ confidence?: number }} */ (e).confidence === "number"
			? /** @type {{ confidence?: number }} */ (e).confidence
			: 0;
		return c >= THERAPIST_SAFE_MIN_CONFIDENCE;
	});
}

/**
 * Compact JSON for detective/philosophers prompts: humanistic profile only (no web telemetry in inferred).
 * Omits `meta` and environment timestamps.
 *
 * @param {object|null|undefined} dossier
 * @returns {string}
 */
function buildTherapistSafeDossierSummary(dossier) {
	if (!dossier) return "{}";
	try {
		const inf =
			dossier.inferred && typeof dossier.inferred === "object" ? dossier.inferred : {};
		/** @type {Record<string, unknown[]>} */
		const inferred = {};
		for (const key of Object.keys(inf)) {
			if (THERAPIST_EXCLUDED_INFERRED_KEYS.has(key)) continue;
			inferred[key] = filterTraitEntriesByConfidence(inf[key]);
		}
		const ex = dossier.explicit && typeof dossier.explicit === "object" ? dossier.explicit : {};
		const minimal = {
			explicit: {
				name: ex.name != null ? ex.name : null,
				preferredPronouns: ex.preferredPronouns != null ? ex.preferredPronouns : null,
				languages: Array.isArray(ex.languages) ? ex.languages : [],
			},
			inferred,
		};
		return JSON.stringify(minimal);
	} catch {
		return "{}";
	}
}

// Weighted confidence merge for trait hypotheses

function updateTraitArray(existingArray, traitName, hypotheses, options) {
	// Each new hypothesis slightly pulls confidence up for the value it supports and pushes it down for others
	// giving a soft competition among values.
	
	// alpha Controls how fast a chosen value’s confidence increases when we see new supporting evidence. 
	// higher alpha means we update more aggressively based on new evidence;
	//  lower alpha means we are more cautious and require more evidence to shift confidence.
	const alpha = options?.alphaPositive ?? 0.2;
	// beta Controls how much we downweight competing values when we see evidence for a specific value.
	// higher beta means we are more competitive and quickly reduce confidence in alternatives;
	// lower beta means we are more tolerant of multiple co-existing hypotheses.
	
	const beta = options?.betaNegative ?? 0.1;

	// Map existing entries by key field depending on trait
	const keyField =
		traitName === "ageRange"
			? "range"
			: traitName === "locationHypotheses"
			? "location"
			: traitName === "interests"
			? "topic"
			: traitName === "personalityTraits"
			? "trait"
			: "value";

	const byKey = new Map();
	for (const entry of existingArray || []) {
		const key = entry[keyField];
		if (key == null) continue;
		byKey.set(key, { ...entry });
	}

	for (const h of hypotheses || []) {
		const weight = LIKELIHOOD_WEIGHTS[h.likelihood] ?? 0.3;
		const valueKey = h.value ?? h[keyField];
		if (!valueKey) continue;

		const existing = byKey.get(valueKey) || { [keyField]: valueKey, confidence: 0.5 };
		const oldConfidence = typeof existing.confidence === "number" ? existing.confidence : 0.5;

		// Simple rule: treat every new hypothesis as supporting that specific value,
		// and as implicitly contradicting all other existing values.
		const newConfidence =
			oldConfidence + alpha * weight * (1 - oldConfidence);

		existing.confidence = clamp01(newConfidence);
		existing.evidence = h.evidence || existing.evidence;
		byKey.set(valueKey, existing);

		// Downweight competitors
		for (const [otherKey, otherEntry] of byKey.entries()) {
			if (otherKey === valueKey) continue;
			const otherOld =
				typeof otherEntry.confidence === "number" ? otherEntry.confidence : 0.5;
			const otherNew = otherOld * (1 - beta * weight);
			otherEntry.confidence = clamp01(otherNew);
			byKey.set(otherKey, otherEntry);
		}
	}

	const updated = Array.from(byKey.values());
	// Optionally sort descending by confidence and trim
	updated.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
	const maxEntries = options?.maxEntriesPerTrait ?? 5;
	return updated.slice(0, maxEntries);
}

function clamp01(x) {
	if (Number.isNaN(x)) return 0;
	if (x < 0) return 0;
	if (x > 1) return 1;
	return x;
}

function user_dossier_updater(dossier, analyzerOutput, options) {
	const now = Date.now();
	const normalized = normalizeDossier(dossier, dossier?.userId);
	const traits = analyzerOutput?.traits || [];

	for (const trait of traits) {
		const name = trait.traitName;
		const hypotheses = trait.hypotheses || [];
		if (!name || hypotheses.length === 0) continue;

		if (!normalized.inferred[name]) {
			normalized.inferred[name] = [];
		}

		// Allow certain traits (including Big Five dimensions and other
		// clearly single-valued fields) to collapse to a single best
		// hypothesis rather than keeping multiple competing values.
		// For these, `confidence` is our scalar belief strength for the
		// chosen value.
		let perTraitOptions = options;
		if (typeof name === "string") {
			const isBigFive = name.startsWith("bigFive_");
			const isSingleValued = isBigFive || SINGLE_VALUE_TRAITS.has(name);
			if (isSingleValued) {
				perTraitOptions = { ...(options || {}), maxEntriesPerTrait: 1 };
			}
		}

		normalized.inferred[name] = updateTraitArray(
			normalized.inferred[name],
			name,
			hypotheses,
			perTraitOptions
		);

		if (normalized.meta && Array.isArray(normalized.meta.updateHistory)) {
			normalized.meta.updateHistory.push({
				timestamp: now,
				humanTimestamp: new Date(now).toISOString(),
				source: "llm_dossier_updater",
				traitName: name,
				notes: trait.notes || null,
			});
		}
	}

	if (normalized.meta) {
		normalized.meta.lastUpdated = now;
		// Optionally log how many baseline questions the user has
		// answered during the attaché prelude. This is provided via the
		// options object by chatService when the baseline completes.
		if (
			options &&
			typeof options.baselineQuestionsAnswered === "number" &&
			Number.isFinite(options.baselineQuestionsAnswered)
		) {
			normalized.meta.baselineQuestionsAnswered = options.baselineQuestionsAnswered;
		}

		if (
			options &&
			typeof options.lastBaselineCompletedAt === "number" &&
			Number.isFinite(options.lastBaselineCompletedAt)
		) {
			normalized.meta.lastBaselineCompletedAt = options.lastBaselineCompletedAt;
		}

		if (
			options &&
			typeof options.lastUserMessageAt === "number" &&
			Number.isFinite(options.lastUserMessageAt)
		) {
			normalized.meta.lastUserMessageAt = options.lastUserMessageAt;
		}

		// Optional richer baseline stats: total asked/answered and by-baseline
		if (options && options.baselineQuestionStats && typeof options.baselineQuestionStats === "object") {
			normalized.meta.baselineQuestionStats = {
				...(normalized.meta.baselineQuestionStats || {}),
				...options.baselineQuestionStats,
			};
			const incoming = options.baselineQuestionStats.byBaseline;
			if (incoming && typeof incoming === "object") {
				normalized.meta.baselineQuestionStats.byBaseline = {
					1: { asked: 0, answered: 0, ...(normalized.meta.baselineQuestionStats.byBaseline[1] || {}), ...(incoming[1] || {}) },
					2: { asked: 0, answered: 0, ...(normalized.meta.baselineQuestionStats.byBaseline[2] || {}), ...(incoming[2] || {}) },
					3: { asked: 0, answered: 0, ...(normalized.meta.baselineQuestionStats.byBaseline[3] || {}), ...(incoming[3] || {}) },
				};
			}
		}

		// Keep aggregate totals and scalar baselineQuestionsAnswered aligned with byBaseline.
		if (normalized.meta && normalized.meta.baselineQuestionStats && normalized.meta.baselineQuestionStats.byBaseline) {
			const st = normalized.meta.baselineQuestionStats;
			const bb = st.byBaseline;
			let sumAnswered = 0;
			let sumAsked = 0;
			for (const k of [1, 2, 3]) {
				const row = bb[k];
				if (row && typeof row.answered === "number") sumAnswered += row.answered;
				if (row && typeof row.asked === "number") sumAsked += row.asked;
			}
			if (sumAnswered > 0 || sumAsked > 0) {
				st.answeredTotal = sumAnswered;
				st.askedTotal = sumAsked;
				normalized.meta.baselineQuestionsAnswered = sumAnswered;
			} else if (
				typeof normalized.meta.baselineQuestionsAnswered === "number" &&
				normalized.meta.baselineQuestionsAnswered > 0
			) {
				// Legacy: scalar was set but per-baseline stats were never filled (e.g. old attaché sessions).
				st.answeredTotal = normalized.meta.baselineQuestionsAnswered;
				st.askedTotal = Math.max(
					typeof st.askedTotal === "number" ? st.askedTotal : 0,
					normalized.meta.baselineQuestionsAnswered
				);
			}
		}

		// Optional environment overrides (e.g. from request metadata)
		if (options && options.environment && typeof options.environment === "object") {
			normalized.meta.environment = {
				...(normalized.meta.environment || {}),
				...options.environment,
			};
		}
	}

	return normalized;
}

/**
 * @param {unknown[]} recentMessages
 * @param {number|null|undefined} recentMessageLimit — `null` = use full history; omitted or non-finite = last 10
 * @returns {Array<{ role?: string, content?: unknown }>}
 */
function applyRecentMessageLimit(recentMessages, recentMessageLimit) {
	const arr = Array.isArray(recentMessages) ? recentMessages : [];
	if (recentMessageLimit === null) {
		return arr.slice();
	}
	const limit =
		typeof recentMessageLimit === "number" &&
		Number.isFinite(recentMessageLimit) &&
		recentMessageLimit > 0
			? Math.floor(recentMessageLimit)
			: 10;
	return arr.slice(-limit);
}

// Demographic-focused analyzer
async function runDossierAnalyzerDemographics({
	userId,
	recentMessages,
	currentDossier,
	openaiClient,
	recentMessageLimit,
}) {
	if (!openaiClient) {
		return { traits: [] };
	}

	const trimmedMessages = applyRecentMessageLimit(recentMessages, recentMessageLimit);

	const userSummary = trimmedMessages
		.map((m) => `${m.role || "user"}: ${m.content}`)
		.join("\n");

	const dossierSnippet = buildTherapistSafeDossierSummary(currentDossier);

	const userContent = [
		"Here are recent user-facing messages (mostly the user's own words):",
		"",
		userSummary,
		"",
		"Here is the current, possibly partial dossier for this user:",
		dossierSnippet,
		"",
		"Infer only demographic-type traits and output JSON only.",
	].join("\n");

	const messages = [
		{ role: "system", content: DOSSIER_DEMOGRAPHIC_SYSTEM_PROMPT },
		{ role: "user", content: userContent },
	];
	logger.logLLMCall("dossierAnalyzer", {
		label: "runDossierAnalyzerDemographics",
		messages,
		params: { model: config.MODEL },
	});
	const createPayloadDemo = {
		model: config.MODEL,
		messages,
		temperature: 0.2,
		response_format: { type: "json_object" },
	};
	logger.logOpenAiChatCompletionCreatePayload(
		"runDossierAnalyzerDemographics",
		"dossierAnalyzer",
		createPayloadDemo
	);
	const response = await openaiClient.chat.completions.create(createPayloadDemo);

	const content = response.choices?.[0]?.message?.content;
	if (!content) {
		return { traits: [] };
	}
	try {
		const parsed = JSON.parse(content);
		if (parsed && Array.isArray(parsed.traits)) {
			return parsed;
		}
		return { traits: [] };
	} catch (err) {
		// Fallback: return empty if JSON parse fails
		return { traits: [] };
	}
}

// Psychographic / worldview / Big Five analyzer
async function runDossierAnalyzerPsych({
	userId,
	recentMessages,
	currentDossier,
	openaiClient,
	recentMessageLimit,
}) {
	if (!openaiClient) {
		return { traits: [] };
	}

	const trimmedMessages = applyRecentMessageLimit(recentMessages, recentMessageLimit);

	const userSummary = trimmedMessages
		.map((m) => `${m.role || "user"}: ${m.content}`)
		.join("\n");

	const dossierSnippet = buildTherapistSafeDossierSummary(currentDossier);

	const userContent = [
		"Here are recent user-facing messages (mostly the user's own words):",
		"",
		userSummary,
		"",
		"Here is the current, possibly partial dossier for this user:",
		dossierSnippet,
		"",
		"Infer only psychographic, worldview, and Big Five traits and output JSON only.",
	].join("\n");

	const messages = [
		{ role: "system", content: DOSSIER_PSYCH_SYSTEM_PROMPT },
		{ role: "user", content: userContent },
	];
	logger.logLLMCall("dossierAnalyzer", {
		label: "runDossierAnalyzerPsych",
		messages,
		params: { model: config.MODEL },
	});
	const createPayloadPsych = {
		model: config.MODEL,
		messages,
		temperature: 0.2,
		response_format: { type: "json_object" },
	};
	logger.logOpenAiChatCompletionCreatePayload(
		"runDossierAnalyzerPsych",
		"dossierAnalyzer",
		createPayloadPsych
	);
	const response = await openaiClient.chat.completions.create(createPayloadPsych);

	const content = response.choices?.[0]?.message?.content;
	if (!content) {
		return { traits: [] };
	}
	try {
		const parsed = JSON.parse(content);
		if (parsed && Array.isArray(parsed.traits)) {
			return parsed;
		}
		return { traits: [] };
	} catch (err) {
		// Fallback: return empty if JSON parse fails
		return { traits: [] };
	}
}

// Backwards-compatible wrapper that runs both analyzers and merges traits
async function runDossierAnalyzer(args) {
	const demo = await runDossierAnalyzerDemographics(args);
	const psych = await runDossierAnalyzerPsych(args);
	return {
		traits: [
			...(demo?.traits || []),
			...(psych?.traits || []),
		],
	};
}

function buildDossierSnippet(dossier) {
	if (!dossier) return "{}";
	try {
		const minimal = {
			explicit: dossier.explicit || {},
			inferred: {
				ageRange: (dossier.inferred && dossier.inferred.ageRange) || [],
				interests: (dossier.inferred && dossier.inferred.interests) || [],
				personalityTraits:
					(dossier.inferred && dossier.inferred.personalityTraits) || [],
				worldviews: (dossier.inferred && dossier.inferred.worldviews) || [],
				locationHypotheses:
					(dossier.inferred && dossier.inferred.locationHypotheses) || [],
				genderIdentity:
					(dossier.inferred && dossier.inferred.genderIdentity) || [],
				householdIncome:
					(dossier.inferred && dossier.inferred.householdIncome) || [],
				parentalStatus:
					(dossier.inferred && dossier.inferred.parentalStatus) || [],
				lifestylePreferences:
					(dossier.inferred && dossier.inferred.lifestylePreferences) || [],
				jobTitle: (dossier.inferred && dossier.inferred.jobTitle) || [],
				jobRole: (dossier.inferred && dossier.inferred.jobRole) || [],
				companySize:
					(dossier.inferred && dossier.inferred.companySize) || [],
				industry: (dossier.inferred && dossier.inferred.industry) || [],
				deviceTypePreference:
					(dossier.inferred && dossier.inferred.deviceTypePreference) || [],
				browserPreference:
					(dossier.inferred && dossier.inferred.browserPreference) || [],
				bigFive_openness:
					(dossier.inferred && dossier.inferred.bigFive_openness) || [],
				bigFive_conscientiousness:
					(dossier.inferred && dossier.inferred.bigFive_conscientiousness) || [],
				bigFive_extraversion:
					(dossier.inferred && dossier.inferred.bigFive_extraversion) || [],
				bigFive_agreeableness:
					(dossier.inferred && dossier.inferred.bigFive_agreeableness) || [],
				bigFive_neuroticism:
					(dossier.inferred && dossier.inferred.bigFive_neuroticism) || [],
			},
		};
		return JSON.stringify(minimal);
	} catch {
		return "{}";
	}
}


const { userHasPersistedDossier } = require("./dossierPresence");

module.exports = {
	createEmptyDossier,
	normalizeDossier,
	user_dossier_updater,
	userHasPersistedDossier,
	runDossierAnalyzer,
	runDossierAnalyzerDemographics,
	runDossierAnalyzerPsych,
	buildDossierSnippet,
	buildTherapistSafeDossierSummary,
	applyRecentMessageLimit,
};

