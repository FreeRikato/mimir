// Manual QA harness for bug 1.1 (background catch-all drops message channel).
// Loads the production src/background/index.ts, transpiles via the project's
// own typescript dep, and runs it in an isolated VM context with a mocked
// chrome.* surface. Asserts the listener contract.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backgroundPath = resolve(__dirname, "..", "src", "background", "index.ts");

const sentResponses = [];
const installedListeners = [];

const fakeChrome = {
	runtime: {
		onMessage: {
			addListener: (cb) => installedListeners.push(cb),
		},
		onInstalled: { addListener: () => {} },
		sendMessage: () => Promise.resolve(),
		lastError: undefined,
	},
	sidePanel: { setPanelBehavior: () => {} },
	commands: { onCommand: { addListener: () => {} } },
};

const source = readFileSync(backgroundPath, "utf-8");
const transpiled = ts.transpileModule(source, {
	compilerOptions: {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.CommonJS,
	},
}).outputText;

// Provide the globals the background module uses. In an actual service worker
// these come from the chrome.* / browser.* environment, not from Node.
const sandboxGlobals = {
	AbortController,
	AbortSignal,
	atob: globalThis.atob,
	btoa: globalThis.btoa,
	clearTimeout,
	setTimeout,
	clearInterval,
	setInterval,
	console,
	crypto: globalThis.crypto,
	fetch: globalThis.fetch,
	performance: globalThis.performance,
	queueMicrotask,
	TextEncoder,
	TextDecoder,
	URL,
	URLSearchParams,
	structuredClone: globalThis.structuredClone,
};
const context = vm.createContext({ chrome: fakeChrome, ...sandboxGlobals, module: { exports: {} }, exports: {} });
vm.runInContext(transpiled, context, { filename: "background/index.ts" });

if (installedListeners.length !== 1) {
	console.error(`FAIL: expected 1 registered listener, got ${installedListeners.length}`);
	process.exit(1);
}

const listener = installedListeners[0];

const ret1 = listener({ type: "FETCH_SUBTITLES", url: "http://x", format: "json" }, null, (r) => sentResponses.push(r));
if (ret1 !== true) {
	console.error(`FAIL: FETCH_SUBTITLES should return true, got ${ret1}`);
	process.exit(1);
}
console.log("[scenario 1.1] FETCH_SUBTITLES returns true ✓");

const ret2 = listener({ type: "REALLY_NEW_TYPE_FROM_THE_FUTURE", payload: 1 }, null, (r) => sentResponses.push(r));
if (ret2 !== undefined) {
	console.error(`FAIL: unknown type should return undefined, got ${ret2}`);
	process.exit(1);
}
if (sentResponses.length > 0) {
	console.error(`FAIL: sendResponse was called for unknown type: ${JSON.stringify(sentResponses)}`);
	process.exit(1);
}
console.log("[scenario 1.1] unknown type returns undefined and does NOT call sendResponse ✓");
console.log("[scenario 1.1] PASS");
