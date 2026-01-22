# Mimir Chrome Extension - Deep-Dive Learning Checklist

## Prerequisites & Setup

### Commands
```bash
npm install                 # Install dependencies
npm run dev                # Start Vite dev server (loads extension in Chrome)
npm run build              # TypeScript check + production build
npm run lint               # Run ESLint on all TypeScript/TSX files
npm run preview            # Preview production build locally
```

### Loading the Extension
1. Run `npm run dev` to start the Vite dev server
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the `dist/` folder
5. The extension will load and you'll see the Mimir icon

### Viewing Logs
- **Background Service Worker**: Open `chrome://extensions/` → Find Mimir → Click "Service Worker" link
- **Side Panel**: Open side panel (click extension icon), then use Chrome DevTools (right-click → Inspect)
- **Content Script**: Open any web page, use Chrome DevTools Console to see injected button logs

---

## Recommended Reading Order

### Phase 1: Foundation (Manifest & Build)
1. **manifest.json** - Extension permissions, background service worker, side panel
2. **vite.config.ts** - @crxjs/vite-plugin, Tailwind, React compiler
3. **package.json** - Dependencies, scripts

### Phase 2: Extension Lifecycle
4. **src/background/index.ts** - Service worker, message listener, side panel behavior
5. **src/content/index.ts** - Floating action button injection, DOM manipulation

### Phase 3: Types & Data Models
6. **src/types/index.ts** - ChromeTab, DomainGroup, ExtractedData, SubtitleError

### Phase 4: Utilities (Core Logic)
7. **src/utils/domainHelpers.ts** - extractDomain, groupTabs, caching
8. **src/utils/cache.ts** - Chrome storage.session, TTL, quota management
9. **src/utils/scripting.ts** - getPageHTML (injected function)
10. **src/utils/youtube.ts** - URL validation, normalization, video ID extraction

### Phase 5: YouTube Integration
11. **src/utils/subtitles.ts** - External API, retries, timeout, cache, error handling

### Phase 6: React Hooks (State Management)
12. **src/hooks/useSelection.ts** - Set-based selection, indeterminate state
13. **src/hooks/useTabs.ts** - Debounced tab events, cache-first loading

### Phase 7: UI Components
14. **src/components/Checkbox.tsx** - Indeterminate state, glassmorphism
15. **src/components/TabItem.tsx** - Chrome tabs API (update/focus)
16. **src/components/DomainGroup.tsx** - Collapsible groups, domain header
17. **src/components/Footer.tsx** - Extraction states, button variants
18. **src/components/ExtractionErrorAlert.tsx** - Error display, dismiss

### Phase 8: App Orchestration
19. **src/SidePanelApp.tsx** - Main extraction flow, parallel processing
20. **src/sidepanel/index.tsx** - React root, toast setup
21. **src/popup/index.tsx** - Separate entry point (minimal)
22. **src/App.tsx** - Standalone app (for testing)

---

## Deep-Dive Checklist

### Extension Lifecycle

- [ ] **Manifest V3 structure**: Understand permissions (`scripting`, `tabs`, `storage`, `sidePanel`), background service worker type, default_path
  - File: `manifest.json`
  - Key lines: 15-26 (permissions), 27-33 (background & side_panel)

- [ ] **Background service worker**: `chrome.sidePanel.setPanelBehavior`, `chrome.runtime.onInstalled`, message listener pattern
  - File: `src/background/index.ts`
  - Boot flow: Sets side panel to open on icon click, listens for runtime messages

- [ ] **Content script injection**: DOM-ready detection (`DOMContentLoaded`), floating button styling with glassmorphism
  - File: `src/content/index.ts`
  - Creates a floating "Mimir" button on web pages

- [ ] **Chrome extension contexts**: Background (service worker), Content script (page), Side panel (UI), Popup (icon click)
  - Background: Runs in separate context, handles extension lifecycle
  - Content: Has access to page DOM
  - Side panel: Main UI for user interaction
  - Popup: Alternative UI (minimal in this extension)

### UI + State

- [ ] **React 19 patterns**: Functional components, TypeScript props interfaces, useCallback for event handlers
  - Example: `src/components/TabItem.tsx` - Uses `handleTabClick` with useCallback

- [ ] **useSelection hook**: Set-based selection state, indeterminate calculation, toggleTab/toggleDomain logic
  - File: `src/hooks/useSelection.ts`
  - Manages selected tabs using `Set<number>`
  - Calculates indeterminate state (some but not all tabs in domain selected)

- [ ] **useTabs hook**: Chrome tabs API (`chrome.tabs.query`), event debouncing, request cancellation (activeRequestIdRef), cache-first loading
  - File: `src/hooks/useTabs.ts`
  - Key lines: 30-98 (fetchTabsImpl), 125-142 (storage listener), 144-170 (tab event listeners)
  - Uses refs to track request IDs and prevent race conditions

- [ ] **SidePanelApp state machine**: ExtractionStatus enum ('idle'|'extracting'|'success'|'partial'|'error'), error tracking array
  - File: `src/SidePanelApp.tsx`
  - Key lines: 28-31 (state), 40-157 (handleExtract)
  - Orchestrates parallel extraction via `Promise.all`

- [ ] **Component composition**: DomainGroup (collapsible) → TabItem (clickable), Checkbox (indeterminate), Footer (multi-state)
  - `DomainGroup` wraps multiple `TabItem` components
  - `Checkbox` supports checked, unchecked, and indeterminate states
  - `Footer` shows extraction status and action buttons

### Data + Caching

