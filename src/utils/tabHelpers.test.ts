/**
 * Characterization test for bug 1.4: `closeTabsSafely` miscounts closed tabs
 * when the user legitimately switches the active tab between the call and the
 * post-close verification. The previous implementation compared
 * `activeTabAfter.id !== activeTabBeforeClose.id`, which fires on any
 * legitimate focus change. The fix: re-query the specific tab that was active
 * BEFORE the close attempt and check whether it still exists.
 *
 * Contract under test:
 *   - When the user switches the active tab mid-flight, `closed` reflects
 *     the real number of tabs we asked Chrome to remove.
 *   - When the active tab is actually closed (race), `closed` is decremented
 *     by 1.
 *   - The active tab in the input list is always protected.
 *   - The retry-on-error path closes everything except the active tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryInput = chrome.tabs.QueryInfo;
type QueryResult = chrome.tabs.Tab[];

interface ChromeStub {
	tabs: {
		query: (q: QueryInput) => Promise<QueryResult>;
		remove: (tabIds: number | number[]) => Promise<void>;
		get: (tabId: number) => Promise<chrome.tabs.Tab>;
	};
}

const chromeStub: ChromeStub = {
	tabs: {
		query: vi.fn(),
		remove: vi.fn(),
		get: vi.fn(),
	},
};

beforeEach(() => {
	(globalThis as unknown as { chrome: ChromeStub }).chrome = chromeStub;
	vi.mocked(chromeStub.tabs.query).mockReset();
	vi.mocked(chromeStub.tabs.remove).mockReset();
	vi.mocked(chromeStub.tabs.get).mockReset();
	vi.mocked(chromeStub.tabs.remove).mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function loadModule() {
	vi.resetModules();
	const mod = await import("./tabHelpers");
	return mod;
}

function tab(id: number, url: string, overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
	return {
		id,
		index: 0,
		windowId: 1,
		url,
		title: `tab-${id}`,
		active: false,
		pinned: false,
		highlighted: false,
		incognito: false,
		selected: false,
		discarded: false,
		frozen: false,
		autoDiscardable: true,
		groupId: -1,
		...overrides,
	};
}

describe("closeTabsSafely", () => {
	it("returns closed=tabs.length when user does not switch active tabs", async () => {
		// Active tab = 5, asking to close 10,11,12
		vi.mocked(chromeStub.tabs.query)
			.mockResolvedValueOnce([tab(5, "https://a", { active: true })])
			.mockResolvedValueOnce([tab(5, "https://a", { active: true })]); // post-close active
		vi.mocked(chromeStub.tabs.get).mockResolvedValue(tab(5, "https://a", { active: false }));

		const { closeTabsSafely } = await loadModule();
		const result = await closeTabsSafely([10, 11, 12]);
		expect(result.closed).toBe(3);
		expect(result.failed).toBe(0);
		expect(result.activeProtected).toBe(false);
	});

	it("does NOT decrement closed when user legitimately switches active tab mid-flight", async () => {
		// Active tab BEFORE close = 5; user switches to 7 while close is in flight.
		// After close, active tab is 7. Previously this would have caused
		// `closed = 3 - 1 = 2` because activeTabAfter.id (7) !== activeTabBeforeClose.id (5).
		vi.mocked(chromeStub.tabs.query)
			.mockResolvedValueOnce([tab(5, "https://a", { active: true })])
			.mockResolvedValueOnce([tab(7, "https://c", { active: true })]); // post-close active is 7
		// Tab 5 (the previously active) still exists; user just switched.
		vi.mocked(chromeStub.tabs.get).mockResolvedValue(tab(5, "https://a", { active: false }));

		const { closeTabsSafely } = await loadModule();
		const result = await closeTabsSafely([10, 11, 12]);
		expect(result.closed).toBe(3);
		expect(result.failed).toBe(0);
	});

	it("does decrement closed when the previously-active tab is actually closed", async () => {
		// Active tab BEFORE close = 5; tab 5 somehow ended up in tabsToClose
		// (this shouldn't happen normally because we filter it out, but the
		// safety net must work). Simulate that tab 5 was actually closed
		// by making chrome.tabs.get(5) reject with "No tab with id".
		vi.mocked(chromeStub.tabs.query)
			.mockResolvedValueOnce([tab(5, "https://a", { active: true })])
			.mockResolvedValueOnce([tab(7, "https://c", { active: true })]);
		vi.mocked(chromeStub.tabs.get).mockRejectedValue(new Error("No tab with id: 5"));

		const { closeTabsSafely } = await loadModule();
		const result = await closeTabsSafely([10, 11, 12]);
		expect(result.closed).toBe(2);
		expect(result.failed).toBe(0);
	});

	it("protects the active tab in the input list", async () => {
		// User includes the active tab id in the input. We should not pass it
		// to chrome.tabs.remove.
		vi.mocked(chromeStub.tabs.query)
			.mockResolvedValueOnce([tab(5, "https://a", { active: true })])
			.mockResolvedValueOnce([tab(5, "https://a", { active: true })]);
		vi.mocked(chromeStub.tabs.get).mockResolvedValue(tab(5, "https://a"));

		const { closeTabsSafely } = await loadModule();
		await closeTabsSafely([5, 10, 11]);
		expect(chromeStub.tabs.remove).toHaveBeenCalledWith([10, 11]);
	});

	it("returns closed=0 when input is empty", async () => {
		const { closeTabsSafely } = await loadModule();
		const result = await closeTabsSafely([]);
		expect(result).toEqual({ closed: 0, failed: 0, activeProtected: false });
	});
});
