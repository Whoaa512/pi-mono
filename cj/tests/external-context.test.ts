/**
 * Tests for the external-context extension: ~/.claude and ancestor .claude/
 * context files merged into pi's native context files, with real-path dedup
 * and `@path` import expansion.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	contextFilesDisabled,
	expandContextImports,
	mergeContextFiles,
} from "../../../dotfiles/ai/pi/agent/extensions/external-context.ts";

let testDir: string;
let home: string;
let claudeDir: string;
let project: string;
let cwd: string;

beforeEach(() => {
	testDir = realpathSync(mkdtempSync(join(tmpdir(), "external-context-")));
	home = join(testDir, "home");
	claudeDir = join(home, ".claude");
	project = join(home, "project");
	cwd = join(project, "sub");
	mkdirSync(claudeDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
	rmSync(testDir, { recursive: true, force: true });
});

function write(path: string, content: string): { path: string; content: string } {
	writeFileSync(path, content);
	return { path, content };
}

describe("mergeContextFiles", () => {
	it("returns native files untouched when nothing external exists", () => {
		const native = [write(join(project, "AGENTS.md"), "project")];
		expect(mergeContextFiles(native, cwd, home)).toEqual(native);
	});

	it("puts ~/.claude files before native files, exactly once", () => {
		write(join(claudeDir, "CLAUDE.md"), "global claude");
		write(join(claudeDir, "CLAUDE.local.md"), "global local");
		const native = [write(join(project, "AGENTS.md"), "project")];

		const files = mergeContextFiles(native, cwd, home);

		expect(files.map((f) => f.content)).toEqual(["global claude", "global local", "project"]);
		expect(files.filter((f) => f.path === join(claudeDir, "CLAUDE.md"))).toHaveLength(1);
	});

	it("is idempotent when its own output is fed back in", () => {
		write(join(claudeDir, "CLAUDE.md"), "global claude");
		const once = mergeContextFiles([], cwd, home);
		expect(mergeContextFiles(once, cwd, home)).toEqual(once);
	});

	it("appends ancestor .claude/ files after native files, root-most first", () => {
		mkdirSync(join(project, ".claude"));
		mkdirSync(join(cwd, ".claude"));
		write(join(project, ".claude", "AGENTS.md"), "project agents");
		write(join(project, ".claude", "AGENTS.local.md"), "project local");
		write(join(cwd, ".claude", "CLAUDE.md"), "sub claude");
		const native = [write(join(project, "AGENTS.md"), "native")];

		const files = mergeContextFiles(native, cwd, home);

		expect(files.map((f) => f.content)).toEqual(["native", "project agents", "project local", "sub claude"]);
	});

	it("skips a file whose real path is already a context file", () => {
		const shared = write(join(testDir, "shared.md"), "shared");
		symlinkSync(shared.path, join(claudeDir, "CLAUDE.md"), "file");
		symlinkSync(shared.path, join(project, "AGENTS.md"), "file");
		mkdirSync(join(project, ".claude"));
		symlinkSync(shared.path, join(project, ".claude", "AGENTS.md"), "file");

		const files = mergeContextFiles([{ path: join(project, "AGENTS.md"), content: "shared" }], cwd, home);

		expect(files).toEqual([{ path: join(claudeDir, "CLAUDE.md"), content: "shared" }]);
	});

	it("expands imports in both external and native files", () => {
		write(join(home, "core.md"), "CORE_CONTENT");
		write(join(claudeDir, "CLAUDE.md"), "@~/core.md");
		write(join(project, "rules.md"), "RULES_CONTENT");
		const native = [write(join(project, "AGENTS.md"), "@./rules.md")];

		const files = mergeContextFiles(native, cwd, home);

		expect(files.map((f) => f.content)).toEqual(["CORE_CONTENT", "RULES_CONTENT"]);
	});

	it("resolves relative imports against the real dir of a symlinked file", () => {
		const realDir = join(testDir, "dotfiles");
		mkdirSync(realDir);
		write(join(realDir, "sibling.md"), "SIBLING_CONTENT");
		write(join(realDir, "CLAUDE.md"), "@./sibling.md");
		symlinkSync(join(realDir, "CLAUDE.md"), join(claudeDir, "CLAUDE.md"), "file");

		expect(mergeContextFiles([], cwd, home)[0].content).toBe("SIBLING_CONTENT");
	});
});

describe("expandContextImports", () => {
	const expand = (content: string) => expandContextImports(content, project, home, new Set());

	it("expands relative, nested, absolute and ~/ imports", () => {
		mkdirSync(join(project, "docs"));
		write(join(project, "docs", "nested.md"), "NESTED_CONTENT");
		write(join(project, "docs", "relative.md"), "RELATIVE_CONTENT @./nested.md");
		const absolute = write(join(testDir, "absolute.md"), "ABSOLUTE_CONTENT");
		write(join(home, "home.md"), "HOME_CONTENT");

		const content = expand(
			["@./docs/relative.md", `see @${absolute.path}`, "@~/home.md", "@/definitely/missing/file.md"].join("\n"),
		);

		expect(content).toBe(
			["RELATIVE_CONTENT NESTED_CONTENT", "see ABSOLUTE_CONTENT", "HOME_CONTENT", "@/definitely/missing/file.md"].join(
				"\n",
			),
		);
	});

	it("leaves directory, package-name and URL references literal", () => {
		mkdirSync(join(project, "notes"));
		const content = [
			`store notes in the @${join(project, "notes")} directory`,
			"use tsgo provided by @typescript/native-preview",
			"see @https://example.com/doc.md",
		].join("\n");

		expect(expand(content)).toBe(content);
	});

	it("stops after 5 hops", () => {
		for (let i = 1; i <= 7; i++) {
			write(join(project, `hop${i}.md`), `HOP_${i} @./hop${i + 1}.md`);
		}

		const content = expand("@./hop1.md");

		for (let i = 1; i <= 5; i++) {
			expect(content).toContain(`HOP_${i}`);
		}
		expect(content).not.toContain("HOP_6");
		expect(content).toContain("@./hop6.md");
	});

	it("does not loop on cyclic imports", () => {
		write(join(project, "a.md"), "A_CONTENT @./b.md");
		write(join(project, "b.md"), "B_CONTENT @./a.md");

		expect(expand("@./a.md")).toBe("A_CONTENT B_CONTENT @./a.md");
	});

	it("does not expand inside code fences or inline code", () => {
		write(join(project, "secret.md"), "SHOULD_NOT_APPEAR");
		const content = [
			"```bash",
			"cat @./secret.md",
			"```",
			"inline `@./secret.md` reference",
			"~~~",
			"@./secret.md",
			"~~~",
		].join("\n");

		expect(expand(content)).toBe(content);
	});
});

describe("contextFilesDisabled", () => {
	it("detects --no-context-files and -nc", () => {
		expect(contextFilesDisabled(["node", "pi", "--no-context-files"])).toBe(true);
		expect(contextFilesDisabled(["node", "pi", "-nc"])).toBe(true);
		expect(contextFilesDisabled(["node", "pi", "-p", "hi"])).toBe(false);
	});
});
