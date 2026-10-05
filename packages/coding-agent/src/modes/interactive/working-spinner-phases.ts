/**
 * Fork-owned: request-lifecycle text for the working spinner
 * (waiting for response -> streaming -> provider retry countdown).
 *
 * Kept out of interactive-mode.ts so the fork's merge surface there stays small and the
 * logic can be tested without constructing InteractiveMode.
 */

import type { TUI } from "@earendil-works/pi-tui";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import { CountdownTimer } from "./components/countdown-timer.ts";
import { keyText } from "./components/keybinding-hints.ts";

const MAX_RETRY_REASON_LENGTH = 60;

export function truncateRetryError(message: string): string {
	const singleLine = message.replace(/\s+/g, " ").trim();
	if (singleLine.length <= MAX_RETRY_REASON_LENGTH) {
		return singleLine;
	}
	return `${singleLine.slice(0, MAX_RETRY_REASON_LENGTH - 1)}…`;
}

export interface WorkingSpinnerPhasesOptions {
	defaultMessage: string;
	/** Rendered on every countdown tick. Lazy because the owner may not have a TUI yet. */
	getTui: () => TUI | undefined;
	/** Extension-set working message. Always wins over phase text. */
	getExtensionMessage: () => string | undefined;
	/** Called when the visible spinner text changed. Not called while an extension message is set. */
	onMessageChange: (message: string) => void;
}

export class WorkingSpinnerPhases {
	private readonly options: WorkingSpinnerPhasesOptions;
	private phaseMessage: string | undefined = undefined;
	private retryCountdown: CountdownTimer | undefined = undefined;

	constructor(options: WorkingSpinnerPhasesOptions) {
		this.options = options;
	}

	/** Spinner text: an extension-set message wins, then the request-lifecycle phase, then the default. */
	get currentMessage(): string {
		return this.options.getExtensionMessage() ?? this.phaseMessage ?? this.options.defaultMessage;
	}

	handleEvent(event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
			case "turn_start":
				// A new provider request starts; nothing has been received yet.
				this.dispose();
				this.setPhaseMessage(this.waitingMessage());
				break;

			case "message_start":
				if (event.message.role !== "assistant") break;
				// First provider bytes arrived; the request is no longer pending. Providers that
				// emit only `done` never produce a `message_update`, so the flip lives here.
				this.dispose();
				this.setPhaseMessage(`${this.options.defaultMessage} (${keyText("app.interrupt")} to interrupt)`);
				break;

			case "retry": {
				const reason = truncateRetryError(event.errorMessage);
				this.dispose();
				// Deliberately shown on the working spinner instead of `RetryStatusIndicator`: that
				// indicator covers harness-level retries of a whole operation, while this is an
				// intra-request retry inside a still-active provider call. Copy style is kept aligned.
				this.retryCountdown = new CountdownTimer(
					event.delayMs,
					this.options.getTui(),
					(seconds) => {
						this.setPhaseMessage(
							`Retrying (${event.attempt}/${event.maxRetries}) in ${seconds}s (${reason}) (${keyText("app.interrupt")} to interrupt)`,
						);
					},
					() => {
						this.retryCountdown = undefined;
						this.setPhaseMessage(this.waitingMessage());
					},
				);
				break;
			}

			case "agent_end":
				this.dispose();
				this.setPhaseMessage(undefined);
				break;
		}
	}

	/** Stops a running retry countdown. Phase text is left as is. */
	dispose(): void {
		this.retryCountdown?.dispose();
		this.retryCountdown = undefined;
	}

	private waitingMessage(): string {
		return `Waiting for response... (${keyText("app.interrupt")} to interrupt)`;
	}

	private setPhaseMessage(message: string | undefined): void {
		this.phaseMessage = message;
		if (this.options.getExtensionMessage() !== undefined) return;
		this.options.onMessageChange(this.currentMessage);
	}
}
