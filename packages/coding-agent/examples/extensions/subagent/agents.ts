/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

const CLAUDE_TOOL_ALIASES: Record<string, string | undefined> = {
	bash: "bash",
	edit: "edit",
	glob: "find",
	grep: "grep",
	ls: "ls",
	multiedit: "edit",
	read: "read",
	write: "write",
};

function normalizeToolName(tool: string, dir: string): string | undefined {
	const normalized = tool.trim().toLowerCase();
	if (!dir.includes(`${path.sep}.claude${path.sep}agents`)) return normalized;
	return CLAUDE_TOOL_ALIASES[normalized];
}

function normalizeModel(model: string | undefined): string | undefined {
	if (!model) return undefined;
	if (model.toLowerCase() === "inherit") return undefined;
	return model;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools = frontmatter.tools
			?.split(",")
			.map((t: string) => normalizeToolName(t, dir))
			.filter((tool): tool is string => Boolean(tool));

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: normalizeModel(frontmatter.model),
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDirs(cwd: string): string[] {
	let currentDir = cwd;
	while (true) {
		const candidates = [path.join(currentDir, ".claude", "agents"), path.join(currentDir, ".pi", "agents")];
		const dirs = candidates.filter(isDirectory);
		if (dirs.length > 0) return dirs;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return [];
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDirs = findNearestProjectAgentsDirs(cwd);
	const projectAgentsDir = projectAgentsDirs.length > 0 ? projectAgentsDirs.join(", ") : null;

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" ? [] : projectAgentsDirs.flatMap((dir) => loadAgentsFromDir(dir, "project"));

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
