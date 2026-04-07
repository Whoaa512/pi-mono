import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let historyDir: string;
let legacyFile: string;
const TEST_CWD = "/test/project";

vi.mock("../src/config.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/config.js")>();
	return {
		...original,
		getPromptHistoryPath: (cwd: string) => {
			const { createHash } = require("node:crypto");
			const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
			return path.join(historyDir, `${hash}.json`);
		},
		getPromptHistoryDir: () => historyDir,
		getLegacyPromptHistoryPath: () => legacyFile,
	};
});

describe("prompt-history", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-history-"));
		historyDir = path.join(tmpDir, "prompt-history");
		legacyFile = path.join(tmpDir, "prompt-history.json");
		vi.spyOn(process, "cwd").mockReturnValue(TEST_CWD);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.restoreAllMocks();
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
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		savePromptToHistory("seed");
		const { getPromptHistoryPath } = await import("../src/config.js");
		fs.writeFileSync(getPromptHistoryPath(TEST_CWD), "not json", "utf-8");
		expect(loadPromptHistory()).toEqual([]);
	});

	it("handles file with wrong shape gracefully", async () => {
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		savePromptToHistory("seed");
		const { getPromptHistoryPath } = await import("../src/config.js");
		fs.writeFileSync(getPromptHistoryPath(TEST_CWD), JSON.stringify({ prompts: "not-an-array" }), "utf-8");
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

	it("isolates history per directory", async () => {
		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");

		savePromptToHistory("from-project-a");

		vi.spyOn(process, "cwd").mockReturnValue("/other/project");
		savePromptToHistory("from-project-b");

		const otherHistory = loadPromptHistory();
		expect(otherHistory).toEqual(["from-project-b"]);

		vi.spyOn(process, "cwd").mockReturnValue(TEST_CWD);
		const originalHistory = loadPromptHistory();
		expect(originalHistory).toEqual(["from-project-a"]);
	});

	it("migrates from legacy global file when per-dir file missing", async () => {
		fs.writeFileSync(legacyFile, JSON.stringify({ prompts: ["legacy-prompt"] }), "utf-8");

		const { loadPromptHistory } = await import("../src/core/prompt-history.js");
		expect(loadPromptHistory()).toEqual(["legacy-prompt"]);
	});

	it("per-dir file takes precedence once written", async () => {
		fs.writeFileSync(legacyFile, JSON.stringify({ prompts: ["legacy-prompt"] }), "utf-8");

		const { loadPromptHistory, savePromptToHistory } = await import("../src/core/prompt-history.js");
		savePromptToHistory("new-prompt");

		expect(loadPromptHistory()[0]).toBe("new-prompt");
		expect(loadPromptHistory()).toEqual(["new-prompt", "legacy-prompt"]);
	});
});
