import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifestFile, validateManifestString } from "./validate-manifest.mjs";

const VALID = {
	manifest_version: 3,
	name: "Mimir",
	version: "1.0.0",
	description: "Extract rendered text from open tabs grouped by domain",
	icons: { 16: "files.png", 48: "files.png", 128: "files.png" },
	action: { default_title: "Mimir", default_icon: "files.png" },
	permissions: ["scripting", "activeTab", "storage", "sidePanel", "tabs", "clipboardWrite"],
	content_scripts: [
		{ matches: ["https://x.com/*"], js: ["src/content/xTwitter.ts"], run_at: "document_start", world: "MAIN" },
	],
	host_permissions: ["<all_urls>"],
	background: { service_worker: "src/background/index.ts", type: "module" },
	side_panel: { default_path: "src/sidepanel/index.html" },
	commands: { _execute_action: { suggested_key: { default: "Alt+M" }, description: "Open side panel" } },
};

const writeTmp = (name, contents) => {
	const dir = mkdtempSync(join(tmpdir(), "mimir-manifest-"));
	const path = join(dir, name);
	writeFileSync(path, contents);
	return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

describe("validateManifestString", () => {
	it("accepts a well-formed MV3 manifest", () => {
		const r = validateManifestString(JSON.stringify(VALID));
		expect(r.ok).toBe(true);
		expect(r.errors).toEqual([]);
	});

	it("rejects manifest_version: 2", () => {
		const r = validateManifestString(JSON.stringify({ ...VALID, manifest_version: 2 }));
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/manifest_version must be 3/);
	});

	it("rejects missing manifest_version", () => {
		const { manifest_version: _drop, ...rest } = VALID;
		const r = validateManifestString(JSON.stringify(rest));
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/manifest_version/);
	});

	it("rejects non-integer manifest_version", () => {
		const r = validateManifestString(JSON.stringify({ ...VALID, manifest_version: 3.5 }));
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/manifest_version/);
	});

	it("rejects string manifest_version", () => {
		const r = validateManifestString(JSON.stringify({ ...VALID, manifest_version: "3" }));
		expect(r.ok).toBe(false);
	});

	it("rejects empty name", () => {
		const r = validateManifestString(JSON.stringify({ ...VALID, name: "" }));
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/name/);
	});

	it("rejects missing name", () => {
		const { name: _drop, ...rest } = VALID;
		const r = validateManifestString(JSON.stringify(rest));
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/name/);
	});

	it("rejects empty version", () => {
		const r = validateManifestString(JSON.stringify({ ...VALID, version: "" }));
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/version/);
	});

	it("rejects non-string version", () => {
		const r = validateManifestString(JSON.stringify({ ...VALID, version: 1 }));
		expect(r.ok).toBe(false);
	});

	it("rejects malformed JSON", () => {
		const r = validateManifestString("{not json");
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/JSON/);
	});

	it("rejects JSON that is not an object (array)", () => {
		const r = validateManifestString(JSON.stringify([1, 2, 3]));
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/object/);
	});

	it("rejects JSON that is not an object (null)", () => {
		const r = validateManifestString("null");
		expect(r.ok).toBe(false);
	});

	it("collects multiple errors, not just the first", () => {
		const r = validateManifestString(JSON.stringify({ ...VALID, name: "", version: "" }));
		expect(r.ok).toBe(false);
		expect(r.errors.length).toBeGreaterThanOrEqual(2);
	});
});

describe("validateManifestFile", () => {
	it("reads and validates a real file", () => {
		const { path, cleanup } = writeTmp("manifest.json", JSON.stringify(VALID));
		try {
			const r = validateManifestFile(path);
			expect(r.ok).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("reports ENOENT with a clean message", () => {
		const r = validateManifestFile("/nonexistent/missing-manifest.json");
		expect(r.ok).toBe(false);
		expect(r.errors.join("\n")).toMatch(/not found|cannot read|ENOENT/);
	});
});
