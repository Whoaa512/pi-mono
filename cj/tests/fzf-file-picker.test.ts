/**
 * Tests for the fzf @ file picker extension: listing cache, shared walk, abort handling, matching.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createFzfFileProvider,
	createListingCache,
	extractAtPrefix,
	type FilterListing,
	fdWalk,
	fzfFilter,
	type GetListing,
	orAbort,
	toItem,
} from "../../../dotfiles/ai/pi/agent/extensions/fzf-file-picker.ts";

const which = (bin: string) => spawnSync("which", [bin], { encoding: "utf-8" }).stdout.trim();
const fdPath = which("fd");
const fzfPath = which("fzf");

const substringFilter: FilterListing = async (listing, query) =>
	listing.split("\n").filter((path) => path.includes(query));

const builtIn: AutocompleteProvider = {
	triggerCharacters: ["@"],
	getSuggestions: async () => ({ items: [{ value: "builtin", label: "builtin" }], prefix: "builtin" }),
	applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
};

function countingWalk(walk: GetListing): { walk: GetListing; calls: () => number } {
	let calls = 0;
	return {
		walk: (baseDir) => {
			calls++;
			return walk(baseDir);
		},
		calls: () => calls,
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

async function suggest(provider: AutocompleteProvider, text: string, signal = new AbortController().signal) {
	return provider.getSuggestions([text], 0, text.length, { signal });
}

describe("pure helpers", () => {
	it("extracts the @ token before the cursor", () => {
		expect(extractAtPrefix("@foo")).toBe("@foo");
		expect(extractAtPrefix("look at @src/fo")).toBe("@src/fo");
		expect(extractAtPrefix("no token")).toBeNull();
		expect(extractAtPrefix("a@b")).toBeNull();
	});

	it("builds items for files, directories, and paths with spaces", () => {
		expect(toItem("src/a.ts")).toEqual({ value: "@src/a.ts", label: "a.ts", description: "src/a.ts" });
		expect(toItem("sub/", "src/")).toEqual({ value: "@src/sub/", label: "sub/", description: "src/sub" });
		expect(toItem("my file.ts").value).toBe('@"my file.ts"');
	});

	it("orAbort resolves undefined as soon as the signal aborts", async () => {
		const controller = new AbortController();
		const pending = orAbort(new Promise<string>(() => {}), controller.signal);
		controller.abort();
		expect(await pending).toBeUndefined();
		expect(await orAbort(Promise.resolve("x"), controller.signal)).toBeUndefined();
		expect(await orAbort(Promise.resolve("x"), new AbortController().signal)).toBe("x");
	});
});

describe("listing cache", () => {
	it("walks again in the background once the listing is stale, serving the old one meanwhile", async () => {
		let version = 0;
		const counted = countingWalk(async () => `v${++version}`);
		const getListing = createListingCache(counted.walk, 0);

		expect(await getListing("/x")).toBe("v1");
		expect(await getListing("/x")).toBe("v1");
		expect(await getListing("/x")).toBe("v2");
	});
});

describe("delegation", () => {
	const provider = createFzfFileProvider(builtIn, tmpdir(), async () => "a.ts\n", substringFilter, 0);

	it("delegates non-@ text and empty @ queries to the built-in provider", async () => {
		expect((await suggest(provider, "/mod"))?.prefix).toBe("builtin");
		expect((await suggest(provider, "@"))?.prefix).toBe("builtin");
	});

	it("forwards trigger characters and applyCompletion", () => {
		expect(provider.triggerCharacters).toEqual(["@"]);
		const item = { value: "@a.ts", label: "a.ts" };
		expect(provider.applyCompletion(["@a"], 0, 2, item, "@a")).toEqual({
			lines: ["@a"],
			cursorLine: 0,
			cursorCol: 2,
		});
	});
});

describe.skipIf(!fdPath || !fzfPath)("with real fd and fzf", () => {
	let dir: string;

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "fzf-file-picker-"));
		mkdirSync(join(dir, "src", "modes"), { recursive: true });
		writeFileSync(join(dir, "src", "modes", "interactive-mode.ts"), "");
		writeFileSync(join(dir, "src", "modes", "print-mode.ts"), "");
		writeFileSync(join(dir, "README.md"), "");
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function setup(debounceMs = 0) {
		const counted = countingWalk((baseDir) => fdWalk(fdPath, baseDir));
		const filter: FilterListing = (listing, query, signal) => fzfFilter(fzfPath, listing, query, signal);
		const provider = createFzfFileProvider(builtIn, dir, createListingCache(counted.walk), filter, debounceMs);
		return { provider, calls: counted.calls };
	}

	it("matches non-consecutive fuzzy queries", async () => {
		const { provider } = setup();
		const result = await suggest(provider, "open @imts");
		expect(result?.prefix).toBe("@imts");
		expect(result?.items).toContainEqual({
			value: "@src/modes/interactive-mode.ts",
			label: "interactive-mode.ts",
			description: "src/modes/interactive-mode.ts",
		});
	});

	it("reuses the cached listing across queries", async () => {
		const { provider, calls } = setup();
		expect((await suggest(provider, "@read"))?.items[0]?.value).toBe("@README.md");
		expect((await suggest(provider, "@print"))?.items[0]?.value).toBe("@src/modes/print-mode.ts");
		expect(calls()).toBe(1);
	});

	it("shares one walk between concurrent requests", async () => {
		const { provider, calls } = setup();
		const results = await Promise.all([suggest(provider, "@i"), suggest(provider, "@im"), suggest(provider, "@imt")]);
		expect(results.every((result) => result !== null)).toBe(true);
		expect(calls()).toBe(1);
	});

	it("scopes the walk to an existing directory prefix and delegates when nothing follows the slash", async () => {
		const { provider } = setup();
		expect((await suggest(provider, "@src/modes/"))?.prefix).toBe("builtin");
		const result = await suggest(provider, "@src/modes/prnt");
		expect(result?.items.map((item) => item.value)).toEqual(["@src/modes/print-mode.ts"]);
	});

	it("returns null when nothing matches", async () => {
		const { provider } = setup();
		expect(await suggest(provider, "@zzzzqqqq")).toBeNull();
	});
});

describe("abort", () => {
	it("returns promptly during the debounce and lets the walk finish and fill the cache", async () => {
		const gate = deferred<string>();
		const counted = countingWalk(() => gate.promise);
		const getListing = createListingCache(counted.walk);
		const provider = createFzfFileProvider(builtIn, tmpdir(), getListing, substringFilter, 10_000);

		const controller = new AbortController();
		const started = Date.now();
		const pending = suggest(provider, "@abc", controller.signal);
		controller.abort();
		expect(await pending).toBeNull();
		expect(Date.now() - started).toBeLessThan(500);

		gate.resolve("abc.ts\n");
		expect(await getListing(tmpdir())).toBe("abc.ts\n");
		expect(counted.calls()).toBe(1);
	});

	it("returns promptly when aborted while waiting on a cold walk", async () => {
		const provider = createFzfFileProvider(
			builtIn,
			tmpdir(),
			() => new Promise<string>(() => {}),
			substringFilter,
			0,
		);
		const controller = new AbortController();
		const pending = suggest(provider, "@abc", controller.signal);
		setTimeout(() => controller.abort(), 20);
		expect(await pending).toBeNull();
	});
});
