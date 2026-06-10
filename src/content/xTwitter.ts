// Runs in MAIN world at document_start on x.com and twitter.com.
// Patches window.fetch to intercept TweetDetail GraphQL responses and stores
// the parsed JSON in window.__mimiXData[tweetId] for Mimir to read via executeScript.
//
// Memory safety (MEM-1, MEM-2):
//   - The store is a bounded LRU (50 entries). Long sessions no longer grow
//     the cache to hundreds of MB — the oldest unseen thread is evicted on
//     the 51st unique focalTweetId.
//   - SPA navigations clear the store. X's client-side router pushes new
//     history entries without a real page load, so stale thread data would
//     otherwise pile up across 20+ client-side route changes. The wiring
//     lives in `installXNavigationListeners` (unit-tested in node).

import { createXDataStore, type XDataStore } from "../utils/xDataStore";
import { installXNavigationListeners } from "../utils/xTwitterNavigation";

type MimiXStore = Record<string, unknown>;

const w = window as Window & { __mimiXData?: MimiXStore };

// Bootstrap the visible window property. Existing readers (e.g.
// `readXDataFromPage` in src/utils/xTwitter.ts) still index by tweet id; the
// LRU enforcement happens through `XDataStore` below.
w.__mimiXData = w.__mimiXData ?? {};

// Backing store with the LRU cap. We mirror reads/writes to `__mimiXData`
// so that pre-existing readers stay compatible.
const store: XDataStore = createXDataStore();

const syncToWindow = (id: string, value: unknown): void => {
	if (value === undefined) {
		delete w.__mimiXData?.[id];
	} else {
		if (w.__mimiXData) w.__mimiXData[id] = value;
	}
};

const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const response = await originalFetch(input, init);

	const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

	if (url.includes("TweetDetail")) {
		const cloned = response.clone();
		cloned
			.json()
			.then((data: unknown) => {
				try {
					const urlObj = new URL(url);
					const rawVars = urlObj.searchParams.get("variables");
					if (!rawVars) return;
					const vars = JSON.parse(rawVars) as { focalTweetId?: string };
					const tweetId = vars.focalTweetId;
					if (tweetId) {
						store.set(tweetId, data);
						syncToWindow(tweetId, data);
					}
				} catch {
					// Non-fatal — don't break X's rendering
				}
			})
			.catch(() => {});
	}

	return response;
};

// SPA navigation handling. See xTwitterNavigation.ts for the contract.
installXNavigationListeners(
	{
		store,
		onClear: () => {
			// Mirror to the window object so legacy readers also see the wipe.
			if (w.__mimiXData) {
				for (const key of Object.keys(w.__mimiXData)) delete w.__mimiXData[key];
			}
		},
	},
	window,
);
