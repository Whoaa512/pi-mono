import { Type } from "@sinclair/typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.js";
import { streamSimple } from "../src/stream.js";
import type { Message, Tool } from "../src/types.js";

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: async (params: unknown) => {
					mockState.lastParams = params;
					return {
						async *[Symbol.asyncIterator]() {
							yield {
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

type Breakpointed = { cache_control?: { type: string } };

function findCacheControl(content: unknown): boolean {
	if (typeof content === "string") return false;
	if (!Array.isArray(content)) return false;
	return content.some((part) => (part as Breakpointed)?.cache_control?.type === "ephemeral");
}

function runStream(model: unknown, context: { messages: Message[]; systemPrompt?: string; tools?: Tool[] }) {
	return streamSimple(
		model as Parameters<typeof streamSimple>[0],
		context as Parameters<typeof streamSimple>[1],
		{ apiKey: "test" } as unknown as Parameters<typeof streamSimple>[2],
	).result();
}

function anthropicLikeModel(id: string, compat?: Record<string, unknown>) {
	const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
	return {
		...baseModel,
		api: "openai-completions",
		id,
		provider: "devai",
		baseUrl: "https://devaigateway.example.com/v1",
		...(compat ? { compat } : {}),
	} as const;
}

describe("openai-completions Anthropic cache_control", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
	});

	it("injects cache_control on system, last tool, and last two user messages for anthropic-id models", async () => {
		const tools: Tool[] = [
			{ name: "ping", description: "ping", parameters: Type.Object({ ok: Type.Boolean() }) },
			{ name: "pong", description: "pong", parameters: Type.Object({ ok: Type.Boolean() }) },
		];
		const messages: Message[] = [
			{ role: "user", content: "first", timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 2 } as Message,
			{ role: "user", content: "second", timestamp: 3 },
			{ role: "assistant", content: [{ type: "text", text: "ok2" }], timestamp: 4 } as Message,
			{ role: "user", content: "third", timestamp: 5 },
		];

		await runStream(anthropicLikeModel("global.anthropic.claude-opus-4-7"), {
			messages,
			systemPrompt: "you are a helpful assistant",
			tools,
		});

		const params = mockState.lastParams as {
			messages: Array<{ role: string; content: unknown }>;
			tools?: Array<Breakpointed>;
		};

		expect(params.messages[0].role).toBe("system");
		expect(findCacheControl(params.messages[0].content)).toBe(true);

		expect(params.tools?.length).toBe(2);
		expect(params.tools?.[0].cache_control).toBeUndefined();
		expect(params.tools?.[1].cache_control).toEqual({ type: "ephemeral" });

		const userMsgs = params.messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(3);
		expect(findCacheControl(userMsgs[0].content)).toBe(false);
		expect(findCacheControl(userMsgs[1].content)).toBe(true);
		expect(findCacheControl(userMsgs[2].content)).toBe(true);
	});

	it("also triggers on claude id without anthropic prefix", async () => {
		await runStream(anthropicLikeModel("claude-opus-4-7"), {
			messages: [{ role: "user", content: "hi", timestamp: 1 }],
			systemPrompt: "sys",
		});
		const params = mockState.lastParams as { messages: Array<{ role: string; content: unknown }> };
		expect(findCacheControl(params.messages[0].content)).toBe(true);
	});

	it("does not inject cache_control for non-anthropic model ids", async () => {
		await runStream(anthropicLikeModel("gpt-5-mini"), {
			messages: [{ role: "user", content: "hi", timestamp: 1 }],
			systemPrompt: "sys",
		});
		const params = mockState.lastParams as { messages: Array<{ role: string; content: unknown }> };
		expect(findCacheControl(params.messages[0].content)).toBe(false);
		expect(findCacheControl(params.messages[1].content)).toBe(false);
	});

	it("respects compat.disableAnthropicCacheControl opt-out", async () => {
		await runStream(anthropicLikeModel("global.anthropic.claude-opus-4-7", { disableAnthropicCacheControl: true }), {
			messages: [{ role: "user", content: "hi", timestamp: 1 }],
			systemPrompt: "sys",
		});
		const params = mockState.lastParams as { messages: Array<{ role: string; content: unknown }> };
		expect(findCacheControl(params.messages[0].content)).toBe(false);
		expect(findCacheControl(params.messages[1].content)).toBe(false);
	});
});
