import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let historyFile: string;

vi.mock("../src/config.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/config.js")>();
	return {
		...original,
		getPromptHistoryPath: () => historyFile,
	};
});

describe("prompt-history", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-history-"));
		historyFile = path.join(tmpDir, "prompt-history.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns empty array when no file exists", async () => {
		const { loadPromptHistory } = await import("../src/core/prompt-history.js");
		expect(loadPromptHistory()).toEqual([]);
	});

	it("saves and loads a prompt", async () => {
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		savePromptToHistory("hello world");
		expect(loadPromptHistory()).toEqual(["hello world"]);
	});

	it("maintains most-recent-first ordering", async () => {
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		savePromptToHistory("first");
		savePromptToHistory("second");
		savePromptToHistory("third");
		expect(loadPromptHistory()).toEqual(["third", "second", "first"]);
	});

	it("deduplicates by moving repeated prompt to front", async () => {
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		savePromptToHistory("a");
		savePromptToHistory("b");
		savePromptToHistory("a");
		expect(loadPromptHistory()).toEqual(["a", "b"]);
	});

	it("trims whitespace before saving", async () => {
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		savePromptToHistory("  hello  ");
		expect(loadPromptHistory()).toEqual(["hello"]);
	});

	it("ignores empty/whitespace-only prompts", async () => {
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		savePromptToHistory("");
		savePromptToHistory("   ");
		expect(loadPromptHistory()).toEqual([]);
	});

	it("handles corrupted file gracefully", async () => {
		const { loadPromptHistory } = await import("../src/core/prompt-history.js");
		fs.writeFileSync(historyFile, "not json", "utf-8");
		expect(loadPromptHistory()).toEqual([]);
	});

	it("handles file with wrong shape gracefully", async () => {
		const { loadPromptHistory } = await import("../src/core/prompt-history.js");
		fs.writeFileSync(historyFile, JSON.stringify({ prompts: "not-an-array" }), "utf-8");
		expect(loadPromptHistory()).toEqual([]);
	});

	it("caps history at 500 entries", async () => {
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		for (let i = 0; i < 510; i++) {
			savePromptToHistory(`prompt-${i}`);
		}
		const history = loadPromptHistory();
		expect(history.length).toBe(500);
		expect(history[0]).toBe("prompt-509");
	});
});
