/**
 * Request-lifecycle text of the working spinner (waiting -> streaming -> retry countdown).
 *
 * Tests `WorkingSpinnerPhases` directly, fed either real `AgentSession` events from the
 * harness or hand-built events. `InteractiveMode` is deliberately not involved: its only
 * job is to forward session events here and push the resulting text into the status
 * indicator. Not covered: that wiring, `Loader` rendering, and escape/interrupt handling.
 */

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import { keyText } from "../../src/modes/interactive/components/keybinding-hints.ts";
import { truncateRetryError, WorkingSpinnerPhases } from "../../src/modes/interactive/working-spinner-phases.ts";
import { createHarness, type Harness } from "./harness.ts";

const HINT = `(${keyText("app.interrupt")} to interrupt)`;
const WAITING = `Waiting for response... ${HINT}`;
const STREAMING = `Working... ${HINT}`;
const DEFAULT = "Working...";

function createSpinner() {
	const state: { extensionMessage: string | undefined } = { extensionMessage: undefined };
	/** Every text the spinner was told to show, in order. */
	const shown: string[] = [];
	const phases = new WorkingSpinnerPhases({
		defaultMessage: DEFAULT,
		getTui: () => undefined,
		getExtensionMessage: () => state.extensionMessage,
		onMessageChange: (message) => shown.push(message),
	});
	return { state, shown, phases };
}

const agentStart: AgentSessionEvent = { type: "agent_start" };
const turnStart: AgentSessionEvent = { type: "turn_start" };
const agentEnd: AgentSessionEvent = { type: "agent_end", messages: [], willRetry: false };
const assistantStart: AgentSessionEvent = { type: "message_start", message: fauxAssistantMessage("done") };

function retry(attempt: number, maxRetries: number, delayMs: number, errorMessage: string): AgentSessionEvent {
	return { type: "retry", attempt, maxRetries, delayMs, errorMessage };
}

describe("working spinner request phases", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.useRealTimers();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("shows waiting text until the first assistant message, then streaming text, then the default", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const { shown, phases } = createSpinner();
		harness.session.subscribe((event) => phases.handleEvent(event));

		harness.setResponses([fauxAssistantMessage("hello")]);
		await harness.session.prompt("test");

		// agent_start and turn_start both (re)set the waiting text.
		expect(shown).toEqual([WAITING, WAITING, STREAMING, DEFAULT]);
		expect(phases.currentMessage).toBe(DEFAULT);
	});

	it("shows a provider retry between waiting and streaming for a real session", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const { shown, phases } = createSpinner();
		harness.session.subscribe((event) => phases.handleEvent(event));

		harness.setResponses([
			(_context, options) => {
				options?.onRetry?.({ attempt: 1, maxRetries: 5, delayMs: 4000, error: new Error("overloaded_error") });
				return fauxAssistantMessage("recovered");
			},
		]);
		await harness.session.prompt("test");

		expect(shown).toEqual([WAITING, WAITING, `Retrying (1/5) in 4s (overloaded_error) ${HINT}`, STREAMING, DEFAULT]);
	});

	it("flips to streaming text on assistant message_start alone (providers that emit no message_update)", () => {
		const { phases } = createSpinner();

		phases.handleEvent(agentStart);
		expect(phases.currentMessage).toBe(WAITING);

		phases.handleEvent({
			type: "message_start",
			message: { role: "user", content: "hi", timestamp: 0 },
		});
		expect(phases.currentMessage).toBe(WAITING);

		phases.handleEvent(assistantStart);
		expect(phases.currentMessage).toBe(STREAMING);
	});

	it("resets to waiting text on turn_start", () => {
		const { phases } = createSpinner();

		phases.handleEvent(agentStart);
		phases.handleEvent(assistantStart);
		expect(phases.currentMessage).toBe(STREAMING);

		phases.handleEvent(turnStart);
		expect(phases.currentMessage).toBe(WAITING);
	});

	it("counts down a provider retry and tears the countdown down on agent_end", () => {
		vi.useFakeTimers();
		const { shown, phases } = createSpinner();

		phases.handleEvent(agentStart);
		phases.handleEvent(retry(1, 5, 3000, "429 overloaded"));
		expect(phases.currentMessage).toBe(`Retrying (1/5) in 3s (429 overloaded) ${HINT}`);

		vi.advanceTimersByTime(1000);
		expect(phases.currentMessage).toBe(`Retrying (1/5) in 2s (429 overloaded) ${HINT}`);

		phases.handleEvent(agentEnd);
		expect(phases.currentMessage).toBe(DEFAULT);

		// The disposed countdown must not keep writing spinner text.
		const shownCount = shown.length;
		vi.advanceTimersByTime(5000);
		expect(shown.length).toBe(shownCount);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("returns to waiting text when the retry countdown expires", () => {
		vi.useFakeTimers();
		const { phases } = createSpinner();

		phases.handleEvent(retry(1, 5, 2000, "boom"));
		vi.advanceTimersByTime(2000);

		expect(phases.currentMessage).toBe(WAITING);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		["turn_start", turnStart, WAITING],
		["assistant message_start", assistantStart, STREAMING],
		["a newer retry", retry(2, 5, 9000, "again"), `Retrying (2/5) in 9s (again) ${HINT}`],
	])("stops a running retry countdown on %s", (_name, event, expected) => {
		vi.useFakeTimers();
		const { phases } = createSpinner();

		phases.handleEvent(retry(1, 5, 3000, "boom"));
		phases.handleEvent(event);
		expect(phases.currentMessage).toBe(expected);

		// The first countdown would have rewritten the text after 1s if still running.
		vi.advanceTimersByTime(999);
		expect(phases.currentMessage).toBe(expected);
	});

	it("dispose stops the countdown without touching the text", () => {
		vi.useFakeTimers();
		const { shown, phases } = createSpinner();

		phases.handleEvent(retry(1, 5, 3000, "boom"));
		phases.dispose();
		vi.advanceTimersByTime(5000);

		expect(shown).toEqual([`Retrying (1/5) in 3s (boom) ${HINT}`]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps an extension-set working message ahead of phase text", () => {
		vi.useFakeTimers();
		const { state, shown, phases } = createSpinner();
		state.extensionMessage = "Extension busy...";

		phases.handleEvent(agentStart);
		phases.handleEvent(retry(2, 3, 1000, "500 boom"));

		expect(phases.currentMessage).toBe("Extension busy...");
		expect(shown).toEqual([]);

		// The phase kept tracking underneath and shows once the extension message is cleared.
		state.extensionMessage = undefined;
		expect(phases.currentMessage).toBe(`Retrying (2/3) in 1s (500 boom) ${HINT}`);
	});

	it("collapses whitespace and truncates long retry reasons to 60 characters", () => {
		expect(truncateRetryError("  rate\n limited \t now ")).toBe("rate limited now");
		expect(truncateRetryError("x".repeat(60))).toBe("x".repeat(60));
		expect(truncateRetryError("x".repeat(61))).toBe(`${"x".repeat(59)}…`);
	});
});
