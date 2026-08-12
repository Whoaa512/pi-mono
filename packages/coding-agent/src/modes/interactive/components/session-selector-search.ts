import { fuzzyMatch } from "@earendil-works/pi-tui";
import type { SessionInfo, SessionMessagePreview } from "../../../core/session-manager.ts";

export type SortMode = "threaded" | "recent" | "relevance";

export type NameFilter = "all" | "named";

export type RoleFilter = "both" | "user" | "agent";

export interface SessionMatch {
	session: SessionInfo;
	/** The best-matching message for the current query, when per-message matching applied. */
	bestMessage?: SessionMessagePreview;
}

export interface ParsedSearchQuery {
	mode: "tokens" | "regex";
	tokens: { kind: "fuzzy" | "phrase"; value: string }[];
	regex: RegExp | null;
	/** If set, parsing failed and we should treat query as non-matching. */
	error?: string;
}

export interface MatchResult {
	matches: boolean;
	/** Lower is better; only meaningful when matches === true */
	score: number;
	/** The best-matching message, when the match came from a message body. */
	bestMessage?: SessionMessagePreview;
}

function normalizeWhitespaceLower(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function getSessionSearchText(session: SessionInfo): string {
	return `${session.id} ${session.name ?? ""} ${session.allMessagesText} ${session.cwd}`;
}

/** Metadata text (id, name, cwd) always participates in matching, regardless of role filter. */
function getSessionMetaText(session: SessionInfo): string {
	return `${session.id} ${session.name ?? ""} ${session.cwd}`;
}

function messageInScope(message: SessionMessagePreview, roleFilter: RoleFilter): boolean {
	if (roleFilter === "both") return true;
	if (roleFilter === "user") return message.role === "user";
	return message.role === "assistant";
}

export function hasSessionName(session: SessionInfo): boolean {
	return Boolean(session.name?.trim());
}

function matchesNameFilter(session: SessionInfo, filter: NameFilter): boolean {
	if (filter === "all") return true;
	return hasSessionName(session);
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
	const trimmed = query.trim();
	if (!trimmed) {
		return { mode: "tokens", tokens: [], regex: null };
	}

	// Regex mode: re:<pattern>
	if (trimmed.startsWith("re:")) {
		const pattern = trimmed.slice(3).trim();
		if (!pattern) {
			return { mode: "regex", tokens: [], regex: null, error: "Empty regex" };
		}
		try {
			return { mode: "regex", tokens: [], regex: new RegExp(pattern, "i") };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { mode: "regex", tokens: [], regex: null, error: msg };
		}
	}

	// Token mode with quote support.
	// Example: foo "node cve" bar
	const tokens: { kind: "fuzzy" | "phrase"; value: string }[] = [];
	let buf = "";
	let inQuote = false;
	let hadUnclosedQuote = false;

	const flush = (kind: "fuzzy" | "phrase"): void => {
		const v = buf.trim();
		buf = "";
		if (!v) return;
		tokens.push({ kind, value: v });
	};

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i]!;
		if (ch === '"') {
			if (inQuote) {
				flush("phrase");
				inQuote = false;
			} else {
				flush("fuzzy");
				inQuote = true;
			}
			continue;
		}

		if (!inQuote && /\s/.test(ch)) {
			flush("fuzzy");
			continue;
		}

		buf += ch;
	}

	if (inQuote) {
		hadUnclosedQuote = true;
	}

	// If quotes were unbalanced, fall back to plain whitespace tokenization.
	if (hadUnclosedQuote) {
		return {
			mode: "tokens",
			tokens: trimmed
				.split(/\s+/)
				.map((t) => t.trim())
				.filter((t) => t.length > 0)
				.map((t) => ({ kind: "fuzzy" as const, value: t })),
			regex: null,
		};
	}

	flush(inQuote ? "phrase" : "fuzzy");

	return { mode: "tokens", tokens, regex: null };
}

/**
 * Match a parsed query against a single text. Returns null when it does not match.
 *
 * tokenStyle controls how plain (unquoted) tokens match:
 * - "fuzzy": char-subsequence match (good for short texts like ids/names/paths)
 * - "substring": case-insensitive substring (good for long prose; char-subsequence
 *   over message bodies matches nearly everything and destroys precision)
 */
