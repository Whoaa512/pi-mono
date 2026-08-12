import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { filterAndSortSessions } from "../src/modes/interactive/components/session-selector-search.ts";

function makeSession(
	overrides: Partial<SessionInfo> & { id: string; modified: Date; allMessagesText: string },
): SessionInfo {
	return {
		path: `/tmp/${overrides.id}.jsonl`,
		id: overrides.id,
		cwd: overrides.cwd ?? "",
		name: overrides.name,
		created: overrides.created ?? new Date(0),
		modified: overrides.modified,
		messageCount: overrides.messageCount ?? 1,
		firstMessage: overrides.firstMessage ?? "(no messages)",
		allMessagesText: overrides.allMessagesText,
		messages: overrides.messages ?? [{ role: "user", text: overrides.allMessagesText }],
	};
}

function ids(result: { session: SessionInfo }[]): string[] {
	return result.map((r) => r.session.id);
}

describe("session selector search", () => {
	it("filters by quoted phrase with whitespace normalization", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "a",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "node\n\n   cve was discussed",
			}),
			makeSession({
				id: "b",
				modified: new Date("2026-01-02T00:00:00.000Z"),
				allMessagesText: "node something else",
			}),
		];

		const result = filterAndSortSessions(sessions, '"node cve"', "recent");
		expect(ids(result)).toEqual(["a"]);
	});

	it("filters by regex (re:) and is case-insensitive", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "a",
				modified: new Date("2026-01-02T00:00:00.000Z"),
				allMessagesText: "Brave is great",
			}),
			makeSession({
				id: "b",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "bravery is not the same",
			}),
		];

		const result = filterAndSortSessions(sessions, "re:\\bbrave\\b", "recent");
		expect(ids(result)).toEqual(["a"]);
	});

	it("recent sort preserves input order", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "newer",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
			makeSession({
				id: "older",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
			makeSession({
				id: "nomatch",
				modified: new Date("2026-01-04T00:00:00.000Z"),
				allMessagesText: "something else",
			}),
		];

		const result = filterAndSortSessions(sessions, '"brave"', "recent");
		expect(ids(result)).toEqual(["newer", "older"]);
	});

	it("relevance sort orders by score and tie-breaks by modified desc", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "late",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "xxxx brave",
			}),
			makeSession({
				id: "early",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "brave xxxx",
			}),
		];

		const result1 = filterAndSortSessions(sessions, '"brave"', "relevance");
		expect(ids(result1)).toEqual(["early", "late"]);

		const tieSessions: SessionInfo[] = [
			makeSession({
				id: "newer",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
			makeSession({
				id: "older",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
		];

		const result2 = filterAndSortSessions(tieSessions, '"brave"', "relevance");
		expect(ids(result2)).toEqual(["newer", "older"]);
	});

	it("returns empty list for invalid regex", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "a",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
		];

		const result = filterAndSortSessions(sessions, "re:(", "recent");
		expect(result).toEqual([]);
	});

	describe("name filter", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "named1",
				name: "My Project",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "blueberry",
			}),
			makeSession({
				id: "named2",
				name: "Another Named",
				modified: new Date("2026-01-02T00:00:00.000Z"),
				allMessagesText: "blueberry",
			}),
			makeSession({
				id: "other1",
				modified: new Date("2026-01-04T00:00:00.000Z"),
				allMessagesText: "blueberry",
			}),
			makeSession({
				id: "other2",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "blueberry",
			}),
		];

		it("returns all sessions when nameFilter is 'all'", () => {
			const result = filterAndSortSessions(sessions, "", "recent", "all");
			expect(ids(result)).toEqual(["named1", "named2", "other1", "other2"]);
		});

		it("returns only named sessions when nameFilter is 'named'", () => {
			const result = filterAndSortSessions(sessions, "", "recent", "named");
			expect(ids(result)).toEqual(["named1", "named2"]);
		});

		it("applies name filter before search query", () => {
			const result = filterAndSortSessions(sessions, "blueberry", "recent", "named");
			expect(ids(result)).toEqual(["named1", "named2"]);
		});

		it("excludes whitespace-only names from named filter", () => {
			const sessionsWithWhitespace: SessionInfo[] = [
				makeSession({
					id: "whitespace",
					name: "   ",
					modified: new Date("2026-01-01T00:00:00.000Z"),
					allMessagesText: "test",
				}),
				makeSession({
					id: "empty",
					name: "",
					modified: new Date("2026-01-02T00:00:00.000Z"),
					allMessagesText: "test",
				}),
				makeSession({
					id: "named",
					name: "Real Name",
					modified: new Date("2026-01-03T00:00:00.000Z"),
					allMessagesText: "test",
				}),
			];

			const result = filterAndSortSessions(sessionsWithWhitespace, "", "recent", "named");
			expect(ids(result)).toEqual(["named"]);
		});
	});

	describe("per-message matching", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "same-message",
				modified: new Date("2026-01-02T00:00:00.000Z"),
				allMessagesText: "deploy the tugowar shadow service",
				messages: [
					{ role: "user", text: "deploy the tugowar shadow service" },
					{ role: "assistant", text: "done, rolled out" },
				],
			}),
			makeSession({
				id: "split-across-messages",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "look at tugowar metrics the shadow of a doubt",
				messages: [
					{ role: "user", text: "look at tugowar metrics" },
					{ role: "assistant", text: "the shadow of a doubt" },
				],
			}),
		];

		it("requires all tokens to match within a single message", () => {
			const result = filterAndSortSessions(sessions, "tugowar shadow", "recent");
			expect(ids(result)).toEqual(["same-message"]);
		});

		it("reports the best-matching message", () => {
			const result = filterAndSortSessions(sessions, "tugowar shadow", "recent");
			expect(result[0]?.bestMessage?.text).toBe("deploy the tugowar shadow service");
			expect(result[0]?.bestMessage?.role).toBe("user");
		});

		it("matches session metadata (name) without a bestMessage", () => {
			const named = makeSession({
				id: "meta",
				name: "Zanzibar Refactor",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "unrelated text",
				messages: [{ role: "user", text: "unrelated text" }],
			});
			const result = filterAndSortSessions([named], "zanzibar", "recent");
			expect(ids(result)).toEqual(["meta"]);
			expect(result[0]?.bestMessage).toBeUndefined();
		});

		it("falls back to flattened text when previews are missing", () => {
			const legacy = makeSession({
				id: "legacy",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "alpha beta gamma",
				messages: [],
			});
			const result = filterAndSortSessions([legacy], "alpha gamma", "recent");
			expect(ids(result)).toEqual(["legacy"]);
		});
	});

	describe("role filter", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "user-hit",
				modified: new Date("2026-01-02T00:00:00.000Z"),
				allMessagesText: "fix the login bug ok done",
				messages: [
					{ role: "user", text: "fix the login bug" },
					{ role: "assistant", text: "ok done" },
				],
			}),
			makeSession({
				id: "agent-hit",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "help me here found the login bug in auth.ts",
				messages: [
					{ role: "user", text: "help me here" },
					{ role: "assistant", text: "found the login bug in auth.ts" },
				],
			}),
		];

		it("matches both roles by default", () => {
			const result = filterAndSortSessions(sessions, '"login bug"', "recent");
			expect(ids(result)).toEqual(["user-hit", "agent-hit"]);
		});

		it("restricts matches to user messages", () => {
			const result = filterAndSortSessions(sessions, '"login bug"', "recent", "all", "user");
			expect(ids(result)).toEqual(["user-hit"]);
		});

		it("restricts matches to agent messages", () => {
			const result = filterAndSortSessions(sessions, '"login bug"', "recent", "all", "agent");
			expect(ids(result)).toEqual(["agent-hit"]);
		});

		it("still matches metadata when role filter excludes all messages", () => {
			const named = makeSession({
				id: "meta-role",
				name: "login bug hunt",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "nothing relevant",
				messages: [{ role: "assistant", text: "nothing relevant" }],
			});
			const result = filterAndSortSessions([named], '"login bug"', "recent", "all", "user");
			expect(ids(result)).toEqual(["meta-role"]);
		});
	});
});
