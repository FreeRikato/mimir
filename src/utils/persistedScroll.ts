/**
 * COR-10: persist a numeric scroll position in chrome.storage.session,
 * keyed by a stable route id. The hook in this file is small enough
 * that the consumers (HistoryPanel, the tab list) can call it
 * directly.
 */

const SCROLL_KEY = "mimir_panel_scroll";

export interface ScrollSnapshot {
	route: string;
	scrollTop: number;
	timestamp: number;
}

export async function loadScrollSnapshot(route: string): Promise<number> {
	try {
		const stored = (await chrome.storage.session.get([SCROLL_KEY])) as Record<string, ScrollSnapshot | undefined>;
		const snap = stored[SCROLL_KEY];
		if (snap && snap.route === route && Date.now() - snap.timestamp < 60 * 60 * 1000) {
			return snap.scrollTop;
		}
	} catch {
		// ignore
	}
	return 0;
}

export async function saveScrollSnapshot(route: string, scrollTop: number): Promise<void> {
	try {
		await chrome.storage.session.set({
			[SCROLL_KEY]: { route, scrollTop, timestamp: Date.now() } satisfies ScrollSnapshot,
		});
	} catch {
		// ignore quota errors
	}
}
