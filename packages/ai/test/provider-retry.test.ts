import { afterEach, describe, expect, it, vi } from "vitest";
import { retryProviderRequest } from "../src/utils/provider-retry.ts";

function providerError(status: number | undefined, headers?: Record<string, string>): Error {
	return Object.assign(new Error(`Provider error: ${status}`), {
		status,
		headers: new Headers(headers),
	});
}

describe("provider request retries", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries retryable provider errors", async () => {
		vi.useFakeTimers();
		const request = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(providerError(429, { "retry-after-ms": "1000" }))
			.mockResolvedValue("ok");

		const result = retryProviderRequest(request, { maxRetries: 1 });
		await vi.advanceTimersByTimeAsync(999);
		expect(request).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);

		await expect(result).resolves.toBe("ok");
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("does not retry errors the provider marks as non-retryable", async () => {
		const error = providerError(429, { "x-should-retry": "false" });
		const request = vi.fn<() => Promise<string>>().mockRejectedValue(error);

		await expect(retryProviderRequest(request, { maxRetries: 2 })).rejects.toBe(error);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("rejects a provider-requested retry delay above the limit", async () => {
		const request = vi.fn<() => Promise<string>>().mockRejectedValue(providerError(429, { "retry-after": "277403" }));

		await expect(retryProviderRequest(request, { maxRetries: 1, maxRetryDelayMs: 1000 })).rejects.toThrow(
			"Server requested 277403s retry delay (max: 1s)",
		);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("allows disabling the provider-requested retry delay cap", async () => {
		vi.useFakeTimers();
		const request = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(providerError(429, { "retry-after": "2" }))
			.mockResolvedValue("ok");

		const result = retryProviderRequest(request, { maxRetries: 1, maxRetryDelayMs: 0 });
		await vi.advanceTimersByTimeAsync(1999);
		expect(request).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);

		await expect(result).resolves.toBe("ok");
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("reports each retry to onRetry before sleeping", async () => {
		vi.useFakeTimers();
		const error = providerError(429, { "retry-after-ms": "1000" });
		const request = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(error)
			.mockRejectedValueOnce(error)
			.mockResolvedValue("ok");
		const onRetry = vi.fn();

		const result = retryProviderRequest(request, { maxRetries: 3, onRetry });
		await vi.advanceTimersByTimeAsync(0);
		expect(onRetry).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(2000);

		await expect(result).resolves.toBe("ok");
		expect(onRetry.mock.calls.map(([info]) => info)).toEqual([
			{ attempt: 1, maxRetries: 3, delayMs: 1000, error },
			{ attempt: 2, maxRetries: 3, delayMs: 1000, error },
		]);
	});

	it("does not call onRetry on success or for non-retryable errors", async () => {
		const onRetry = vi.fn();
		await expect(retryProviderRequest(async () => "ok", { maxRetries: 2, onRetry })).resolves.toBe("ok");

		const error = providerError(400);
		await expect(retryProviderRequest(async () => Promise.reject(error), { maxRetries: 2, onRetry })).rejects.toBe(
			error,
		);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("awaits an async onRetry before starting the backoff sleep", async () => {
		vi.useFakeTimers();
		const request = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(providerError(429, { "retry-after-ms": "1000" }))
			.mockResolvedValue("ok");
		let observerSettled = false;
		let releaseObserver = () => {};
		const observerGate = new Promise<void>((resolve) => {
			releaseObserver = resolve;
		});

		const result = retryProviderRequest(request, {
			maxRetries: 1,
			onRetry: async () => {
				await observerGate;
				observerSettled = true;
			},
		});

		await vi.advanceTimersByTimeAsync(5000);
		expect(observerSettled).toBe(false);
		expect(request).toHaveBeenCalledTimes(1);

		releaseObserver();
		await vi.advanceTimersByTimeAsync(1000);

		await expect(result).resolves.toBe("ok");
		expect(observerSettled).toBe(true);
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("keeps retrying when onRetry throws or rejects", async () => {
		vi.useFakeTimers();
		const request = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(providerError(429, { "retry-after-ms": "1000" }))
			.mockResolvedValue("ok");

		const result = retryProviderRequest(request, {
			maxRetries: 1,
			onRetry: () => {
				throw new Error("observer exploded");
			},
		});
		await vi.advanceTimersByTimeAsync(1000);

		await expect(result).resolves.toBe("ok");
		expect(request).toHaveBeenCalledTimes(2);

		const asyncRequest = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(providerError(429, { "retry-after-ms": "1000" }))
			.mockResolvedValue("ok");
		const asyncResult = retryProviderRequest(asyncRequest, {
			maxRetries: 1,
			onRetry: async () => {
				throw new Error("observer rejected");
			},
		});
		await vi.advanceTimersByTimeAsync(1000);

		await expect(asyncResult).resolves.toBe("ok");
		expect(asyncRequest).toHaveBeenCalledTimes(2);
	});

	it("aborts a provider-requested retry delay", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const request = vi.fn<() => Promise<string>>().mockRejectedValue(providerError(429, { "retry-after": "277403" }));

		const result = retryProviderRequest(request, { maxRetries: 2, maxRetryDelayMs: 0, signal: controller.signal });
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);

		controller.abort();

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(request).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
