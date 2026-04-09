import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../examples/extensions/subagent/agents.js";

const tempDirs: string[] = [];

async function makeTempProject() {
	const dir = await mkdtemp(join(tmpdir(), "pi-subagent-agents-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("subagent agent discovery", () => {
	it("discovers Claude project agents and normalizes Claude metadata", async () => {
		const project = await makeTempProject();
		const agentsDir = join(project, ".claude", "agents");
		await mkdir(agentsDir, { recursive: true });
		await writeFile(
			join(agentsDir, "style-reviewer.md"),
			`---
name: style-reviewer
description: Reviews style
tools: Read, Grep, Glob, Bash, Task
model: inherit
---
Review style.
`,
		);

		const result = discoverAgents(project, "project");
		expect(result.projectAgentsDir).toBe(agentsDir);
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0]).toMatchObject({
			name: "style-reviewer",
			description: "Reviews style",
			tools: ["read", "grep", "find", "bash"],
			model: undefined,
			source: "project",
			systemPrompt: "Review style.",
		});
	});

	it("prefers .pi agents over .claude agents with the same name", async () => {
		const project = await makeTempProject();
		await mkdir(join(project, ".claude", "agents"), { recursive: true });
		await mkdir(join(project, ".pi", "agents"), { recursive: true });
		await writeFile(
			join(project, ".claude", "agents", "reviewer.md"),
			`---
name: reviewer
description: Claude reviewer
---
Claude body.
`,
		);
		await writeFile(
			join(project, ".pi", "agents", "reviewer.md"),
			`---
name: reviewer
description: Pi reviewer
---
Pi body.
`,
		);

		const result = discoverAgents(project, "project");
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0].description).toBe("Pi reviewer");
		expect(result.agents[0].systemPrompt).toBe("Pi body.");
	});
});
