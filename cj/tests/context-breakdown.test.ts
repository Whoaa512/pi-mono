/**
 * Unit tests for the context-breakdown extension (/context command).
 * Tests the exported pure helpers: estTokens, fmt, bar, contentTokens, bucketMessages.
 */
import { describe, expect, it } from "vitest";
import {
	bar,
	bucketMessages,
	contentTokens,
	estTokens,
	fmt,
} from "../../../dotfiles/ai/pi/agent/extensions/context-breakdown.ts";

describe("estTokens", () => {
	it("estimates chars/4 rounded up", () => {
		expect(estTokens("")).toBe(0);
		expect(estTokens("abcd")).toBe(1);
		expect(estTokens("abcde")).toBe(2);
	});
});

describe("fmt", () => {
	it("formats thousands with K suffix", () => {
		expect(fmt(999)).toBe("999");
		expect(fmt(1000)).toBe("1K");
		expect(fmt(1500)).toBe("1.5K");
		expect(fmt(84200)).toBe("84.2K");
	});
});

describe("bar", () => {
	it("renders proportional fill", () => {
		expect(bar(0, 10)).toBe("[░░░░░░░░░░]");
		expect(bar(50, 10)).toBe("[█████░░░░░]");
		expect(bar(100, 10)).toBe("[██████████]");
	});
	it("clamps out-of-range percents", () => {
		expect(bar(-5, 4)).toBe("[░░░░]");
		expect(bar(150, 4)).toBe("[████]");
	});
});

describe("contentTokens", () => {
	it("handles string content", () => {
		expect(contentTokens("abcdefgh")).toBe(2);
	});
	it("handles block arrays with text, thinking, and images", () => {
		expect(
			contentTokens([
				{ type: "text", text: "abcd" },
				{ type: "thinking", thinking: "abcdefgh" },
				{ type: "image" },
			]),
		).toBe(1 + 2 + 1200);
	});
	it("handles undefined", () => {
		expect(contentTokens(undefined)).toBe(0);
	});
});

describe("bucketMessages", () => {
	const messages = [
		{ role: "user", content: "fix the bug".padEnd(40, "x") },
		{
			role: "assistant",
			content: [
				{ type: "text", text: "looking".padEnd(20, ".") },
				{ type: "toolCall", id: "c1", name: "read", arguments: { path: "src/auth.ts" } },
			],
		},
		{
			role: "toolResult",
			toolCallId: "c1",
			toolName: "read",
			content: [{ type: "text", text: "x".repeat(400) }],
		},
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "npm test" } }],
		},
		{
			role: "toolResult",
			toolCallId: "c2",
			toolName: "bash",
			content: [{ type: "text", text: "y".repeat(100) }],
		},
	];

	it("buckets by role", () => {
		const b = bucketMessages(messages);
		expect(b.userCount).toBe(1);
		expect(b.userTokens).toBe(10);
		expect(b.assistantCount).toBe(2);
		expect(b.toolResultCount).toBe(2);
		expect(b.toolResultTokens).toBe(100 + 25);
	});

	it("includes tool call arguments in assistant tokens", () => {
		const b = bucketMessages(messages);
		// second assistant message has no text, only toolCall args JSON
		expect(b.assistantTokens).toBeGreaterThan(5);
	});

	it("groups tool results by tool name, sorted by tokens desc", () => {
		const b = bucketMessages(messages);
		expect(b.byTool).toEqual([
			{ name: "read", tokens: 100, count: 1 },
			{ name: "bash", tokens: 25, count: 1 },
		]);
	});

	it("labels top results with arg hints from matching tool calls", () => {
		const b = bucketMessages(messages);
		expect(b.topResults[0]).toEqual({ label: "read src/auth.ts", tokens: 100 });
		expect(b.topResults[1]).toEqual({ label: "bash npm test", tokens: 25 });
	});

	it("handles orphan tool results without a matching call", () => {
		const b = bucketMessages([
			{ role: "toolResult", toolCallId: "nope", toolName: "grep", content: [{ type: "text", text: "hit" }] },
		]);
		expect(b.topResults[0]?.label).toBe("grep");
	});

	it("truncates long arg hints", () => {
		const longPath = `src/${"a".repeat(60)}.ts`;
		const b = bucketMessages([
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: longPath } }],
			},
			{ role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "x" }] },
		]);
		expect(b.topResults[0]?.label.length).toBeLessThanOrEqual("read ".length + 41);
		expect(b.topResults[0]?.label.endsWith("…")).toBe(true);
	});
});
