/**
 * Request-lifecycle text of the working spinner (waiting -> streaming -> retry countdown).
 *
 * The spinner lives in `InteractiveMode`, which the harness does not construct, so these
 * tests drive `InteractiveMode.prototype.handleEvent` with a stub `this` and feed it real
 * `AgentSession` events from the harness. Not covered here: actual `Loader` rendering,
 * terminal output, and escape/interrupt handling — those need a TUI-level test.
 */

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { createHarness, type Harness } from "./harness.ts";

interface SpinnerStub {
	messages: string[];
	workingMessage: string | undefined;
	workingPhaseMessage: string | undefined;
	retryPhaseCountdown: { dispose: () => void } | undefined;
	handle: (event: AgentSessionEvent) => Promise<void>;
	currentMessage: () => string;
}

function createSpinnerStub(): SpinnerStub {
	const messages: string[] = [];
	const prototype = InteractiveMode.prototype as unknown as {
		handleEvent(event: AgentSessionEvent): Promise<void>;
		setWorkingPhaseMessage(message: string | undefined): void;
		clearRetryPhaseCountdown(): void;
		waitingForResponseMessage(): string;
	};
	const currentWorkingMessage = Object.getOwnPropertyDescriptor(
		InteractiveMode.prototype,
		"currentWorkingMessage",
	)?.get;
	if (!currentWorkingMessage) throw new Error("currentWorkingMessage getter not found");

	// Partial stand-in for InteractiveMode internals; only the spinner-relevant members are real.
	const fakeThis: any = {
		isInitialized: true,
		footer: { invalidate: () => {} },
		settingsManager: {
			getShowTerminalProgress: () => false,
			getCodeBlockIndent: () => 0,
			getShowImages: () => false,
			getImageWidthCells: () => 0,
		},
		ui: { requestRender: () => {}, terminal: { setProgress: () => {} } },
		session: { isStreaming: true },
		sessionManager: { getCwd: () => "/tmp" },
		// Keeps `agent_start` off the WorkingStatusIndicator construction path (needs a real TUI).
		workingVisible: false,
		activeStatusIndicator: {
			kind: "working",
			setMessage: (message: string) => messages.push(message),
		},
		workingMessage: undefined,
		workingPhaseMessage: undefined,
		retryPhaseCountdown: undefined,
		defaultWorkingMessage: "Working...",
		hideThinkingBlock: false,
		hiddenThinkingLabel: "Thinking...",
		outputPad: 1,
		toolOutputExpanded: false,
		pendingTools: new Map(),
		streamingComponent: undefined,
		streamingMessage: undefined,
		chatContainer: { addChild: () => {}, removeChild: () => {}, children: [] },
		retryEscapeHandler: undefined,
		defaultEditor: { onEscape: undefined },
		clearStatusIndicator: () => {},
		showStatusIndicator: () => {},
		updatePendingMessagesDisplay: () => {},
		updateTerminalTitle: () => {},
		addMessageToChat: () => {},
		addCustomEntryToChat: () => {},
		updateEditorBorderColor: () => {},
		checkShutdownRequested: async () => {},
		maybeShowCacheMissNotice: () => {},
		maybeShowAssistantDiagnostics: () => {},
		getMarkdownThemeWithSettings: () => getMarkdownTheme(),
		getMarkdownTransformers: () => [],
		getRegisteredToolDefinition: () => undefined,
		setWorkingPhaseMessage: (message: string | undefined) => prototype.setWorkingPhaseMessage.call(fakeThis, message),
		clearRetryPhaseCountdown: () => prototype.clearRetryPhaseCountdown.call(fakeThis),
		waitingForResponseMessage: () => prototype.waitingForResponseMessage.call(fakeThis),
	};

	return {
		messages,
		get workingMessage() {
			return fakeThis.workingMessage;
		},
		set workingMessage(message: string | undefined) {
			fakeThis.workingMessage = message;
		},
		get workingPhaseMessage() {
			return fakeThis.workingPhaseMessage;
		},
		get retryPhaseCountdown() {
			return fakeThis.retryPhaseCountdown;
		},
		handle: (event) => prototype.handleEvent.call(fakeThis, event),
		currentMessage: () => currentWorkingMessage.call(fakeThis) as string,
	};
}

describe("working spinner request phases", () => {
	const harnesses: Harness[] = [];

	beforeAll(() => {
		initTheme("dark");
	});

	afterEach(() => {
		vi.useRealTimers();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("shows waiting text until the first assistant message, then streaming text", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const spinner = createSpinnerStub();
		const phaseAtEvent: string[] = [];
		harness.session.subscribe(async (event) => {
			await spinner.handle(event);
			if (event.type === "agent_start" || (event.type === "message_start" && event.message.role === "assistant")) {
				phaseAtEvent.push(`${event.type}:${spinner.currentMessage()}`);
			}
		});

		harness.setResponses([fauxAssistantMessage("hello")]);
		await harness.session.prompt("test");

		expect(phaseAtEvent[0]).toMatch(/^agent_start:Waiting for response\.\.\./);
		expect(phaseAtEvent[1]).toMatch(/^message_start:Working\.\.\./);
		// agent_end clears the phase text back to the default.
		expect(spinner.workingPhaseMessage).toBeUndefined();
		expect(spinner.currentMessage()).toBe("Working...");
	});

	it("flips to streaming text for providers that emit no message_update", async () => {
		const spinner = createSpinnerStub();

		await spinner.handle({ type: "agent_start" } as AgentSessionEvent);
		expect(spinner.currentMessage()).toMatch(/^Waiting for response\.\.\./);

		await spinner.handle({
			type: "message_start",
			message: { ...fauxAssistantMessage("done"), role: "assistant" },
		} as AgentSessionEvent);

		expect(spinner.currentMessage()).toMatch(/^Working\.\.\./);
	});

	it("counts down a provider retry and tears the countdown down on agent_end", async () => {
		vi.useFakeTimers();
		const spinner = createSpinnerStub();

		await spinner.handle({ type: "agent_start" } as AgentSessionEvent);
		await spinner.handle({
			type: "retry",
			attempt: 1,
			maxRetries: 5,
			delayMs: 3000,
			errorMessage: "429 overloaded",
		} as AgentSessionEvent);

		expect(spinner.currentMessage()).toContain("Retrying (1/5) in 3s (429 overloaded)");
		expect(spinner.retryPhaseCountdown).toBeDefined();

		await vi.advanceTimersByTimeAsync(1000);
		expect(spinner.currentMessage()).toContain("Retrying (1/5) in 2s");

		await spinner.handle({ type: "agent_end" } as AgentSessionEvent);
		expect(spinner.retryPhaseCountdown).toBeUndefined();
		expect(spinner.workingPhaseMessage).toBeUndefined();

		// The disposed countdown must not keep writing spinner text.
		const messageCount = spinner.messages.length;
		await vi.advanceTimersByTimeAsync(5000);
		expect(spinner.messages.length).toBe(messageCount);
	});

	it("keeps an extension-set working message ahead of phase text", async () => {
		const spinner = createSpinnerStub();
		spinner.workingMessage = "Extension busy...";

		await spinner.handle({ type: "agent_start" } as AgentSessionEvent);
		await spinner.handle({
			type: "retry",
			attempt: 2,
			maxRetries: 3,
			delayMs: 1000,
			errorMessage: "500 boom",
		} as AgentSessionEvent);

		expect(spinner.currentMessage()).toBe("Extension busy...");
		expect(spinner.messages).toEqual([]);
		expect(spinner.workingPhaseMessage).toContain("Retrying (2/3)");
	});
});