- [ ] **Chrome storage.session**: `chrome.storage.session.get/set`, TTL (30s for tabs, 5min for content), quota limits (1MB)
  - File: `src/utils/cache.ts`
  - Key constants: 3-5 (TTL, QUOTA_LIMIT), 8 (CONTENT_CACHE_TTL)

- [ ] **Cache invalidation**: removeExpiredCache, timestamp comparison, quota management before write
  - Lines 59-70 (removeExpiredCache), 131-147 (removeExpiredContentCache)
  - Checks `Date.now() - entry.timestamp > CACHE_TTL`

- [ ] **In-memory caching**: Map-based groupTabsCache, cacheKey generation from tab ID+URL
  - File: `src/utils/domainHelpers.ts`
  - Caches grouped tabs to avoid reprocessing

- [ ] **Storage change listeners**: `chrome.storage.onChanged` for cross-context sync
  - Lines 126-142 in `src/hooks/useTabs.ts`
  - Updates UI when cache changes from other contexts

### YouTube Extraction

- [ ] **URL handling**: isYouTubeUrl validation, normalizeYouTubeUrl (handle youtu.be short URLs), video ID extraction
  - File: `src/utils/youtube.ts`
  - Validates both `youtube.com/watch?v=` and `youtu.be/` formats

- [ ] **External API integration**: fetchWithTimeout (AbortController), retry with exponential backoff + jitter
  - File: `src/utils/subtitles.ts`
  - Lines 72-105 (fetchWithTimeout), 107-154 (fetchWithRetry)
  - RETRY_MAX_ATTEMPTS = 3, base delay 500ms, max delay 5s

- [ ] **Error handling**: SubtitleError class with codes (INVALID_URL, NETWORK_ERROR, TIMEOUT, NO_SUBTITLES), isRetryableError check
  - File: `src/types/index.ts` (SubtitleError definition)
  - Lines 113-122 in `src/utils/subtitles.ts` (isRetryableError)

- [ ] **Subtitles cache**: chrome.storage.local (persistent, 1hr TTL), cleanSubtitleText (remove timestamps, tags, dedup)
  - Lines 12-14 (SUBTITLE_CACHE_TTL = 3600000), 156-173 (cleanSubtitleText)
  - Uses storage.local instead of session for longer persistence

- [ ] **Extraction flow**: Detect YouTube → use subtitles API → fallback to getPageHTML for regular sites
  - Lines 64-83 in `src/SidePanelApp.tsx` (YouTube branch), 86-117 (regular site branch)

### Build Tooling

- [ ] **Vite + @crxjs/vite-plugin**: manifest.json import, HMR for extension, base path configuration
  - File: `vite.config.ts`
  - Hot module replacement works with Chrome extension during development

- [ ] **Tailwind CSS 4**: @tailwindcss/vite plugin, custom properties, glassmorphism utilities (.glass-heavy, .glass-hover)
  - No separate config file - integrated via Vite plugin
  - Custom CSS classes defined in `src/index.css`

- [ ] **TypeScript**: Strict mode, noUnusedLocals/Parameters, target ES2022, bundler resolution
  - Configured in `tsconfig.json` (inferred from AGENTS.md guidelines)

- [ ] **React Compiler**: babel-plugin-react-compiler, optimization for functional components
  - Enabled in Vite config for automatic optimizations

- [ ] **Linting**: ESLint flat config, react-hooks, react-refresh rules
  - Configured to enforce code quality and catch common React issues

---

## Practice Tasks

### 1. Run the Extension
```bash
npm run dev
```
Then load the unpacked extension in Chrome, open the side panel, and observe how tabs are grouped by domain.

### 2. Trace Tab Events
Add console.log in `src/hooks/useTabs.ts`:
```typescript
console.log('Tab event triggered', { type: 'updated/created/removed' });
```
Reload the extension and watch Chrome DevTools while opening/closing tabs.

### 3. Test YouTube Extraction
1. Open a YouTube video in a tab
2. Select it in the side panel
3. Click "Extract"
4. Watch the console logs for retry attempts and cache hits
5. Try again immediately to see the cache in action

### 4. Inspect Cache Entries
In Chrome DevTools Console (side panel):
```javascript
chrome.storage.session.get(null)
```
View cached tabs and content entries with timestamps.

### 5. Break Things
Temporarily disable cache to see API calls:
- Comment out `const cached = await getCachedTabs()` in `src/hooks/useTabs.ts:38`
- Modify TTL values to experiment with cache duration
- Disable the retry logic to see error handling

---

## Key Concepts to Master

- **Chrome extension API**: `tabs`, `scripting`, `storage`, `sidePanel`
- **React hooks**: Complex state (useEffect dependencies, cleanup, refs)
- **Cache strategies**: TTL, quota-aware writes, invalidation
- **Async patterns**: `Promise.all`, parallel extraction, retry with backoff
- **TypeScript interfaces**: Extension data models and type safety

---

## Common Patterns in This Codebase

- **Error handling**: Try/catch with fallback, user-friendly messages, `console.warn` for non-critical
- **Event cleanup**: `useEffect` return functions, `clearTimeout`, `removeListener`
- **Type guards**: `tab is chrome.tabs.Tab & { id: number; url: string }`
- **Memoization**: `useCallback` with proper deps, `useMemo` for derived values
- **Glassmorphism CSS**: `backdrop-filter`, `rgba` colors, `border-opacity`

---

## Next Steps

After completing the checklist:
1. **Build a feature**: Add a new utility to filter tabs by title
2. **Optimize caching**: Implement LRU cache eviction for quota management
3. **Add tests**: Set up Vitest + React Testing Library (recommended in AGENTS.md)
4. **Extend YouTube support**: Handle multiple language subtitles or auto-generated captions
