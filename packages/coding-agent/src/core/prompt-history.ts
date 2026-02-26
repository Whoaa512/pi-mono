import * as fs from "node:fs";
import * as path from "node:path";
import { getPromptHistoryPath } from "../config.js";

const MAX_ENTRIES = 500;

interface PromptHistoryFile {
	prompts: string[];
}

export function loadPromptHistory(): string[] {
	const filePath = getPromptHistoryPath();
	if (!fs.existsSync(filePath)) return [];

	try {
		const data: PromptHistoryFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		if (!Array.isArray(data.prompts)) return [];
		return data.prompts;
	} catch {
		return [];
	}
}

export function savePromptToHistory(text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;

	const prompts = loadPromptHistory();

	const idx = prompts.indexOf(trimmed);
	if (idx !== -1) prompts.splice(idx, 1);

	prompts.unshift(trimmed);

	if (prompts.length > MAX_ENTRIES) prompts.length = MAX_ENTRIES;

	const filePath = getPromptHistoryPath();
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
	} catch {
		// dir already exists
	}
	try {
		fs.writeFileSync(filePath, JSON.stringify({ prompts } satisfies PromptHistoryFile), "utf-8");
	} catch {
		// best effort
	}
}
