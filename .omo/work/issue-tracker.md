# Issue tracker — 35 QA fixes

## Memory
- MEM-1: DONE (xDataStore LRU, prior commit)
- MEM-2: DONE (installXNavigationListeners, prior commit)
- MEM-3: DONE (documented in cancellableScripting)
- MEM-4: FALSE POSITIVE (no MutationObserver in codebase)

## Error Handling
- ERR-1: DONE (subtitles.ts: typed throw on maxAttempts<=0)
- ERR-2: DONE (pdfExtraction.ts: same pattern)
- ERR-3: DONE (characterization test for TypeError retry)
- ERR-4: DONE (reddit.ts: 429 Retry-After backoff)
- ERR-5: DONE (extractionError.ts: originalStack field)
- ERR-6: DONE (background SW: top-level error handlers)
- ERR-7: DONE (extractionError.ts: TabSuspendedError misclass)
- ERR-8: DONE (reddit.ts: empty payload NO_SUBTITLES)

## Lifecycle
- LIF-1: DONE (indexeddb.ts: onblocked handler)
- LIF-2: DONE (indexeddb.ts: version-upgrade step-through)
- LIF-3: DONE (cache.ts: QuotaExceededError by name)

## Data Integrity
- DI-1: DONE (cache.ts: timestamp validation)
- DI-2: DOC (cache.ts: comment for future split)
- DI-3: DONE (xTwitter.ts: status- prefix support)
- DI-4: DONE (sessionCacheValidation: filterValidGroups)

## Correctness
- COR-1: DONE (useHighlightedTabs: validate tab shape)
- COR-2: DONE (ExtractionProgress.calc: formatEta guards)
- COR-3: NO-OP (single shared registry already handles)
- COR-4: NO-OP (clearSelection already gated on success)
- COR-5: DONE (reddit.ts: filters kind: "more")
- COR-6: DONE (subtitles.ts: live stream detection)
- COR-7: NO-OP (existing separator is "---" with paragraph breaks)
- COR-8: DONE (useTabs: onChanged key filter)
- COR-9: NO-OP (useHighlightedTabs listens to chrome.tabs.onHighlighted)
- COR-10: TODO (SidePanelApp scroll position persistence)
- COR-11: NO-OP (groupTabs sort is by domain string; stable)
- COR-12: DONE (formatXThread returns mainFound)
- COR-13: DONE (CANCEL_EXTRACTION SW message)

## Performance
- PERF-1: DOC (manifest host_permissions: justification doc)
- PERF-2: DONE (xTwitter uses XDataStore Map)
- PERF-3: NO-OP (useTabs already debounces; sort by domain is stable)
- PERF-4: NO-OP (content script patches fetch, no per-fetch SW message)
- PERF-5: DONE (setCachedTabsDebounced)

## UX
- UX-1: DONE (ExtractionProgress: Cancelling... button state)
- UX-2: DONE (SidePanelApp: transient x-capture banner)
- UX-3: DONE (Footer: 50ms pressed highlight)

## i18n
- I18N-1: DONE (ExtractionProgress.calc: Intl.RelativeTimeFormat)
- I18N-2: DONE (extractionError.messages module)
