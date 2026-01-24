import type { ExportFormat, ExtractedData, HistoryEntry, SearchQuery } from "../types";

const HISTORY_KEY = "mimir_history";
const MAX_HISTORY_ENTRIES = 100;
const QUOTA_LIMIT_BYTES = 5 * 1024 * 1024; // 5MB limit for history

/**
 * Generate a unique ID for a history entry
 */
function generateId(): string {
	return `${Date.now()}-${crypto.randomUUID()}`;
}

/**
 * Calculate the size of data in bytes
 */
function calculateDataSize(data: unknown): number {
	return new Blob([JSON.stringify(data)]).size;
}

/**
 * Extract unique domains from extracted data
 */
function extractDomains(data: ExtractedData[]): string[] {
	const domains = new Set<string>();
	for (const item of data) {
		try {
			const url = new URL(item.url);
			domains.add(url.hostname);
		} catch {
			// Invalid URL, skip
		}
	}
	return Array.from(domains);
}

/**
 * Save a history entry to Chrome storage
 */
export async function saveHistoryEntry(
	entry: Omit<HistoryEntry, "id" | "dataSize"> & { data: ExtractedData[] },
): Promise<HistoryEntry | null> {
	try {
		const history = await getHistoryEntries();

		// Calculate data size
		const dataSize = calculateDataSize(entry.data);

		// Check if entry is too large
		if (dataSize > QUOTA_LIMIT_BYTES) {
			console.warn("History entry exceeds size limit, skipping save");
			return null;
		}

		// Create new entry
		const newEntry: HistoryEntry = {
			id: generateId(),
			dataSize,
			...entry,
		};

		// Add to beginning of history
		history.unshift(newEntry);

		// Enforce max limit
		if (history.length > MAX_HISTORY_ENTRIES) {
			const removed = history.splice(MAX_HISTORY_ENTRIES);
			console.info(`Removed ${removed.length} old history entries to maintain limit`);
		}

		// Save to storage
		await chrome.storage.local.set({ [HISTORY_KEY]: history });

		return newEntry;
	} catch (err) {
		if (err instanceof Error && err.message.includes("QUOTA")) {
			console.warn("Storage quota exceeded, attempting cleanup...");

			// Try to clean up old entries and retry
			await cleanupOldHistory(Math.floor(MAX_HISTORY_ENTRIES / 2));

			// Retry once after cleanup
			try {
				const history = await getHistoryEntries();
				const dataSize = calculateDataSize(entry.data);
				const newEntry: HistoryEntry = {
					id: generateId(),
					dataSize,
					...entry,
				};
				history.unshift(newEntry);

				if (history.length > MAX_HISTORY_ENTRIES) {
					history.splice(MAX_HISTORY_ENTRIES);
				}

				await chrome.storage.local.set({ [HISTORY_KEY]: history });
				return newEntry;
			} catch (retryErr) {
				console.error("Failed to save history entry after cleanup:", retryErr);
				return null;
			}
		} else {
			console.error("Failed to save history entry:", err);
			return null;
		}
	}
}

/**
 * Get all history entries
 */
export async function getHistoryEntries(limit?: number): Promise<HistoryEntry[]> {
	try {
		const result = await chrome.storage.local.get([HISTORY_KEY]);
		const history = (result[HISTORY_KEY] as HistoryEntry[]) || [];

		// Validate and filter corrupted entries
		const validHistory = history.filter((entry): entry is HistoryEntry => {
			return (
				entry &&
				typeof entry === "object" &&
				typeof entry.id === "string" &&
				typeof entry.timestamp === "number" &&
				typeof entry.format === "string" &&
				Array.isArray(entry.data)
			);
		});

		// Sort by timestamp descending (newest first)
		validHistory.sort((a, b) => b.timestamp - a.timestamp);

		return limit ? validHistory.slice(0, limit) : validHistory;
	} catch (err) {
		console.error("Failed to get history entries:", err);
		return [];
	}
}

/**
 * Get a specific history entry by ID
 */
export async function getHistoryEntry(id: string): Promise<HistoryEntry | null> {
	try {
		const history = await getHistoryEntries();
		return history.find((entry) => entry.id === id) || null;
	} catch (err) {
		console.error("Failed to get history entry:", err);
		return null;
	}
}

/**
 * Delete a specific history entry
 */
