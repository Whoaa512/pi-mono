/**
 * Unit tests for claude-rules extension logic.
 *
 * Tests recursive markdown file discovery.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Extracted logic from the extension
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";

function findMarkdownFiles(dir: string, basePath: string = ""): string[] {
	const results: string[] = [];
	if (!fs.existsSync(dir)) return results;

	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			results.push(...findMarkdownFiles(path.join(dir, entry.name), relativePath));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push(relativePath);
		}
	}
	return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findMarkdownFiles", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `claude-rules-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("returns empty for nonexistent directory", () => {
		expect(findMarkdownFiles("/nonexistent/path")).toEqual([]);
	});

	it("returns empty for empty directory", () => {
		expect(findMarkdownFiles(testDir)).toEqual([]);
	});

	it("finds .md files at top level", () => {
		writeFileSync(join(testDir, "testing.md"), "test rules");
		writeFileSync(join(testDir, "api-design.md"), "api rules");
		const files = findMarkdownFiles(testDir);
		expect(files.sort()).toEqual(["api-design.md", "testing.md"]);
	});

	it("ignores non-.md files", () => {
		writeFileSync(join(testDir, "rules.txt"), "text");
		writeFileSync(join(testDir, "config.json"), "{}");
		writeFileSync(join(testDir, "actual.md"), "md");
		const files = findMarkdownFiles(testDir);
		expect(files).toEqual(["actual.md"]);
	});

	it("finds .md files in subdirectories with relative paths", () => {
		const subdir = join(testDir, "frontend");
		mkdirSync(subdir);
		writeFileSync(join(subdir, "react.md"), "react rules");
		writeFileSync(join(subdir, "css.md"), "css rules");

		const files = findMarkdownFiles(testDir);
		expect(files.sort()).toEqual(["frontend/css.md", "frontend/react.md"]);
	});

	it("handles deeply nested directories", () => {
		const deep = join(testDir, "a", "b", "c");
		mkdirSync(deep, { recursive: true });
		writeFileSync(join(deep, "deep.md"), "deep");

		const files = findMarkdownFiles(testDir);
		expect(files).toEqual(["a/b/c/deep.md"]);
	});

	it("mixes top-level and nested files", () => {
		writeFileSync(join(testDir, "top.md"), "top");
		const sub = join(testDir, "sub");
		mkdirSync(sub);
		writeFileSync(join(sub, "nested.md"), "nested");

		const files = findMarkdownFiles(testDir);
		expect(files.sort()).toEqual(["sub/nested.md", "top.md"]);
	});
});
