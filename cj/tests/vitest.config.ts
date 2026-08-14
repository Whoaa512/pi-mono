import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@earendil-works\/pi-coding-agent$/,
				replacement: resolve(__dirname, "../../packages/coding-agent/src/index.ts"),
			},
			{ find: /^@earendil-works\/pi-tui$/, replacement: resolve(__dirname, "../../packages/tui/src/index.ts") },
			{ find: /^@earendil-works\/pi-ai$/, replacement: resolve(__dirname, "../../packages/ai/src/index.ts") },
		],
	},
	test: {
		globals: true,
		environment: "node",
		testTimeout: 15000,
	},
});
