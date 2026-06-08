import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
		globals: false,
	},
	esbuild: {
		target: "es2022",
	},
});
