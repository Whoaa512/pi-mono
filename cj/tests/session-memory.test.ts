/**
 * Unit tests for session-memory extension logic.
 *
 * Tests text extraction, tool call extraction, and conversation building.
 */

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Extracted logic from the extension
// ---------------------------------------------------------------------------

type ContentBlock = { type?: string; text?: string; name?: string; arguments?: Record<string, unknown> };
type SessionEntry = { type: string; message?: { role?: string; content?: unknown } };

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is ContentBlock => c?.type === "text" && typeof c?.text === "string")
		.map((c) => c.text!)
		.join("\n");
}

function extractToolCalls(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	return content
		.filter((c): c is ContentBlock => c?.type === "toolCall" && typeof c?.name === "string")
		.map((c) => c.name!);
}

function buildConversation(entries: SessionEntry[]): { text: string; toolCount: number; messageCount: number } {
	const sections: string[] = [];
	let toolCount = 0;
	let messageCount = 0;

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message?.role) continue;
		const { role, content } = entry.message;
		if (role !== "user" && role !== "assistant") continue;

		messageCount++;
		const text = extractText(content).trim();
		if (text) sections.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);

		if (role === "assistant") {
			const tools = extractToolCalls(content);
			toolCount += tools.length;
		}
	}

	return { text: sections.join("\n\n"), toolCount, messageCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractText", () => {
	it("extracts from string content", () => {
		expect(extractText("hello")).toBe("hello");
	});

	it("extracts from content block array", () => {
		const content = [
			{ type: "text", text: "first" },
			{ type: "text", text: "second" },
		];
		expect(extractText(content)).toBe("first\nsecond");
	});

	it("filters non-text blocks", () => {
		const content = [
			{ type: "text", text: "keep" },
			{ type: "toolCall", name: "bash" },
			{ type: "thinking", text: "hmm" },
		];
		expect(extractText(content)).toBe("keep");
	});

	it("returns empty for null/undefined", () => {
		expect(extractText(null)).toBe("");
		expect(extractText(undefined)).toBe("");
	});

	it("returns empty for non-array non-string", () => {
		expect(extractText(42)).toBe("");
		expect(extractText({})).toBe("");
	});

	it("handles empty array", () => {
		expect(extractText([])).toBe("");
	});
});

describe("extractToolCalls", () => {
	it("extracts tool call names", () => {
		const content = [
			{ type: "toolCall", name: "bash", arguments: { command: "ls" } },
			{ type: "toolCall", name: "read", arguments: { path: "x" } },
		];
		expect(extractToolCalls(content)).toEqual(["bash", "read"]);
	});

	it("filters non-toolCall blocks", () => {
		const content = [
			{ type: "text", text: "hello" },
			{ type: "toolCall", name: "edit" },
		];
		expect(extractToolCalls(content)).toEqual(["edit"]);
	});

	it("returns empty for non-array", () => {
		expect(extractToolCalls("string")).toEqual([]);
		expect(extractToolCalls(null)).toEqual([]);
	});

	it("handles empty array", () => {
		expect(extractToolCalls([])).toEqual([]);
	});
});

describe("buildConversation", () => {
	it("builds conversation from user and assistant entries", () => {
		const entries: SessionEntry[] = [
			{ type: "message", message: { role: "user", content: "fix the bug" } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "I'll fix that" },
						{ type: "toolCall", name: "bash", arguments: {} },
					],
				},
			},
		];

		const result = buildConversation(entries);
		expect(result.messageCount).toBe(2);
		expect(result.toolCount).toBe(1);
		expect(result.text).toContain("User: fix the bug");
		expect(result.text).toContain("Assistant: I'll fix that");
	});

	it("skips non-message entries", () => {
		const entries: SessionEntry[] = [
			{ type: "session" },
			{ type: "compaction" },
			{ type: "message", message: { role: "user", content: "hi" } },
		];

		const result = buildConversation(entries);
		expect(result.messageCount).toBe(1);
	});

	it("skips toolResult messages", () => {
		const entries: SessionEntry[] = [
			{ type: "message", message: { role: "user", content: "test" } },
			{ type: "message", message: { role: "toolResult", content: "result" } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
		];

		const result = buildConversation(entries);
		expect(result.messageCount).toBe(2);
	});

	it("counts tool calls across multiple assistant messages", () => {
		const entries: SessionEntry[] = [
			{ type: "message", message: { role: "user", content: "do stuff" } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", name: "bash" },
						{ type: "toolCall", name: "read" },
					],
				},
			},
			{ type: "message", message: { role: "user", content: "more" } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", name: "write" }],
				},
			},
		];

		const result = buildConversation(entries);
		expect(result.toolCount).toBe(3);
		expect(result.messageCount).toBe(4);
	});

	it("returns empty for no messages", () => {
		const result = buildConversation([]);
		expect(result.text).toBe("");
		expect(result.toolCount).toBe(0);
		expect(result.messageCount).toBe(0);
	});

	it("handles assistant message with only tool calls (no text)", () => {
		const entries: SessionEntry[] = [
			{ type: "message", message: { role: "user", content: "go" } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", name: "bash" }],
				},
			},
		];

		const result = buildConversation(entries);
		expect(result.messageCount).toBe(2);
		expect(result.toolCount).toBe(1);
		expect(result.text).toBe("User: go");
	});
});
