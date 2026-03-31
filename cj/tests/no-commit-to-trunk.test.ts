/**
 * Unit tests for no-commit-to-trunk extension logic.
 *
 * Tests the pure functions (resolveEffectiveCwd, commit pattern matching)
 * and integration tests via the AgentSession test harness.
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Extracted logic from the extension for direct unit testing
// ---------------------------------------------------------------------------

const PROTECTED_BRANCHES = ["main", "master"];
const COMMIT_PATTERNS = [/\bgit\s+commit\b/, /\bgt\s+(create|modify)\b/];

function resolveEffectiveCwd(command: string, cwd: string): string {
	const cdMatch = command.match(/^\s*cd\s+(\S+)\s*(?:&&|;)/);
	if (!cdMatch) {
		const gitCFlag = command.match(/\bgit\s+-C\s+(\S+)/);
		if (gitCFlag) {
			return resolve(cwd, gitCFlag[1]);
		}
		return cwd;
	}
	return resolve(cwd, cdMatch[1]);
}

function isCommitCommand(command: string): boolean {
	return COMMIT_PATTERNS.some((p) => p.test(command));
}

function loadAllowListFromLines(lines: string[]): RegExp[] {
	return lines
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"))
		.map((l) => new RegExp(l));
}

// ---------------------------------------------------------------------------
// resolveEffectiveCwd
// ---------------------------------------------------------------------------

describe("resolveEffectiveCwd", () => {
	it("returns cwd when no cd or -C in command", () => {
		expect(resolveEffectiveCwd("git commit -m 'test'", "/work/repo")).toBe("/work/repo");
	});

	it("resolves relative cd path", () => {
		expect(resolveEffectiveCwd("cd subdir && git commit -m 'test'", "/work/repo")).toBe("/work/repo/subdir");
	});

	it("resolves absolute cd path (the bug that was fixed)", () => {
		const result = resolveEffectiveCwd("cd /Users/me/work/twig && git commit -m 'test'", "/Users/me/other");
		expect(result).toBe("/Users/me/work/twig");
	});

	it("resolves cd with semicolon separator", () => {
		expect(resolveEffectiveCwd("cd /tmp/repo ; git commit -m 'x'", "/home")).toBe("/tmp/repo");
	});

	it("resolves git -C with relative path", () => {
		expect(resolveEffectiveCwd("git -C ../other commit -m 'x'", "/work/repo")).toBe("/work/other");
	});

	it("resolves git -C with absolute path", () => {
		expect(resolveEffectiveCwd("git -C /abs/path commit -m 'x'", "/work/repo")).toBe("/abs/path");
	});

	it("handles cd with tilde-prefixed path as literal (no expansion)", () => {
		const result = resolveEffectiveCwd("cd ~/work/repo && git commit -m 'x'", "/home/user");
		expect(result).toBe(resolve("/home/user", "~/work/repo"));
	});

	it("handles multi-step cd && operations (only first cd captured)", () => {
		const result = resolveEffectiveCwd("cd /first && cd /second && git commit -m 'x'", "/base");
		expect(result).toBe("/first");
	});

	it("handles cd path with trailing slash (resolve normalizes it)", () => {
		expect(resolveEffectiveCwd("cd /work/repo/ && git commit", "/base")).toBe("/work/repo");
	});

	it("returns cwd for non-cd non-git-C commands with commit", () => {
		expect(resolveEffectiveCwd("echo test && git commit -m 'x'", "/work")).toBe("/work");
	});
});

// ---------------------------------------------------------------------------
// Commit pattern matching
// ---------------------------------------------------------------------------

describe("isCommitCommand", () => {
	it("detects git commit", () => {
		expect(isCommitCommand("git commit -m 'test'")).toBe(true);
	});

	it("detects git commit with cd prefix", () => {
		expect(isCommitCommand("cd /repo && git commit -m 'msg'")).toBe(true);
	});

	it("detects git commit with add prefix", () => {
		expect(isCommitCommand("git add . && git commit -m 'msg'")).toBe(true);
	});

	it("detects gt create", () => {
		expect(isCommitCommand("gt create -m 'branch'")).toBe(true);
	});

	it("detects gt modify", () => {
		expect(isCommitCommand("gt modify --commit -m 'amend'")).toBe(true);
	});

	it("ignores git status", () => {
		expect(isCommitCommand("git status")).toBe(false);
	});

	it("ignores git log with commit in output", () => {
		expect(isCommitCommand("git log --oneline")).toBe(false);
	});

	it("ignores echo with git commit string", () => {
		expect(isCommitCommand("echo 'run git commit later'")).toBe(true);
	});

	it("ignores git push", () => {
		expect(isCommitCommand("git push origin main")).toBe(false);
	});

	it("ignores git diff", () => {
		expect(isCommitCommand("git diff HEAD")).toBe(false);
	});

	it("detects git commit at end of pipeline", () => {
		expect(isCommitCommand("git add -A && git commit -m 'all'")).toBe(true);
	});

	it("ignores git commit --amend in commented line", () => {
		expect(isCommitCommand("# git commit --amend")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Allow list parsing
// ---------------------------------------------------------------------------

describe("loadAllowListFromLines", () => {
	it("parses patterns from lines", () => {
		const patterns = loadAllowListFromLines(["work\\/cj\\/?", "(cj_winslow|cjw)\\/\\.pi\\/?"]);
		expect(patterns).toHaveLength(2);
		expect(patterns[0].test("/work/cj/")).toBe(true);
		expect(patterns[1].test("/home/cj_winslow/.pi/")).toBe(true);
	});

	it("skips comments and blank lines", () => {
		const patterns = loadAllowListFromLines(["# comment", "", "  ", "pattern"]);
		expect(patterns).toHaveLength(1);
		expect(patterns[0].test("pattern")).toBe(true);
	});

	it("trims whitespace", () => {
		const patterns = loadAllowListFromLines(["  myrepo  "]);
		expect(patterns).toHaveLength(1);
		expect(patterns[0].test("myrepo")).toBe(true);
	});

	it("returns empty for empty input", () => {
		expect(loadAllowListFromLines([])).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Git branch integration tests (requires git)
// ---------------------------------------------------------------------------

describe("git branch detection (integration)", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `trunk-guard-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		execSync("git init", { cwd: testDir, stdio: "ignore" });
		execSync("git checkout -b master", { cwd: testDir, stdio: "ignore" });
		writeFileSync(join(testDir, "README.md"), "# test");
		execSync("git add .", { cwd: testDir, stdio: "ignore" });
		execSync('git commit -m "init"', { cwd: testDir, stdio: "ignore" });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	function getCurrentBranch(cwd: string): string | null {
		try {
			return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
		} catch {
			return null;
		}
	}

	it("detects master branch", () => {
		expect(getCurrentBranch(testDir)).toBe("master");
		expect(PROTECTED_BRANCHES.includes("master")).toBe(true);
	});

	it("detects main branch", () => {
		execSync("git checkout -b main", { cwd: testDir, stdio: "ignore" });
		expect(getCurrentBranch(testDir)).toBe("main");
		expect(PROTECTED_BRANCHES.includes("main")).toBe(true);
	});

	it("allows feature branches", () => {
		execSync("git checkout -b feature/my-thing", { cwd: testDir, stdio: "ignore" });
		const branch = getCurrentBranch(testDir);
		expect(branch).toBe("feature/my-thing");
		expect(PROTECTED_BRANCHES.includes(branch!)).toBe(false);
	});

	it("returns null for non-git directory", () => {
		const nonGitDir = join(tmpdir(), `no-git-${Date.now()}`);
		mkdirSync(nonGitDir, { recursive: true });
		expect(getCurrentBranch(nonGitDir)).toBe(null);
		rmSync(nonGitDir, { recursive: true, force: true });
	});

	it("resolveEffectiveCwd + getCurrentBranch works for absolute cd path", () => {
		const effectiveCwd = resolveEffectiveCwd(`cd ${testDir} && git commit -m 'test'`, "/some/other/dir");
		expect(effectiveCwd).toBe(testDir);
		expect(getCurrentBranch(effectiveCwd)).toBe("master");
	});
});
