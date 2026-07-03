import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

describe("AgentSession model refusal handling", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("emits refusal_detected with the configured fallback and does not auto-switch", async () => {
		const harness = await createHarness({ settings: { refusalFallbackModel: "faux/faux-1" } });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "refused: not allowed", refused: true }),
		]);

		await harness.session.prompt("do the thing");

		const events = harness.eventsOfType("refusal_detected");
		expect(events.length).toBe(1);
		expect(events[0].errorMessage).toContain("refused");
		expect(events[0].fallbackModel).toBe("faux/faux-1");
		// Refusal alone must not consume a second model call (no silent retry).
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("does not treat ordinary errors as refusals", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "broken" })]);

		await harness.session.prompt("hi");

		expect(harness.eventsOfType("refusal_detected")).toEqual([]);
	});

	it("resumes the turn on a fallback model via retryAfterRefusal", async () => {
		const harness = await createHarness({ settings: { refusalFallbackModel: "faux/faux-1" } });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "refused", refused: true }),
			fauxAssistantMessage("recovered answer"),
		]);

		await harness.session.prompt("try");
		expect(harness.eventsOfType("refusal_detected").length).toBe(1);

		const fallback = harness.session.resolveModelPattern("faux/faux-1");
		expect(fallback).toBeTruthy();

		await harness.session.retryAfterRefusal(fallback!);

		expect(harness.faux.state.callCount).toBe(2);
		expect(getAssistantTexts(harness)).toContain("recovered answer");
	});

	it("resolveModelPattern returns undefined for an unknown pattern", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		expect(harness.session.resolveModelPattern("nope/does-not-exist")).toBeUndefined();
	});
});
