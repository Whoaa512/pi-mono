/**
 * Live integration test for Anthropic cache_control injection via devai gateway.
 *
 * Validates that opus routed through devai actually returns cacheRead > 0 on
 * turn 2. Gated by RUN_DEVAI_LIVE=1 because it hits the real gateway and
 * requires IAP auth.
 *
 * Usage:
 *   RUN_DEVAI_LIVE=1 IAP_TOKEN=$(iap-auth https://devaigateway.a.musta.ch) \
 *     npx vitest --run cj/tests/devai-anthropic-cache-live.test.ts
 */

import { describe, expect, it } from "vitest";
import { streamSimple } from "../../packages/ai/src/stream.js";
import type { Message, Model } from "../../packages/ai/src/types.js";

const LIVE = process.env.RUN_DEVAI_LIVE === "1";

describe.skipIf(!LIVE)("devai anthropic cache_control (live)", () => {
	it("cacheRead > 0 on turn 2 against claude opus via devai", async () => {
		const iap = process.env.IAP_TOKEN;
		if (!iap) throw new Error("IAP_TOKEN env var required");

		const model = {
			id: "global.anthropic.claude-opus-4-7",
			name: "claude-opus-4.7",
			provider: "devai",
			api: "openai-completions",
			baseUrl: "https://devaigateway.a.musta.ch/v1",
			reasoning: false,
			contextWindow: 1_000_000,
			maxTokens: 4_000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
			headers: { "user-agent": "pi-mono-cache-live-test" },
		} as unknown as Model<"openai-completions">;

		const bigSystem = "You are a helpful assistant. " + "lorem ipsum ".repeat(500);
		const turn1: Message[] = [{ role: "user", content: "Say hello in 3 words.", timestamp: Date.now() }];

		const r1 = await streamSimple(
			model,
			{ messages: turn1, systemPrompt: bigSystem },
			{
				apiKey: iap,
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
				apiKey: iap,
				maxTokens: 50,
			} as unknown as Parameters<typeof streamSimple>[2],
		).result();

		console.log("turn1 usage:", r1.usage);
		console.log("turn2 usage:", r2.usage);

		expect(r2.usage.cacheRead).toBeGreaterThan(0);
	}, 60_000);
});
