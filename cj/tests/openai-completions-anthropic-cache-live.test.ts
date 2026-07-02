/**
 * Live integration test for Anthropic cache_control injection through an
 * openai-completions-shaped gateway (any proxy that fronts Anthropic).
 *
 * Validates that a claude model routed through the gateway returns
 * cacheRead > 0 on turn 2. Fully env-configured so no internal hostnames or
 * model ids are checked in.
 *
 * Required env:
 *   RUN_LIVE_ANTHROPIC_CACHE=1   gate (otherwise skipped)
 *   LIVE_BASE_URL                e.g. https://your-gateway.example.com/v1
 *   LIVE_MODEL_ID                e.g. anthropic.claude-opus-4-x (must match /anthropic|claude/i)
 *   LIVE_API_KEY                 bearer token passed as apiKey
 *
 * Optional:
 *   LIVE_USER_AGENT              override user-agent header
 *
 * Usage:
 *   RUN_LIVE_ANTHROPIC_CACHE=1 \
 *   LIVE_BASE_URL=... LIVE_MODEL_ID=... LIVE_API_KEY=$(some-auth) \
 *     npx vitest --run cj/tests/openai-completions-anthropic-cache-live.test.ts
 */

import { describe, expect, it } from "vitest";
import { streamSimple } from "../../packages/ai/src/compat.ts";
import type { Message, Model } from "../../packages/ai/src/types.ts";

const LIVE = process.env.RUN_LIVE_ANTHROPIC_CACHE === "1";

describe.skipIf(!LIVE)("openai-completions anthropic cache_control (live)", () => {
	it("cacheRead > 0 on turn 2 through openai-completions gateway", async () => {
		const baseUrl = process.env.LIVE_BASE_URL;
		const modelId = process.env.LIVE_MODEL_ID;
		const apiKey = process.env.LIVE_API_KEY;
		if (!baseUrl) throw new Error("LIVE_BASE_URL env var required");
		if (!modelId) throw new Error("LIVE_MODEL_ID env var required");
		if (!apiKey) throw new Error("LIVE_API_KEY env var required");

		const model = {
			id: modelId,
			name: modelId,
			provider: "custom",
			api: "openai-completions",
			baseUrl,
			reasoning: false,
			contextWindow: 1_000_000,
			maxTokens: 4_000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			input: ["text"],
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
			headers: { "user-agent": process.env.LIVE_USER_AGENT ?? "pi-mono-cache-live-test" },
		} as unknown as Model<"openai-completions">;

		// Opus prompt cache minimum is ~1024 tokens; pad well above that.
		const bigSystem = "You are a helpful assistant. " + "lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(800);
		const turn1: Message[] = [{ role: "user", content: "Say hello in 3 words.", timestamp: Date.now() }];

		const r1 = await streamSimple(
			model,
			{ messages: turn1, systemPrompt: bigSystem },
			{
				apiKey,
				maxTokens: 50,
			} as unknown as Parameters<typeof streamSimple>[2],
		).result();

		expect(r1.usage.output).toBeGreaterThan(0);

		const assistantText = r1.content.find((c) => c.type === "text")?.text ?? "ok";
		const turn2: Message[] = [
			...turn1,
			{ role: "assistant", content: [{ type: "text", text: assistantText }], timestamp: Date.now() } as Message,
			{ role: "user", content: "Now say goodbye in 3 words.", timestamp: Date.now() },
		];

		const r2 = await streamSimple(
			model,
			{ messages: turn2, systemPrompt: bigSystem },
			{
				apiKey,
				maxTokens: 50,
			} as unknown as Parameters<typeof streamSimple>[2],
		).result();

		console.log("turn1 usage:", r1.usage);
		console.log("turn2 usage:", r2.usage);

		expect(r2.usage.cacheRead).toBeGreaterThan(0);
	}, 60_000);
});
