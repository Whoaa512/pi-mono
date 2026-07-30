/**
 * Central timing instrumentation for startup profiling.
 * Enable with PI_TIMING=1 environment variable.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";

const ENABLED = process.env.PI_TIMING === "1";
interface TimingNamespace {
	timings: Array<{ label: string; ms: number }>;
	lastTime: number;
}

type TimingLabel = "main" | "extensions";

const timingNamespaces = new Map<TimingLabel, TimingNamespace>();

export function resetTimings(namespace: TimingLabel = "main"): void {
	if (!ENABLED) return;
	timingNamespaces.set(namespace, { timings: [], lastTime: Date.now() });
}

export function time(label: string, namespace: TimingLabel = "main"): void {
	if (!ENABLED) return;
	const now = Date.now();

	if (!timingNamespaces.has(namespace)) {
		resetTimings(namespace);
	}

	const timingNamespace = timingNamespaces.get(namespace)!;
	timingNamespace.timings.push({ label, ms: now - timingNamespace.lastTime });
	timingNamespace.lastTime = now;
}

function printTimingGroup(title: string, timings: TimingNamespace["timings"]): void {
	const printableTimings = timings.filter((timing) => timing.ms >= 0);
	if (printableTimings.length === 0) return;
	console.error(`\n--- ${title} ---`);
	for (const t of printableTimings) {
		console.error(`  ${t.label}: ${t.ms}ms`);
	}
	console.error(`  TOTAL: ${printableTimings.reduce((a, b) => a + b.ms, 0)}ms`);
	console.error(`${"-".repeat(title.length + 8)}\n`);
}

export function printTimings(): void {
	if (!ENABLED) return;
	for (const [namespace, timingNamespace] of timingNamespaces) {
		printTimingGroup(`Startup Timings: ${namespace}`, timingNamespace.timings);
	}
}

/**
 * File-backed timing sections for in-TUI operations (e.g. /new) where
 * stderr output is not visible. Appends to <agentDir>/timings.log.
 * markTiming() is a no-op unless a section is active, so instrumented
 * code paths cost nothing during normal startup.
 */
let activeSection: { title: string; lines: string[]; start: number; last: number } | null = null;

export function beginTimingSection(title: string): void {
	if (!ENABLED) return;
	const now = performance.now();
	activeSection = { title, lines: [], start: now, last: now };
}

export function markTiming(label: string): void {
	if (!activeSection) return;
	const now = performance.now();
	activeSection.lines.push(`  ${label}: ${(now - activeSection.last).toFixed(1)}ms`);
	activeSection.last = now;
}

export function endTimingSection(): void {
	if (!activeSection) return;
	const total = performance.now() - activeSection.start;
	const agentDir = getAgentDir();
	mkdirSync(agentDir, { recursive: true });
	appendFileSync(
		join(agentDir, "timings.log"),
		[
			`=== ${activeSection.title} @ ${new Date().toISOString()} ===`,
			...activeSection.lines,
			`  TOTAL: ${total.toFixed(1)}ms`,
			"",
		].join("\n"),
	);
	activeSection = null;
}