function matchText(text: string, parsed: ParsedSearchQuery, tokenStyle: "fuzzy" | "substring"): number | null {
	if (parsed.mode === "regex") {
		if (!parsed.regex) return null;
		const idx = text.search(parsed.regex);
		if (idx < 0) return null;
		return idx * 0.1;
	}

	let totalScore = 0;
	let normalizedText: string | null = null;
	let lowerText: string | null = null;

	for (const token of parsed.tokens) {
		if (token.kind === "phrase") {
			if (normalizedText === null) {
				normalizedText = normalizeWhitespaceLower(text);
			}
			const phrase = normalizeWhitespaceLower(token.value);
			if (!phrase) continue;
			const idx = normalizedText.indexOf(phrase);
			if (idx < 0) return null;
			totalScore += idx * 0.1;
			continue;
		}

		if (tokenStyle === "substring") {
			if (lowerText === null) {
				lowerText = text.toLowerCase();
			}
			const idx = lowerText.indexOf(token.value.toLowerCase());
			if (idx < 0) return null;
			totalScore += idx * 0.1;
			continue;
		}

		const m = fuzzyMatch(token.value, text);
		if (!m.matches) return null;
		totalScore += m.score;
	}

	return totalScore;
}

/**
 * Match a session against a parsed query.
 *
 * When per-message previews are available, the full query must match within a
 * single message (or within the session metadata: id/name/cwd). This is
 * stricter than matching against the flattened text of all messages -- it
 * prevents multi-token queries from matching across unrelated messages -- and
 * lets us report which message matched best.
 *
 * Sessions without previews (older callers/tests) fall back to matching the
 * flattened all-messages text.
 */
export function matchSession(
	session: SessionInfo,
	parsed: ParsedSearchQuery,
	roleFilter: RoleFilter = "both",
): MatchResult {
	if (parsed.mode === "regex" && !parsed.regex) {
		return { matches: false, score: 0 };
	}

	if (parsed.mode === "tokens" && parsed.tokens.length === 0) {
		return { matches: true, score: 0 };
	}

	const previews = session.messages;
	if (!previews || previews.length === 0) {
		const score = matchText(getSessionSearchText(session), parsed, "fuzzy");
		if (score === null) return { matches: false, score: 0 };
		return { matches: true, score };
	}

	let best: number | null = null;
	let bestMessage: SessionMessagePreview | undefined;

	for (const message of previews) {
		if (!messageInScope(message, roleFilter)) continue;
		const score = matchText(message.text, parsed, "substring");
		if (score !== null && (best === null || score < best)) {
			best = score;
			bestMessage = message;
		}
	}

	const metaScore = matchText(getSessionMetaText(session), parsed, "fuzzy");
	if (metaScore !== null && (best === null || metaScore < best)) {
		best = metaScore;
		bestMessage = undefined;
	}

	if (best === null) return { matches: false, score: 0 };
	return { matches: true, score: best, bestMessage };
}

export function filterAndSortSessions(
	sessions: SessionInfo[],
	query: string,
	sortMode: SortMode,
	nameFilter: NameFilter = "all",
	roleFilter: RoleFilter = "both",
): SessionMatch[] {
	const nameFiltered =
		nameFilter === "all" ? sessions : sessions.filter((session) => matchesNameFilter(session, nameFilter));
	const trimmed = query.trim();
	if (!trimmed) return nameFiltered.map((session) => ({ session }));

	const parsed = parseSearchQuery(query);
	if (parsed.error) return [];

	// Recent mode: filter only, keep incoming order.
	if (sortMode === "recent") {
		const filtered: SessionMatch[] = [];
		for (const s of nameFiltered) {
			const res = matchSession(s, parsed, roleFilter);
			if (res.matches) filtered.push({ session: s, bestMessage: res.bestMessage });
		}
		return filtered;
	}

	// Relevance mode: sort by score, tie-break by modified desc.
	const scored: { match: SessionMatch; score: number }[] = [];
	for (const s of nameFiltered) {
		const res = matchSession(s, parsed, roleFilter);
		if (!res.matches) continue;
		scored.push({ match: { session: s, bestMessage: res.bestMessage }, score: res.score });
	}

	scored.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		return b.match.session.modified.getTime() - a.match.session.modified.getTime();
	});

	return scored.map((r) => r.match);
}
