/**
 * Integration tests for no-commit-to-trunk extension.
 *
 * Loads the actual extension via the test harness and validates
 * that tool_call blocking works end-to-end.
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessWithExtensions, type Harness } from "../../packages/coding-agent/test/test-harness.js";
import { createTestResourceLoader } from "../../packages/coding-agent/test/utilities.js";
import { loadExtensions } from "../../packages/coding-agent/src/core/extensions/loader.js";

const EXTENSION_PATH = join(
	process.env.HOME ?? "",
	"code/dotfiles/ai/pi/agent/extensions/no-commit-to-trunk.ts",
);

function initGitRepo(dir: string, branch = "master") {
	execSync("git init", { cwd: dir, stdio: "ignore" });
	execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: "ignore" });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
	execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
	writeFileSync(join(dir, "README.md"), "# test");
	execSync("git add .", { cwd: dir, stdio: "ignore" });
	execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
}

describe("no-commit-to-trunk extension integration", () => {
	let harness: Harness;
	let gitDir: string;
	let bashResults: Array<{ command: string; output: string; isError: boolean }>;

	beforeEach(() => {
		gitDir = join(tmpdir(), `trunk-guard-int-${Date.now()}`);
		mkdirSync(gitDir, { recursive: true });
		bashResults = [];
	});

	afterEach(() => {
		harness?.cleanup();
		rmSync(gitDir, { recursive: true, force: true });
	});

	function createBashTool(): AgentTool {
		return {
			name: "bash",
			label: "Bash",
			description: "Execute bash commands",
			parameters: Type.Object({
				command: Type.String(),
				timeout: Type.Optional(Type.Number()),
			}),
			execute: async (_toolCallId, params: { command: string }) => {
				bashResults.push({ command: params.command, output: "ok", isError: false });
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};
	}

	async function createTestHarness(
		branch: string,
		responses: Array<string | { toolCalls: Array<{ name: string; args: Record<string, unknown> }> }>,
	) {
		initGitRepo(gitDir, branch);

		const extResult = await loadExtensions([EXTENSION_PATH], gitDir);
		if (extResult.errors.length > 0) {
			throw new Error(`Extension load errors: ${extResult.errors.map((e) => e.error).join(", ")}`);
		}

		const bashToolInst = createBashTool();
		const resourceLoader = createTestResourceLoader({ extensionsResult: extResult });
		const allResponses = [...responses, "done"];

		harness = await createHarnessWithExtensions({
			responses: allResponses,
			tools: [bashToolInst],
			baseToolsOverride: { bash: bashToolInst },
			resourceLoader,
			extensionFactories: [],
		});

		(harness.session as any).cwd = gitDir;
		return harness;
	}

	it("blocks git commit on master branch", async () => {
		await createTestHarness("master", [
			{
				toolCalls: [
					{
						name: "bash",
						args: { command: `cd ${gitDir} && git commit -m "bad commit"` },
					},
				],
			},
		]);

		await harness.session.prompt("commit the changes");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		const blocked = toolResults.some(
			(m) =>
				"content" in m &&
				Array.isArray(m.content) &&
				m.content.some((c: any) => c.text?.includes("Blocked")),
		);
		expect(blocked).toBe(true);
	});

	it("blocks git commit on main branch", async () => {
		await createTestHarness("main", [
			{
				toolCalls: [
					{
						name: "bash",
						args: { command: `cd ${gitDir} && git commit -m "bad commit"` },
					},
				],
			},
		]);

		await harness.session.prompt("commit the changes");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		const blocked = toolResults.some(
			(m) =>
				"content" in m &&
				Array.isArray(m.content) &&
				m.content.some((c: any) => c.text?.includes("Blocked")),
		);
		expect(blocked).toBe(true);
	});

	it("allows git commit on feature branch", async () => {
		initGitRepo(gitDir, "master");
		execSync("git checkout -b feature/test", { cwd: gitDir, stdio: "ignore" });

		const extResult = await loadExtensions([EXTENSION_PATH], gitDir);
		const bashToolInst = createBashTool();
		const resourceLoader = createTestResourceLoader({ extensionsResult: extResult });

		harness = await createHarnessWithExtensions({
			responses: [
				{
					toolCalls: [
						{
							name: "bash",
							args: { command: `cd ${gitDir} && git commit -m "ok commit"` },
						},
					],
				},
				"done",
			],
			tools: [bashToolInst],
			baseToolsOverride: { bash: bashToolInst },
			resourceLoader,
			extensionFactories: [],
		});

		(harness.session as any).cwd = gitDir;

		await harness.session.prompt("commit");

		expect(bashResults.length).toBeGreaterThan(0);
		expect(bashResults[0].command).toContain("git commit");
	});

	it("blocks gt create on protected branch", async () => {
		await createTestHarness("master", [
			{
				toolCalls: [
					{
						name: "bash",
						args: { command: `cd ${gitDir} && gt create -m "new branch"` },
					},
				],
			},
		]);

		await harness.session.prompt("create branch");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		const blocked = toolResults.some(
			(m) =>
				"content" in m &&
				Array.isArray(m.content) &&
				m.content.some((c: any) => c.text?.includes("Blocked")),
		);
		expect(blocked).toBe(true);
	});

	it("allows non-commit commands on protected branch", async () => {
		await createTestHarness("master", [
			{
				toolCalls: [
					{
						name: "bash",
						args: { command: `cd ${gitDir} && git status` },
					},
				],
			},
		]);

		await harness.session.prompt("check status");

		expect(bashResults.length).toBeGreaterThan(0);
		expect(bashResults[0].command).toContain("git status");
	});
});
