/**
 * Unit tests for elapsed-timer extension logic.
 *
 * Tests formatElapsed and stripMarkdown helpers.
 */

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Extracted logic from the extension
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function stripMarkdown(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]+`/g, "")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/_([^_]+)_/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/^[-*+]\s+/gm, "")
		.replace(/^\d+\.\s+/gm, "")
		.replace(/^>\s+/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("formatElapsed", () => {
	it("formats sub-minute durations", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(999)).toBe("0s");
		expect(formatElapsed(1000)).toBe("1s");
		expect(formatElapsed(5000)).toBe("5s");
		expect(formatElapsed(59999)).toBe("59s");
	});

	it("formats minute durations", () => {
		expect(formatElapsed(60000)).toBe("1m 0s");
		expect(formatElapsed(90000)).toBe("1m 30s");
		expect(formatElapsed(125000)).toBe("2m 5s");
	});

	it("formats large durations", () => {
		expect(formatElapsed(600000)).toBe("10m 0s");
		expect(formatElapsed(3661000)).toBe("61m 1s");
	});
});

describe("stripMarkdown", () => {
	it("removes code blocks", () => {
		expect(stripMarkdown("before\n```js\nconst x = 1;\n```\nafter")).toBe("before\n\nafter");
	});

	it("removes inline code", () => {
		expect(stripMarkdown("use `git commit` to save")).toBe("use  to save");
	});

	it("removes headings", () => {
		expect(stripMarkdown("# Title\n## Subtitle\ntext")).toBe("Title\nSubtitle\ntext");
	});

	it("removes bold", () => {
		expect(stripMarkdown("this is **bold** text")).toBe("this is bold text");
	});

	it("removes italic", () => {
		expect(stripMarkdown("this is *italic* text")).toBe("this is italic text");
	});

	it("removes underscore bold/italic", () => {
		expect(stripMarkdown("__bold__ and _italic_")).toBe("bold and italic");
	});

	it("converts links to text", () => {
		expect(stripMarkdown("[click here](https://example.com)")).toBe("click here");
	});

	it("removes list markers", () => {
		expect(stripMarkdown("- item one\n* item two\n+ item three")).toBe("item one\nitem two\nitem three");
	});

	it("removes numbered list markers", () => {
		expect(stripMarkdown("1. first\n2. second")).toBe("first\nsecond");
	});

	it("removes blockquotes", () => {
		expect(stripMarkdown("> quoted text")).toBe("quoted text");
	});

	it("collapses excessive newlines", () => {
		expect(stripMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
	});

	it("handles empty string", () => {
		expect(stripMarkdown("")).toBe("");
	});

	it("handles plain text (no markdown)", () => {
		expect(stripMarkdown("just plain text")).toBe("just plain text");
	});
});
