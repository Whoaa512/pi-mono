import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages.js";
import type { AssistantMessage, Message, Model, ToolCall, ToolResultMessage } from "../src/types.js";

function makeModel(): Model<"openai-completions"> {
	return {
		id: "mock-model",
		name: "Mock",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

function makeAssistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "openai",
		model: "mock-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

describe("transformMessages filters malformed toolCall blocks", () => {
	it("drops toolCall with empty id and name", () => {
		const messages: Message[] = [
			{ role: "user", content: "do something", timestamp: Date.now() },
			makeAssistant([
				{ type: "text", text: "Let me help" },
				{ type: "toolCall", id: "valid-1", name: "write", arguments: { path: "a.txt", content: "hi" } },
				{ type: "toolCall", id: "", name: "", arguments: {} },
			]),
			{
				role: "toolResult",
				toolCallId: "valid-1",
				toolName: "write",
				content: [{ type: "text", text: "ok" }],
				isError: false,
				timestamp: Date.now(),
			} as ToolResultMessage,
			{
				role: "toolResult",
				toolCallId: "",
				toolName: "",
				content: [{ type: "text", text: "Tool  not found" }],
				isError: true,
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		const result = transformMessages(messages, makeModel());

		const assistant = result.find((m) => m.role === "assistant") as AssistantMessage;
		const toolCalls = assistant.content.filter((b) => b.type === "toolCall") as ToolCall[];
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].id).toBe("valid-1");
	});

	it("drops toolCall with empty name but non-empty id", () => {
		const messages: Message[] = [
			{ role: "user", content: "test", timestamp: Date.now() },
			makeAssistant([
				{ type: "toolCall", id: "some-id", name: "", arguments: {} },
				{ type: "toolCall", id: "valid-1", name: "read", arguments: { path: "b.txt" } },
			]),
		];

		const result = transformMessages(messages, makeModel());
		const assistant = result.find((m) => m.role === "assistant") as AssistantMessage;
		const toolCalls = assistant.content.filter((b) => b.type === "toolCall") as ToolCall[];
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].name).toBe("read");
	});

	it("drops toolCall with empty id but non-empty name", () => {
		const messages: Message[] = [
			{ role: "user", content: "test", timestamp: Date.now() },
			makeAssistant([
				{ type: "toolCall", id: "", name: "write", arguments: {} },
				{ type: "toolCall", id: "valid-1", name: "read", arguments: { path: "b.txt" } },
			]),
		];

		const result = transformMessages(messages, makeModel());
		const assistant = result.find((m) => m.role === "assistant") as AssistantMessage;
		const toolCalls = assistant.content.filter((b) => b.type === "toolCall") as ToolCall[];
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].id).toBe("valid-1");
	});

	it("keeps all valid toolCalls", () => {
		const messages: Message[] = [
			{ role: "user", content: "test", timestamp: Date.now() },
			makeAssistant([
				{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a" } },
				{ type: "toolCall", id: "t2", name: "write", arguments: { path: "b", content: "c" } },
			]),
		];

		const result = transformMessages(messages, makeModel());
		const assistant = result.find((m) => m.role === "assistant") as AssistantMessage;
		const toolCalls = assistant.content.filter((b) => b.type === "toolCall") as ToolCall[];
		expect(toolCalls).toHaveLength(2);
	});
});
