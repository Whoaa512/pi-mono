import { parse } from "yaml";

type ParsedFrontmatter<T extends Record<string, unknown>> = {
	frontmatter: T;
	body: string;
};

const normalizeNewlines = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const extractFrontmatter = (content: string): { yamlString: string | null; body: string } => {
	const normalized = normalizeNewlines(content);

	if (!normalized.startsWith("---")) {
		return { yamlString: null, body: normalized };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { yamlString: null, body: normalized };
	}

	return {
		yamlString: normalized.slice(4, endIndex),
		body: normalized.slice(endIndex + 4).trim(),
	};
};

const RISKY_YAML_CHARS = /[{}[\]*&#!|>%@`\\]/;

const requoteYaml = (yamlString: string): string =>
	yamlString
		.split("\n")
		.map((line) => {
			const colonIdx = line.indexOf(":");
			if (colonIdx === -1) return line;
			const key = line.slice(0, colonIdx);
			const rest = line.slice(colonIdx + 1);
			const value = rest.trimStart();
			if (!value || value.startsWith('"') || value.startsWith("'")) return line;
			if (!RISKY_YAML_CHARS.test(value)) return line;
			const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
			return `${key}: "${escaped}"`;
		})
		.join("\n");

const parseSimpleKeyValue = (yamlString: string): Record<string, unknown> => {
	const result: Record<string, unknown> = {};
	for (const line of yamlString.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;
		const key = trimmed.slice(0, colonIdx).trim();
		let value: string | boolean = trimmed.slice(colonIdx + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (value === "true") result[key] = true;
		else if (value === "false") result[key] = false;
		else result[key] = value;
	}
	return result;
};

export const parseFrontmatter = <T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> => {
	const { yamlString, body } = extractFrontmatter(content);
	if (!yamlString) {
		return { frontmatter: {} as T, body };
	}
	try {
		const parsed = parse(yamlString);
		return { frontmatter: (parsed ?? {}) as T, body };
	} catch {
		try {
			const parsed = parse(requoteYaml(yamlString));
			return { frontmatter: (parsed ?? {}) as T, body };
		} catch {
			const parsed = parseSimpleKeyValue(yamlString);
			return { frontmatter: parsed as T, body };
		}
	}
};

export const stripFrontmatter = (content: string): string => parseFrontmatter(content).body;
