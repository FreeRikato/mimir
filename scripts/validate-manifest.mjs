#!/usr/bin/env node
// MV3 manifest validator for Chrome extensions.
//
// Walks dist/manifest.json and rejects anything that would prevent the
// extension from loading. Intentionally narrow — it is NOT a full JSON-schema
// check; it pins the invariants that have actually broken Mimir builds:
//   - manifest_version must be the integer 3
//   - name and version must be non-empty strings
//
// CLI usage:
//   node scripts/validate-manifest.mjs <path-to-manifest.json>
// Exits 0 on PASS, 1 on FAIL. Prints a single human-readable summary.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_VERSION = 3;

function isPlainObject(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateManifestString(raw) {
	const errors = [];
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return { ok: false, errors: [`malformed JSON: ${e.message}`] };
	}

	if (!isPlainObject(parsed)) {
		return { ok: false, errors: ["manifest root must be a JSON object"] };
	}

	if (!("manifest_version" in parsed)) {
		errors.push("manifest_version is required");
	} else if (typeof parsed.manifest_version !== "number" || !Number.isInteger(parsed.manifest_version)) {
		errors.push(`manifest_version must be an integer (got ${typeof parsed.manifest_version})`);
	} else if (parsed.manifest_version !== EXPECTED_VERSION) {
		errors.push(`manifest_version must be ${EXPECTED_VERSION} (got ${parsed.manifest_version})`);
	}

	if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}

	if (typeof parsed.version !== "string" || parsed.version.trim() === "") {
		errors.push("version must be a non-empty string");
	}

	return { ok: errors.length === 0, errors };
}

export function validateManifestFile(path) {
	let raw;
	try {
		raw = readFileSync(resolve(path), "utf8");
	} catch (e) {
		return { ok: false, errors: [`cannot read ${path}: ${e.code ?? e.message}`] };
	}
	const result = validateManifestString(raw);
	if (!result.ok) {
		// Prefix file-level errors with the path so the CI log makes it obvious
		// which manifest failed.
		return { ok: false, errors: result.errors.map((m) => `${path}: ${m}`) };
	}
	return result;
}

// CLI entrypoint — only runs when this file is the process entry, not when
// imported by the test suite.
const isMain = import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? "");

if (isMain) {
	const target = process.argv[2];
	if (!target) {
		console.error("usage: node scripts/validate-manifest.mjs <path-to-manifest.json>");
		process.exit(2);
	}
	const r = validateManifestFile(target);
	if (r.ok) {
		console.log(`PASS  ${target}  (manifest_version: 3)`);
		process.exit(0);
	}
	console.error(`FAIL  ${target}`);
	for (const e of r.errors) console.error(`  - ${e}`);
	process.exit(1);
}