export async function deleteHistoryEntry(id: string): Promise<boolean> {
	try {
		const history = await getHistoryEntries();
		const filtered = history.filter((entry) => entry.id !== id);

		if (filtered.length === history.length) {
			return false; // Entry not found
		}

		await chrome.storage.local.set({ [HISTORY_KEY]: filtered });
		return true;
	} catch (err) {
		console.error("Failed to delete history entry:", err);
		return false;
	}
}

/**
 * Delete all history entries
 */
export async function deleteAllHistory(): Promise<boolean> {
	try {
		await chrome.storage.local.remove([HISTORY_KEY]);
		return true;
	} catch (err) {
		console.error("Failed to delete all history:", err);
		return false;
	}
}

/**
 * Search history entries based on query
 */
export async function searchHistory(query: SearchQuery): Promise<HistoryEntry[]> {
	try {
		let entries = await getHistoryEntries();

		// Filter by keywords
		const keywordValue = query.keywords?.trim();
		if (keywordValue) {
			const keywords = keywordValue.toLowerCase();
			entries = entries.filter((entry) => {
				// Search in domains
				if (entry.domains.some((d) => d.toLowerCase().includes(keywords))) {
					return true;
				}

				// Search in data titles and content
				return entry.data.some(
					(item) =>
						item.title.toLowerCase().includes(keywords) ||
						item.text.toLowerCase().includes(keywords) ||
						item.url.toLowerCase().includes(keywords),
				);
			});
		}

		// Filter by date range
		const dateFrom = query.dateFrom;
		if (dateFrom !== undefined) {
			entries = entries.filter((entry) => entry.timestamp >= dateFrom);
		}

		const dateTo = query.dateTo;
		if (dateTo !== undefined) {
			entries = entries.filter((entry) => entry.timestamp <= dateTo);
		}

		// Filter by domains
		if (query.domains && query.domains.length > 0) {
			const searchDomains = new Set(query.domains.map((d) => d.toLowerCase()));
			entries = entries.filter((entry) => entry.domains.some((d) => searchDomains.has(d.toLowerCase())));
		}

		return entries;
	} catch (err) {
		console.error("Failed to search history:", err);
		return [];
	}
}

/**
 * Get the count of history entries
 */
export async function getHistoryCount(): Promise<number> {
	try {
		const history = await getHistoryEntries();
		return history.length;
	} catch (err) {
		console.error("Failed to get history count:", err);
		return 0;
	}
}

/**
 * Get total storage size used by history in bytes
 */
export async function getHistorySize(): Promise<number> {
	try {
		const result = await chrome.storage.local.get([HISTORY_KEY]);
		if (!result[HISTORY_KEY]) {
			return 0;
		}
		return calculateDataSize(result[HISTORY_KEY]);
	} catch (err) {
		console.error("Failed to get history size:", err);
		return 0;
	}
}

/**
 * Clean up old history entries beyond the max limit
 */
export async function cleanupOldHistory(maxEntries: number = MAX_HISTORY_ENTRIES): Promise<void> {
	try {
		const history = await getHistoryEntries();

		if (history.length <= maxEntries) {
			return; // No cleanup needed
		}

		// Keep only the newest entries
		const trimmed = history.slice(0, maxEntries);
		await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });

		console.info(`Cleaned up ${history.length - maxEntries} old history entries`);
	} catch (err) {
		console.error("Failed to cleanup old history:", err);
	}
}

/**
 * Extract all unique domains from history
 */
export async function getHistoryDomains(): Promise<string[]> {
	try {
		const history = await getHistoryEntries();
		const domains = new Set<string>();

		for (const entry of history) {
			for (const domain of entry.domains) {
				domains.add(domain);
			}
		}

		return Array.from(domains).sort();
	} catch (err) {
		console.error("Failed to get history domains:", err);
		return [];
	}
}

/**
 * Create a history entry from extracted data
 */
export function createHistoryEntry(
	data: ExtractedData[],
	format: ExportFormat,
	exportType: "clipboard" | "file",
	filename?: string,
): Omit<HistoryEntry, "id" | "dataSize"> & { data: ExtractedData[] } {
	return {
		timestamp: Date.now(),
		format,
		exportType,
		tabCount: data.length,
		domains: extractDomains(data),
		data,
		filename,
	};
}
