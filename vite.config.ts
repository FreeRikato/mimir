import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import manifest from "./manifest.json" with { type: "json" };

// https://vite.dev/config/
export default defineConfig({
	base: "./",
	plugins: [
		crx({ manifest }),
		tailwindcss(),
		react({
			babel: {
				plugins: [["babel-plugin-react-compiler"]],
			},
		}),
		{
			name: "copy-pdfjs-worker",
			generateBundle() {
				// Emit the PDF.js worker as a static asset so it can be served
				// from the extension's own origin (required by CSP for worker scripts)
				const workerPath = resolve(
					__dirname,
					"node_modules/pdfjs-dist/build/pdf.worker.mjs",
				);
				this.emitFile({
					type: "asset",
					fileName: "assets/pdf.worker.mjs",
					source: readFileSync(workerPath),
				});
			},
		},
	],
});
