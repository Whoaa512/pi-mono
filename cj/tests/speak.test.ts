/**
 * Tests for the speak extension's markdown -> speakable text conversion.
 */

import { describe, expect, it } from "vitest";
import { stripMarkdown } from "../../../dotfiles/ai/pi/agent/extensions/speak.ts";

const cases: Array<[name: string, input: string, expected: string]> = [
	["plain text unchanged", "Hello there.", "Hello there."],
	["headers lose hashes", "## Summary\nDone.", "Summary\nDone."],
	["bold and italic markers removed", "This is **bold** and *italic* and __b__ and _i_.", "This is bold and italic and b and i."],
	["snake_case identifiers preserved", "Set max_retry_count and foo_bar.", "Set max_retry_count and foo_bar."],
	["inline code keeps content", "Run `npm test` first.", "Run npm test first."],
	["fenced code block dropped", "Before.\n```ts\nconst x = 1;\n```\nAfter.", "Before.\nAfter."],
	["fenced block with no language dropped", "A\n```\nstuff\n```\nB", "A\nB"],
	["links become their text", "See [the docs](https://x.com/a) now.", "See the docs now."],
	["bare urls dropped", "Visit https://example.com/path?q=1 today.", "Visit today."],
	["angle-bracket urls dropped", "Visit <https://example.com> today.", "Visit today."],
	["images become alt text", "![diagram](img.png)", "diagram"],
	["bullet markers removed", "- one\n* two\n+ three", "one\ntwo\nthree"],
	["nested bullets removed", "- a\n  - b\n    - c", "a\nb\nc"],
	["numbered list markers removed", "1. first\n2. second\n10. tenth", "first\nsecond\ntenth"],
	["blockquote markers removed", "> quoted\n> more", "quoted\nmore"],
	["strikethrough dropped entirely", "Use ~~old~~ new.", "Use new."],
	["horizontal rules removed", "a\n\n---\n\nb\n***\nc", "a\n\nb\nc"],
	["table becomes comma rows, separator dropped", "| Name | Val |\n|---|---|\n| a | 1 |", "Name, Val\na, 1"],
	["html tags stripped", "Hi <br> there <b>bold</b>.", "Hi there bold."],
	["excess blank lines collapsed", "a\n\n\n\nb", "a\n\nb"],
	["multiple spaces collapsed", "a   b\t\tc", "a b c"],
	["leading and trailing whitespace trimmed", "\n\n  hi  \n\n", "hi"],
	["only a code block yields empty", "```\nx\n```", ""],
	[
		"realistic agent reply",
		"Done, 2 commits:\n\n- `bin/tts` -> `~/bin/tts` — hits **Azure** TTS\n- `speak.ts` — `/speak` spawns `tts`\n\n```bash\ntts \"hi\"\n```\n\nNext: run `/speak` to verify.",
		"Done, 2 commits:\n\nbin/tts -> ~/bin/tts — hits Azure TTS\nspeak.ts — /speak spawns tts\n\nNext: run /speak to verify.",
	],
];

describe("stripMarkdown", () => {
	it.each(cases)("%s", (_name, input, expected) => {
		expect(stripMarkdown(input)).toBe(expected);
	});

	it("is idempotent", () => {
		for (const [, input] of cases) {
			const once = stripMarkdown(input);
			expect(stripMarkdown(once)).toBe(once);
		}
	});
});
