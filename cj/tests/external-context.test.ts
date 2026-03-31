/**
 * Unit tests for external-context extension logic.
 *
 * Tests path resolution, context file discovery, and ancestor traversal.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Extracted logic from the extension
// ---------------------------------------------------------------------------

const CONTEXT_FILENAMES = ["AGENTS.md", "AGENTS.local.md", "CLAUDE.md", "CLAUDE.local.md"];

function resolvePath(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return resolve(p);
}

function loadContextFilesFromDir(dir: string): Array<{ path: string; content: string }> {
	const results: Array<{ path: string; content: string }> = [];
	const { existsSync, readFileSync } = require("node:fs");
	for (const filename of CONTEXT_FILENAMES) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				results.push({ path: filePath, content: readFileSync(filePath, "utf-8") });
			} catch {
				// skip
			}
		}
	}
	return results;
}

function loadExternalContextFiles(cwd: string, contextDirs: string[]): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];
	const seenPaths = new Set<string>();

	const addFile = (file: { path: string; content: string }) => {
		if (!seenPaths.has(file.path)) {
			files.push(file);
			seenPaths.add(file.path);
		}
	};

	for (const dir of contextDirs) {
		const resolved = resolvePath(dir);
		for (const file of loadContextFilesFromDir(resolved)) {
			addFile(file);
		}
	}

	let currentDir = cwd;
	const root = resolve("/");
	const ancestorFiles: Array<{ path: string; content: string }> = [];

	while (true) {
		for (const dir of contextDirs) {
			if (dir.startsWith("~/.")) {
				const subdirName = dir.slice(2);
				const subdir = join(currentDir, subdirName);
				for (const file of loadContextFilesFromDir(subdir)) {
					if (!seenPaths.has(file.path)) {
						ancestorFiles.unshift(file);
						seenPaths.add(file.path);
					}
				}
			}
		}

		if (currentDir === root) break;
		const parentDir = require("node:path").dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	files.push(...ancestorFiles);
	return files;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolvePath", () => {
	it("resolves ~ to homedir", () => {
		expect(resolvePath("~")).toBe(homedir());
	});

	it("resolves ~/path to homedir/path", () => {
		expect(resolvePath("~/.claude")).toBe(join(homedir(), ".claude"));
	});

	it("resolves absolute paths as-is", () => {
		expect(resolvePath("/tmp/test")).toBe("/tmp/test");
	});

	it("resolves relative paths against cwd", () => {
		const result = resolvePath("relative/path");
		expect(result).toBe(resolve("relative/path"));
	});
});

describe("loadContextFilesFromDir", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `ctx-files-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("finds AGENTS.md", () => {
		writeFileSync(join(testDir, "AGENTS.md"), "agent rules");
		const files = loadContextFilesFromDir(testDir);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe("agent rules");
	});

	it("finds multiple context files", () => {
		writeFileSync(join(testDir, "AGENTS.md"), "a");
		writeFileSync(join(testDir, "CLAUDE.md"), "b");
		writeFileSync(join(testDir, "AGENTS.local.md"), "c");
		const files = loadContextFilesFromDir(testDir);
		expect(files).toHaveLength(3);
	});

	it("returns empty for dir without context files", () => {
		writeFileSync(join(testDir, "README.md"), "not a context file");
		expect(loadContextFilesFromDir(testDir)).toHaveLength(0);
	});

	it("returns empty for nonexistent dir", () => {
		expect(loadContextFilesFromDir("/nonexistent/path")).toHaveLength(0);
	});

	it("preserves file order (AGENTS.md, AGENTS.local.md, CLAUDE.md, CLAUDE.local.md)", () => {
		for (const f of CONTEXT_FILENAMES) {
			writeFileSync(join(testDir, f), f);
		}
		const files = loadContextFilesFromDir(testDir);
		expect(files.map((f) => f.content)).toEqual(CONTEXT_FILENAMES);
	});
});

describe("loadExternalContextFiles", () => {
	let testDir: string;
	let projectDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `ext-ctx-test-${Date.now()}`);
		projectDir = join(testDir, "project", "sub");
		mkdirSync(projectDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("finds context files in project .claude dir", () => {
		const claudeDir = join(testDir, "project", ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(join(claudeDir, "AGENTS.md"), "project rules");

		const files = loadExternalContextFiles(projectDir, ["~/.claude"]);
		const projectFile = files.find((f) => f.path.includes(testDir));
		expect(projectFile).toBeDefined();
		expect(projectFile!.content).toBe("project rules");
	});

	it("finds context files in ancestor directories", () => {
		const parentClaude = join(testDir, ".claude");
		mkdirSync(parentClaude, { recursive: true });
		writeFileSync(join(parentClaude, "AGENTS.md"), "parent rules");

		const files = loadExternalContextFiles(projectDir, ["~/.claude"]);
		const parentFile = files.find((f) => f.path.includes(parentClaude));
		expect(parentFile).toBeDefined();
		expect(parentFile!.content).toBe("parent rules");
	});

	it("deduplicates by path", () => {
		const claudeDir = join(testDir, "project", ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(join(claudeDir, "AGENTS.md"), "rules");

		const files = loadExternalContextFiles(join(testDir, "project"), ["~/.claude"]);
		const projectFiles = files.filter((f) => f.path === join(claudeDir, "AGENTS.md"));
		expect(projectFiles).toHaveLength(1);
	});

	it("returns empty when no context files exist", () => {
		const files = loadExternalContextFiles(projectDir, ["~/.nonexistent-dir"]);
		const localFiles = files.filter((f) => f.path.includes(testDir));
		expect(localFiles).toHaveLength(0);
	});

	it("ancestor files ordered closest-to-root first in the ancestor section", () => {
		const level1 = join(testDir, ".claude");
		const level2 = join(testDir, "project", ".claude");
		mkdirSync(level1, { recursive: true });
		mkdirSync(level2, { recursive: true });
		writeFileSync(join(level1, "AGENTS.md"), "root-level");
		writeFileSync(join(level2, "AGENTS.md"), "project-level");

		const files = loadExternalContextFiles(projectDir, ["~/.claude"]);
		const localFiles = files.filter((f) => f.path.startsWith(testDir));
		expect(localFiles).toHaveLength(2);
		expect(localFiles[0].content).toBe("root-level");
		expect(localFiles[1].content).toBe("project-level");
	});
});
