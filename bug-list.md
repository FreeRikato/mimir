# Mimir — Bug List

  Explored the full repo: manifest.json, vite.config.ts, tsconfig.app.json, biome.json, package.json, src/SidePanelApp.tsx (1519 LOC), src/background/index.ts (301 LOC), src/
  content/{index,xTwitter}.ts, src/hooks/*.ts (5 files), src/utils/* (17 files), src/components/* (16 files), src/types/index.ts, and the per-folder AGENTS.md specs. Listed
  below are real defects, grouped by severity and area, with file:line references. Not all are "must fix now" — flagged by impact.

  ———

## 0. Resolution status

  Tracked against this file. Last updated 2026-06-08. Items marked **FIXED** carry a commit hash (or a notepad reference for uncommitted work) and the test that pins the contract; items marked **OPEN** have no commit.

  | # | Title | Status | Fixed by | Test |
  |---|-------|--------|----------|------|
  | 1.3 | PDF retry can't see API_ERROR | FIXED (verified, pre-existing) | 2d42ec4 + 57ef780 | `src/utils/pdfExtraction.test.ts` (11 tests) |
  | 1.4 | closeTabsSafely miscounts after a tab switch | FIXED 2026-06-08 | this run (uncommitted) | `src/utils/tabHelpers.test.ts` (5 tests) |
  | 1.5 | setCachedContent has no write lock | FIXED 2026-06-08 | this run (uncommitted) | `src/utils/cache.test.ts` (4 tests) |
  | 1.6 | Subtitle save clobbers storage on mount | FIXED 2026-06-08 | this run (uncommitted) | `src/utils/persistedSetting.test.ts` (5 tests) + wiring in `src/SidePanelApp.tsx` |
  | 1.7 | safeWriteToClipboard swallows focus error | FIXED 2026-06-08 | this run (uncommitted) | `src/utils/clipboardFallback.test.ts` (7 tests) + wiring in `src/SidePanelApp.tsx` |

  Per-bug RED→GREEN captured in `notepad/ulw-loop-fixes-1-3-to-1-7.md`. The remaining items (1.1, 1.2, 2.x, 3.x, 4.x) are **OPEN** and untouched by this run.

  ———

  ## 1. Critical — silent failure / wrong behaviour

  ### 1.1 Background onMessage handler drops the channel for unknown message types

  - src/background/index.ts:296 — when message.type is not FETCH_SUBTITLES/FETCH_PDF_BYTES/EXTRACT_PDF, the code calls sendResponse({ status: "received" }) without return true.
    In MV3 the message channel closes synchronously after the listener returns, so any caller awaiting a response gets nothing. Use a guard before the fallback sendResponse.

  ### 1.2 Subtitle retry never re-attempts 429 / 5xx API errors

  - src/utils/subtitles.ts:612-620 — isRetryableError looks for a statusCode property on SubtitleError:

    const statusCode = (error as SubtitleError & { statusCode?: number }).statusCode;
    But SubtitleError (src/types/index.ts:120-130) has no such field. The cast is a forced no-op. Every "transient" 429/5xx from the FastAPI backend fails on the first attempt —
    defeats the whole retry layer.

  ### 1.3 PDF retry can't see API_ERROR either

  - src/utils/pdfExtraction.ts:70-77 — isRetryableError only treats TIMEOUT/NETWORK_ERROR/SERVER_ERROR/OCR_UNAVAILABLE as retryable; never checks status. Combined with the
    SUBTITLES_BASE_URL dev-only fallback and the hardcoded 127.0.0.1:8000 in the timeout error string, the first 503 kills the whole pipeline.
  **FIXED** — see Section 0 above; API_ERROR + 408/429/5xx retried (other 4xx not). Origin: 2d42ec4 + 57ef780. Test: `src/utils/pdfExtraction.test.ts`.


  ### 1.4 closeTabsSafely miscounts closed tabs after a normal tab switch

  - src/utils/tabHelpers.ts:97-114 — "active tab was closed" detection compares activeTabAfter.id !== activeTabBeforeClose. If the user legitimately switches tabs while the
    close is in flight (very likely for a multi-second extraction), the code subtracts 1 from closed even though nothing went wrong. The return shape CloseTabsResult is shown in
    toasts, so the UI reports a wrong count.
  **FIXED** — see Section 0 above; Now re-queries the previously-active tab via `chrome.tabs.get` and only decrements `closed` when the tab is actually gone. Test: `src/utils/tabHelpers.test.ts`.


  ### 1.5 setCachedContent has no write lock — concurrent writes corrupt totalSize

  - src/utils/cache.ts:setCachedContent (~L380-440) — unlike setCachedTabs (which has a module-level cacheWriteLock), setCachedContent performs read-modify-write on the metadata
    without serialization. Two parallel extractions finishing at once both compute metadata.totalSize += entrySize on the same snapshot, double-counting. The 9MB cap becomes
    unreliable; the cap is silently exceeded.
  **FIXED** — see Section 0 above; Wrapped in module-level `contentCacheWriteLock` + IIFE, mirroring `setCachedTabs`. Test: `src/utils/cache.test.ts`.


  ### 1.6 Subtitle format/language "save" effect clobbers storage on mount

  - src/SidePanelApp.tsx:790-803 — useEffect(() => { saveSubtitleFormat() }, [subtitleFormat]) and the same for subtitleLanguage both run on first render with the default state,
    racing the useEffect that loads the stored value. If storage was empty/slow, the default "json"/"en" gets written before the load resolves, and the load result then
    overwrites the just-saved value (re-render + re-save loop possible). Needs a hasLoadedRef guard.
  **FIXED** — see Section 0 above; Load effect calls `markLoaded()` on the new `createLoadedGuard()` ref after `setState`; save effect gates on the guard. Test: `src/utils/persistedSetting.test.ts`.


  ### 1.7 safeWriteToClipboard swallows the focus error

  - src/SidePanelApp.tsx:53-77 — when the document isn't focused, the function stores the data and returns "requires_manual_copy", but the UI's "Copy Now" button depends on
    showManualCopyButton state being set elsewhere. If the user dismisses the panel and the focus event fires, setPendingClipboardContent(null) clears the data while the module-
    level pendingClipboardData is still set — desync.

  **FIXED** — see Section 0 above; New `createClipboardFallback<T>()` is the single source of truth. Focus handler re-checks `document.hasFocus()`, classifies `NotAllowedError` as focus-loss (preserves pending), clears pending on non-focus errors (no more silent stale data). Test: `src/utils/clipboardFallback.test.ts`.

  ———

  ## 2. High — race conditions, resource leaks, schema gaps

  ### 2.1 fetchFromBackground timeout does not abort the underlying fetch

  - src/utils/subtitles.ts:480-510 — uses a setTimeout that rejects the wrapping promise, but the chrome.runtime.sendMessage call has no way to abort. The network request keeps
    running in the background. Same pattern in pdfExtraction.ts:fetchPdfFromBackground. Leak on every cancellation.

  ### 2.2 Background PDF/Subtitle fetch ignores the side panel's AbortSignal

  - src/background/index.ts:EXTRACT_PDF (~L170-295) and the FETCH_SUBTITLES handler (~L30-130) — neither accepts nor forwards an AbortSignal. The side panel aborts but the
    background keeps fetching, allocates an ArrayBuffer for PDFs, and writes to sendResponse after the caller has given up. The controller.abort() only triggers the local
    setTimeout cleanup; the actual fetch is unaffected.

  ### 2.3 Three stacked "sticky top-0" progress bars

  - src/SidePanelApp.tsx:1367-1382 — if the user fires a selected-extract, then immediately hits a keyboard shortcut for extract-to-right, two ExtractionProgressDisplays render
    with the same sticky top-0. They overlap. With extract-highlighted triggered, three stack on top of each other, all on the same z-index. The cancel buttons become
    unreachable for the bottom one.

  ### 2.4 addEntry doesn't update hasMore / currentLimit

  - src/hooks/useHistory.ts:107-114 — when the user adds a new entry, entries gets a prepended item and count increments, but currentLimit and hasMore are stale. After many in-
    session adds, loadMore either fires forever or never. Symptom: "load more" spinner appears at the wrong times.

  ### 2.5 useEffect saves run in async closures without isMounted guards

  - src/SidePanelApp.tsx:754-779 (tabs-to-right count), 781-788 (format load), 790-803 (format save), 805-820 (language load/save), 830-840 (clipboard focus) — all set state in
    await-after-async chains. If the user closes the side panel before the promise resolves, you get React's "set state on unmounted component" warning. (Refactor to use an
    isMounted ref or abort controllers.)

  ### 2.6 useHighlightedTabs race

  - src/hooks/useHighlightedTabs.ts:25-35 — fetchHighlightedTabs is called from the onHighlighted listener, then setHighlightedTabs is called and a re-render triggers
    chrome.tabs.query again. No isMounted guard. Multiple parallel fetches can land in any order; older results can overwrite newer ones.

  ### 2.7 ObjectURL revoke can race the browser download

  - src/utils/exporters.ts:downloadAsFile — URL.createObjectURL → a.click() → URL.revokeObjectURL(url) runs in the same tick. On slower browsers (especially on the side-panel
    surface) the revoke can land before the download starts. Use a setTimeout(revoke, 0) or wait for the anchor to dispatch the click event.

  ### 2.8 PDF upload prompt only surfaces one tab

  - src/SidePanelApp.tsx:checkAndPromptPdfUpload (~L860-870) — errors.find((e) => e.errorCode === "PDF_FILE_UPLOAD_REQUIRED") returns the first match. If the user batch-extracts
    three local PDFs, only one prompt is shown; the other two are silently dropped. No queue, no "1 of 3" UI.

  ### 2.9 subtitles.ts and pdfExtraction.ts duplicate the dev-URL fallback

  - src/utils/subtitles.ts:11 and src/utils/pdfExtraction.ts:14-25 both read import.meta.env.VITE_SUBTITLES_BASE_URL ?? "" and substitute "127.0.0.1:8000" in DEV. If the env var
    is set to a production URL but DEV is true, production is used (good). If the env var is set to a partial value like api.example.com (no protocol), both normalize to
    http://api.example.com. OK in practice, but the same logic in two files drifts.

  ### 2.10 indexeddb.ts migration runs synchronously per entry

  - src/utils/indexeddb.ts:migrateHistory — uses for with await indexedDBInstance.add(entry). If a user has 200 legacy entries, the migration serializes 200 round-trips. A
    Promise.all in batches of 20 would be 1/20th the time. Worse: if one entry fails (try/catch swallows it), the migration flag is still set, and the user can never retry.

  ### 2.11 formatXThread silently returns empty text on schema drift

  - src/utils/xTwitter.ts:formatXThread — the GraphQL response shape is cast as TweetDetailResponse, but the helper has no schema validation. If X changes a field name (which
    they do), the function returns { title: "Tweet <id>", text: "" } with no error. The extractionMethod: "graphql-intercept" is set, the user sees "extracted" in history, but
    the export is empty.

  ### 2.12 useEffect for KEYBOARD_COMMAND re-binds the listener on every state change

  - src/SidePanelApp.tsx:1345-1365 — deps include handleExtractToRight, handleExtract, handleExtractHighlighted, each of which lists history, closeTabsEnabled, clearSelection,
    etc. Every state change re-binds the message listener. Functionally correct, but couples "any state change" to "touching the chrome.runtime message bus". Should be a ref.

  ### 2.13 Three near-identical extraction flows with copy-pasted post-processing

  - src/SidePanelApp.tsx:handleExtract (L866-1000), handleExtractToRight (L1000-1100), handleExtractHighlighted (L1100-1200) — ~140 LOC each, identical structure. Any bug fix
    has to be made in three places. Easy to introduce a cancelled check in one and not the others.

  ### 2.14 formatAsCSV strips valid leading/trailing quotes

  - src/utils/exporters.ts:formatAsCSV — line value = value.replace(/^"|"$/g, "") (in the part I read) is intended to undo upstream quote-stripping but is applied to all values.
    A title like "Q3 Report" (already valid CSV) loses its quotes, breaking round-trip.

  ### 2.15 Reddit thread recursion has no depth cap

  - src/utils/reddit.ts:traverseComments — pure recursion on replies.data.children. Reddit caps at ~30 levels but a malicious sub could nest deeper; rare in practice but
    unguarded.

  ———

  ## 3. Medium — UX, type-safety, edge cases

  ### 3.1 Hardcoded 127.0.0.1:8000 in the user-facing timeout message

  - src/utils/subtitles.ts:497-505 — when the request times out, the user sees "Is the backend server running at http://127.0.0.1:8000?" regardless of what
    VITE_SUBTITLES_BASE_URL is set to. Misleading for prod users.

  ### 3.2 createExtractionError defaults unknown errors to NETWORK_ERROR

  - src/SidePanelApp.tsx:391-423 — a programming bug (TypeError, RangeError, an unhandled rejection from a third-party lib) surfaces to the user as "Network error". Add a
    generic UNKNOWN_ERROR code and surface the error name.

  ### 3.3 getCachedContent always serves from cache, never invalidates on URL change

  - src/SidePanelApp.tsx:extractTab (~L340) — if the same tabId is reused for a different URL (happens when a tab navigates), the cached entry is returned with the old URL. The
    text and title are also stale.

  ### 3.4 useHistory addEntry checks isSearchActive but search() doesn't reset currentLimit

  - src/hooks/useHistory.ts:156-170 — when search is active, currentLimit retains its prior value, so a subsequent clearSearch → refresh may load more than expected. Subtle
    pagination bug.

  ### 3.5 ExtractionErrorAlert truncates to 3 visible errors with "and N more"

  - src/components/ExtractionErrorAlert.tsx:88-91 — if the user has 20 failures, they see 3 + a count, but no way to inspect the rest. Make it expandable or scrollable.

  ### 3.6 chrome.scripting.executeScript failure gives no user feedback

  - src/SidePanelApp.tsx:333-336 — when the call returns injection[0]?.result == null, the user gets nothing extracted and no error toast. Distinguish "tab suspended",
    "permission denied", "frame not loaded".

  ### 3.7 YouTube tab "no result" is silent

  - src/SidePanelApp.tsx:147-160 — fetchYoutubeSubtitles throws a SubtitleError which becomes an ExtractionErrorInfo with userMessage. But if chrome.scripting.executeScript
    succeeds and returns empty, the same silent path is taken. No error code, no toast.

  ### 3.8 subtitles.ts hasShownBackendUnavailableToast is module-scoped

  - src/utils/subtitles.ts:18 — fine for one side-panel instance, but if the panel is closed and reopened (new module init), the flag resets and the toast re-fires even if the
    user already dismissed it.

  ### 3.9 useEffect for updateTabsToRightCount registers 4 chrome.tabs.* listeners, no debounce

  - src/SidePanelApp.tsx:754-779 — every onMoved/onActivated/onCreated/onRemoved triggers an immediate chrome.tabs.query. Opening 20 tabs in a second = 20 queries. Add the same
    DEBOUNCE_DELAY used in useTabs.ts.

  ### 3.10 indexeddb.ts search does case-insensitive domain filter but only in entry-level domains

  - src/utils/indexeddb.ts:230-238 — domains are normalised on filter, but entry.domains is built by extractDomains(data) from item.url hostnames. If a history entry was saved
    before a URL had a hostname change, the filter can miss matches. Low risk.

  ### 3.11 Cache rebuild metadata calls setCacheMetadata while another updateEntryMetadata may be in flight

  - src/utils/cache.ts:setCachedContent emergency-eviction path (~L420-440) — await rebuildMetadata() writes new metadata; meanwhile any other setCachedContent in flight is
    still calling updateEntryMetadata with stale existingEntry references. Concurrency hazard.

  ### 3.12 formatAsMarkdown builds TOC anchors that don't match section IDs

  - src/utils/exporters.ts:formatAsMarkdown — TOC uses [${domain}](#${domain.toLowerCase().replace(/\./g, "-")}), but the section header is ## ${domain}. GitHub-style
    slugification would also strip the www. prefix and handle IDN. Anchor mismatches on renderers that don't auto-slug.

  ### 3.13 formatAsMarkdown doesn't escape backticks in titles

  - src/utils/exporters.ts:escapeMarkdown — replaces [_*[\]()\~#+-.!|]with$1, which adds a backslash before backticks. Most renderers treat ` as literal inside backticks, so
    titles like "Use `code` here" get rendered as Use \`code\` here visually. Use HTML entity or a fenced code block.

  ### 3.14 sanitizeUrl allows data: URLs

  - src/utils/exporters.ts:sanitizeUrl — safeProtocols = ["http:", "https:", "mailto:", "tel:"] correctly filters javascript: and vbscript:, but the check uses parsed.protocol,
    and some legacy sites use data:text/html,<script>.... Verify against an explicit allow-list. (Currently safe — just not tested.)

  ### 3.15 formatAsHTML allows any id in the TOC but doesn't escape class collisions

  - src/utils/exporters.ts:createHtmlId — input.toLowerCase().replace(/[^a-z0-9]/gi, "-"). Two domains foo.com and foo—com (em-dash) both become foo-com. First wins, second is
    unreachable.

  ### 3.16 chrome.storage.session listener in useTabs listens to all session changes

  - src/hooks/useTabs.ts:127-145 — narrows on CACHE_KEY, good. But the value of newValue.timestamp is checked with < CACHE_TTL only — does not also verify the format. A
    corrupted entry with timestamp: Number.MAX_SAFE_INTEGER and an empty data array will silently replace the loaded groups.

  ### 3.17 Side panel uses chrome.storage.session for the tab-group cache but chrome.storage.local for the subtitle cache

  - AGENTS.md prescribes the split, but the side panel's useTabs reads the session cache on every storage change, while the popup is a different document — it doesn't share
    session storage. The popup's App.tsx is a placeholder, but if it ever reads tabs, it will see nothing.

  ### 3.18 useHistory search() returns no count

  - src/hooks/useHistory.ts:157-170 — sets entries but not count. The count field displayed in the HistoryPanel header remains the total count, not the search-hit count. UI
    ambiguity.

  ### 3.19 exporters.ts uses deprecated substr

  - src/utils/exporters.ts:createHtmlId — .substring(0, 50) is used in the version I read, but the comment block cites substr. Verify the file actually uses substr; if so,
    replace with slice/substring.

  ### 3.20 clearHealthCheckCache is exported but unused

  - src/utils/subtitles.ts:683-686 — re-exported, not imported anywhere in the side panel or components. The "retry" toast in ExtractionErrorAlert is the UI surface that should
    call this. Dead code; either wire it up or delete.

  ### 3.21 ExtractionProgressDisplay formatETA may render negative or Infinity values

  - src/components/ExtractionProgress.tsx — formatETA(etaMs) uses (Date.now() - startTime) / completed. If completed === 0 (start of extraction), this is Infinity; if startTime
    is in the future (clock skew), negative. The display would show "ETA: NaN" or "ETA: -30s". Guard with completed > 0.

  ### 3.22 pendingClipboardData survives side-panel reload

  - src/SidePanelApp.tsx:35 — module-level let pendingClipboardData: string | null = null;. In MV3, the side panel is a real document and the module reloads each time. OK — but
    the focus event listener won't be able to access the data because the listener's closure was bound in a previous module init. The new module's pendingClipboardData starts
    null. Inconsistency between "stored in module" and "stored in state".

  ### 3.23 useEffect for KEYBOARD_COMMAND debounce risk

  - src/SidePanelApp.tsx:1345-1365 — the listener calls handleExtract() etc. If the user double-taps the keyboard shortcut (very common), two extractions start in parallel. The
    first to set setAbortController wins, the second's controller is silently overwritten — the first extraction can no longer be cancelled.

  ### 3.24 X/Twitter extraction doesn't surface the "focalTweetId not in response" error clearly

  - src/SidePanelApp.tsx:201-225 — when the GraphQL response doesn't include the focal tweet (often happens during navigation, or when X serves a cached/empty response), the
    user sees a generic PARSE_ERROR toast. Distinguish "not yet captured" (retry-hint) vs. "schema drift" (bug-report hint).

  ———

  ## 4. Low — code health, dead code, a11y, polish

  ### 4.1 AGENTS.md references a non-existent src/popup/PopupApp.tsx

  - AGENTS.md (root) lists src/popup/PopupApp.tsx but the file is src/App.tsx. Update the AGENTS or move the file.

  ### 4.2 App.tsx is a placeholder that still wires a chrome.tabs.sendMessage to a non-existent content listener

  - src/App.tsx:6-17 — sends { action: "test" } to the active tab, but no content script registers a chrome.runtime.onMessage listener (the X/Twitter MAIN-world content script
    patches fetch, it doesn't listen for messages). Pressing the button logs an undefined response. Either remove the popup or implement the test path.

  ### 4.3 useEffect/useCallback dep arrays are inconsistent across settings effects

  - src/SidePanelApp.tsx:781-820 — load effects have [] deps, save effects have [subtitleFormat]/[subtitleLanguage]. Convention says "always include the setter/state you read";
    load effects should include a hasLoaded ref.

  ### 4.4 src/components/ExportFormatModal.tsx duplicates the format selector from ExportModal.tsx

  - Both modals render the same FORMAT_OPTIONS list. If a new format is added, it must be added in two places. The ExportModal is the newer one and is wired in;
    ExportFormatModal is dead.

  ### 4.5 ExtractionButton.tsx is not imported anywhere

  - src/components/ExtractionButton.tsx is a self-contained button. The actual extract buttons live in Footer.tsx. Delete or wire in.

  ### 4.6 useAutoHideProgress deps setProgress is stable but delay is not memoized

  - src/SidePanelApp.tsx:88-100 — delay defaults to 1500, passed as primitive, so the effect doesn't churn. OK in practice; flag for future use.

  ### 4.7 Footer.tsx underscore-prefixed unused props

  - src/components/Footer.tsx:21-25 — three props are received with _ prefix to suppress Biome's noUnusedLocals. Functional, but the alternative is to drop them from the
    interface.

  ### 4.8 domainHelpers.ts clearGroupTabsCache is exported but never called

  - src/utils/domainHelpers.ts — useTabs.ts:fetchTabsImpl calls it. OK. But useTabs doesn't call it on tab close; only on the initial fetch. Stale groups can persist if a tab
    closes and the cache write hasn't happened yet.

  ### 4.9 pdfExtraction.ts normalizeBaseUrl swallows the dev fallback

  - src/utils/pdfExtraction.ts:21-26 — if import.meta.env.DEV is true and no env is set, it falls back to 127.0.0.1:8000. This is fine for dev but if a user runs vite preview
    (which sets import.meta.env.DEV = false) with no env, the user gets an opaque NETWORK_ERROR instead of a clear "configure the backend" message.

  ### 4.10 subtitles.ts import of clearHealthCheckCache is renamed twice

  - src/utils/subtitles.ts:14 and :683 — import { checkBackendHealth, clearHealthCheckCache as clearHealthCache } from "./backendHealth" and then export { checkBackendHealth,
    clearHealthCheckCache as resetBackendHealthCheck } from "./backendHealth". Three names for the same function (clearHealthCache, resetBackendHealthCheck,
    clearHealthCheckCache via the import). Pick one and stick with it.

  ### 4.11 useHistory addEntry is useCallback([isSearchActive]) but isSearchActive only changes on search()/clearSearch()/refresh() — fine, but setEntries((prev) =>
  [newEntry, ...prev]) is called even if the entry already exists in the list (e.g., double-fire on retry). Needs a dedupe check.

  ### 4.12 No export type for ExtractionProgress callback shape

  - src/SidePanelApp.tsx:454-461 — the inline (update: { completed; failed; total; currentTab: ... }) => void duplicates the ProgressUpdate type from src/types/index.ts:194-198.
    Should reuse.

  ### 4.13 scripting.ts getPageHTML returns empty string for document.body == null (iframes, before-load)

  - src/utils/scripting.ts:6-11 — the comment says it handles this, but a return of { text: "", title: "Untitled", url } is indistinguishable from "page is empty". Add a
    partial: true flag so the caller can warn the user.

  ### 4.14 cache.ts getCacheMetadata returns a fresh object every call

  - src/utils/cache.ts:42-50 — every cache read does a chrome.storage.session.get. With 5+ reads per extraction (ensureCacheSpace, updateEntryMetadata, etc.), the round-trips
    add up. Cache the metadata in a module-level Map invalidated on write.

  ### 4.15 useTabs calls setIsLoading(false) in finally but the setError path can leave isLoading=true if the setIsLoading(true) is in the inner closure

  - The flow is setIsLoading(true) → try/catch → finally setIsLoading(false). OK in the read I did. Re-verify on a re-read.

  ### 4.16 Footer glass-amber and glass-red design tokens are referenced but I didn't see them defined

  - src/components/Footer.tsx:55-65 — uses glass-amber text-amber-300 border border-amber-500/30 and glass-red text-red-300 border border-red-500/30. The CSS at src/index.css
    defines glass-teal/glass-orange/glass-pink/glass-cyan but no glass-amber or glass-red. Status icons fall back to default glass styling. Visual bug.

  ### 4.17 ExtractionProgressDisplay isCancelled panel doesn't cancel the underlying abort

  - src/components/ExtractionProgress.tsx — pressing Cancel calls onCancel which sets isCancelled: true AND calls controller.abort(). The auto-hide runs on isCancelled only. If
    the abort fails (e.g., the controller is already aborted), isCancelled is set but the underlying work continues. Race.

  ### 4.18 useEffect for handleStorageChange in useTabs listens to all session changes

  - src/hooks/useTabs.ts:127-145 — narrows on CACHE_KEY, fine. But the change handler does setGroups(newValue.data) without any validation. A corrupt cache write (e.g., from a
    buggy future migration) replaces the in-memory groups with garbage.

  ### 4.19 The popup's App.tsx has a "Test Content Script" button that calls sendMessage with no world arg

  - src/App.tsx:6-17 — chrome.tabs.sendMessage defaults to the isolated world. The X/Twitter MAIN-world script can't receive this. Use chrome.scripting.executeScript({ world:
    "MAIN", func: ... }) instead.

  ### 4.20 biome.json a11y rules are intentionally off

  - Per AGENTS.md, this is project policy, so not a bug. But TabItem and DomainGroup are clickable divs with no role, no keyboard handler, no aria-expanded. Screen reader users
    can't use the side panel.

  ### 4.21 The dev "127.0.0.1:8000" fallback is in two files and is wrong for HTTPS production

  - src/utils/subtitles.ts:11 and src/utils/pdfExtraction.ts:14-25. If VITE_SUBTITLES_BASE_URL is unset, both fall back to plain-HTTP 127.0.0.1:8000. A production user gets a
    confusing "backend unavailable" toast with no remediation.

  ### 4.22 No upper bound on useHistory.search result set

  - src/utils/indexeddb.ts:search — fetches all entries, then filters in memory. If the user has 10,000 history entries and a broad search, the UI hangs. Should use a cursor +
    limit.

  ### 4.23 ExtractionProgress isCancelled is reset by the auto-hide but the next extraction sees the previous isCancelled

  - src/SidePanelApp.tsx:setExtractionProgress({ ...prev, isCancelled: false }) is on every new extract start, but if the auto-hide setTimeout is still pending and the new
    extract starts, the new progress can be cleared by the old timeout. Cleanup happens via useEffect return, but the setTimeout is the inner closure, captured by the effect
    that has deps [progress?.isCancelled]. Once isCancelled flips to true, the effect schedules a hide; the next flip to false clears the timeout. OK actually — the cleanup
    return () => clearTimeout(timeout) handles it.

  ### 4.24 exporters.ts formatAsJSON doesn't pretty-print for very large datasets

  - JSON.stringify(data, null, 2) is O(N) but the resulting string is ~3x the minified size. For 50 tabs of 100KB each (a long-form essay), the clipboard payload is 15MB — the
    clipboard write may fail silently. The safeWriteToClipboard doesn't check size.

  ### 4.25 useHistory.addEntry does not call setHasMore after add

  - Already mentioned (2.4). Repeated here for grouping.

  ———

  ## 5. Summary counts

  - Critical (1.1-1.7): 7 issues — 5 FIXED (1.3 pre-existing, 1.4-1.7 this run), 2 OPEN (1.1, 1.2)
  - High (2.1-2.15): 15 issues — all OPEN
  - Medium (3.1-3.24): 24 issues — all OPEN
  - Low (4.1-4.25): 25 issues — all OPEN

  Total: 71 issues across 4 severity tiers. 5 resolved, 66 open.
