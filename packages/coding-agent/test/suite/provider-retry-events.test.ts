import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

describe("provider retry events", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("forwards provider retry callbacks as retry session events", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([
			(_context, options) => {
				options?.onRetry?.({ attempt: 1, maxRetries: 5, delayMs: 4000, error: new Error("overloaded_error") });
				return fauxAssistantMessage("recovered");
			},
		]);

		await harness.session.prompt("test");

		expect(harness.eventsOfType("retry")).toEqual([
			{ type: "retry", attempt: 1, maxRetries: 5, delayMs: 4000, errorMessage: "overloaded_error" },
		]);
	});

	it("emits no retry events when the provider does not retry", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("test");

		expect(harness.eventsOfType("retry")).toEqual([]);
	});
});
