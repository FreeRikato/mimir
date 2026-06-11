# Manifest notes

Documentation kept alongside `manifest.json` for Chrome Web Store review and
internal tracking. **None of these blocks are loaded by Chrome** — MV3
manifests reject unknown top-level keys, so notes live here in Markdown
instead of in the JSON. If you add a new note, link it from
`QA_BUG_REPORT.md` so it is discoverable.

## `host_permissions` justification (SEC-2 / PERF-1)

The subtitle backend host is user-configurable at build time via
`VITE_SUBTITLES_BASE_URL` (default empty). Because the host is not known at
manifest-write time, we keep `<all_urls>` as the conservative fallback. The
four localhost entries are explicit dev-only origins for the FastAPI backend.
See `QA_BUG_REPORT.md` SEC-2 for the full discussion and the Web Store
listing justification text.

**Review action:** When the backend host becomes static (e.g. a hosted
FastAPI service), drop `<all_urls>` and replace with the concrete origin to
skip the broad-host review flag.
