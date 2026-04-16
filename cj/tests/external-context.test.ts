/**
 * Unit tests for external-context extension (supplemental loader).
 *
 * After upstream pi added native AGENTS.md/CLAUDE.md loading, this extension
 * only covers:
 * 1. .local.md variants from ~/.claude/
 * 2. .claude/ subdirectories in project ancestors
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Extracted logic from the trimmed extension
// ---------------------------------------------------------------------------

const LOCAL_FILENAMES = ["AGENTS.local.md", "CLAUDE.local.md"];
const ALL_CLAUDE_SUBDIR_FILENAMES = ["AGENTS.md", "AGENTS.local.md", "CLAUDE.md", "CLAUDE.local.md"];

function tryRead(filePath: string): { path: string; content: string } | null {
	try {
		if (!existsSync(filePath)) return null;
		return { path: filePath, content: readFileSync(filePath, "utf-8") };
	} catch {
		return null;
	}
}

function loadSupplementalContextFiles(cwd: string, claudeDir: string): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];
	const seenPaths = new Set<string>();

	const addFile = (file: { path: string; content: string }) => {
		if (seenPaths.has(file.path)) return;
		files.push(file);
		seenPaths.add(file.path);
	};

	for (const filename of LOCAL_FILENAMES) {
		const f = tryRead(join(claudeDir, filename));
		if (f) addFile(f);
	}

	let currentDir = cwd;
	const root = resolve("/");
	const ancestorFiles: Array<{ path: string; content: string }> = [];

	while (true) {
		const subdir = join(currentDir, ".claude");
		for (const filename of ALL_CLAUDE_SUBDIR_FILENAMES) {
			const f = tryRead(join(subdir, filename));
			if (f && !seenPaths.has(f.path)) {
				ancestorFiles.unshift(f);
				seenPaths.add(f.path);
			}
		}

		if (currentDir === root) break;
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	files.push(...ancestorFiles);
	return files;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("tryRead", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `tryread-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("reads existing file", () => {
		const p = join(testDir, "test.md");
		writeFileSync(p, "hello");
		const result = tryRead(p);
		expect(result).toEqual({ path: p, content: "hello" });
	});

	it("returns null for missing file", () => {
		expect(tryRead(join(testDir, "nope.md"))).toBeNull();
	});
});

describe("loadSupplementalContextFiles", () => {
	let testDir: string;
	let projectDir: string;
	let fakeClaude: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `supp-ctx-test-${Date.now()}`);
		projectDir = join(testDir, "project", "sub");
		fakeClaude = join(testDir, "fake-claude-home");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(fakeClaude, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("loads .local.md files from claude dir", () => {
		writeFileSync(join(fakeClaude, "AGENTS.local.md"), "local agents");
		writeFileSync(join(fakeClaude, "CLAUDE.local.md"), "local claude");
		const files = loadSupplementalContextFiles(projectDir, fakeClaude);
		expect(files).toHaveLength(2);
		expect(files[0].content).toBe("local agents");
		expect(files[1].content).toBe("local claude");
	});

	it("does NOT load AGENTS.md or CLAUDE.md from claude dir (upstream handles those)", () => {
		writeFileSync(join(fakeClaude, "AGENTS.md"), "should not load");
		writeFileSync(join(fakeClaude, "CLAUDE.md"), "should not load");
		const files = loadSupplementalContextFiles(projectDir, fakeClaude);
		expect(files).toHaveLength(0);
	});

	it("loads all files from .claude/ subdirs in ancestors", () => {
		const claudeSubdir = join(testDir, "project", ".claude");
		mkdirSync(claudeSubdir, { recursive: true });
		writeFileSync(join(claudeSubdir, "AGENTS.md"), "proj agents");
		writeFileSync(join(claudeSubdir, "AGENTS.local.md"), "proj local");

		const files = loadSupplementalContextFiles(projectDir, fakeClaude);
		const projFiles = files.filter((f) => f.path.startsWith(claudeSubdir));
		expect(projFiles).toHaveLength(2);
	});

	it("deduplicates by path", () => {
		const claudeSubdir = join(testDir, "project", ".claude");
		mkdirSync(claudeSubdir, { recursive: true });
		writeFileSync(join(claudeSubdir, "AGENTS.md"), "rules");

		const files = loadSupplementalContextFiles(join(testDir, "project"), fakeClaude);
		const matches = files.filter((f) => f.path === join(claudeSubdir, "AGENTS.md"));
		expect(matches).toHaveLength(1);
	});

	it("returns empty when no supplemental files exist", () => {
		const files = loadSupplementalContextFiles(projectDir, fakeClaude);
		expect(files).toHaveLength(0);
	});

	it("ancestor .claude/ dirs ordered closest-to-root first", () => {
		const level1 = join(testDir, ".claude");
		const level2 = join(testDir, "project", ".claude");
		mkdirSync(level1, { recursive: true });
		mkdirSync(level2, { recursive: true });
		writeFileSync(join(level1, "AGENTS.md"), "root-level");
		writeFileSync(join(level2, "AGENTS.md"), "project-level");

		const files = loadSupplementalContextFiles(projectDir, fakeClaude);
		const localFiles = files.filter((f) => f.path.startsWith(testDir));
		expect(localFiles).toHaveLength(2);
		expect(localFiles[0].content).toBe("root-level");
		expect(localFiles[1].content).toBe("project-level");
	});

	it("handles mixed global .local.md and ancestor .claude/ files", () => {
		writeFileSync(join(fakeClaude, "AGENTS.local.md"), "global local");
		const claudeSubdir = join(testDir, "project", ".claude");
		mkdirSync(claudeSubdir, { recursive: true });
		writeFileSync(join(claudeSubdir, "CLAUDE.local.md"), "proj local");

		const files = loadSupplementalContextFiles(projectDir, fakeClaude);
		expect(files).toHaveLength(2);
		expect(files[0].content).toBe("global local");
		expect(files[1].content).toBe("proj local");
	});
});
