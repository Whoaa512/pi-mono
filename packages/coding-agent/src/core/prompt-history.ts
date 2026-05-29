import * as fs from "node:fs";
import * as path from "node:path";
import { getLegacyPromptHistoryPath, getPromptHistoryPath } from "../config.ts";

const MAX_ENTRIES = 500;

interface PromptHistoryFile {
	cwd: string;
	prompts: string[];
}

function migrateLegacy(): string[] {
	const legacyPath = getLegacyPromptHistoryPath();
	if (!fs.existsSync(legacyPath)) return [];

	try {
		const data = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
		if (!Array.isArray(data.prompts)) return [];
		return data.prompts;
	} catch {
		return [];
	}
}

export function loadPromptHistory(cwd?: string): string[] {
	const dir = cwd ?? process.cwd();
	const filePath = getPromptHistoryPath(dir);

	if (fs.existsSync(filePath)) {
		try {
			const data: PromptHistoryFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));
			if (data?.cwd === dir && Array.isArray(data.prompts)) return data.prompts;
		} catch {}
	}

	return migrateLegacy();
}

export function savePromptToHistory(text: string, cwd?: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;

	const dir = cwd ?? process.cwd();
	const prompts = loadPromptHistory(dir);

	const idx = prompts.indexOf(trimmed);
	if (idx !== -1) prompts.splice(idx, 1);

	prompts.unshift(trimmed);

	if (prompts.length > MAX_ENTRIES) prompts.length = MAX_ENTRIES;

	const filePath = getPromptHistoryPath(dir);
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
	} catch {}
	try {
		fs.writeFileSync(filePath, JSON.stringify({ cwd: dir, prompts } satisfies PromptHistoryFile), "utf-8");
	} catch {}
}
