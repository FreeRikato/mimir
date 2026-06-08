/**
 * IndexedDB utility for Mimir history storage
 *
 * IndexedDB is used for large content storage (extraction history with full transcripts)
 * chrome.storage.local is kept for small metadata and settings
 */

import type { ExportFormat, ExtractedData, HistoryEntry, SearchQuery } from "../types";
import { entryMatchesDomains } from "./domainFilter";

const DB_NAME = "mimir_history";
const DB_VERSION = 1;
const STORE_NAME = "history";

// Migration flag in chrome.storage.local
const MIGRATION_FLAG_KEY = "mimir_indexeddb_migrated";
const LEGACY_HISTORY_KEY = "mimir_history";

/**
 * IndexedDB connection wrapper
 */
class IndexedDB {
	private db: IDBDatabase | null = null;

	/**
	 * Open the IndexedDB database
	 */
	async open(): Promise<IDBDatabase> {
		if (this.db) {
			return this.db;
		}

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve(this.db);
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Create history object store with timestamp as key path for efficient sorting
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });

					// Create indexes for efficient querying
					store.createIndex("timestamp", "timestamp", { unique: false });
					store.createIndex("format", "format", { unique: false });
					store.createIndex("exportType", "exportType", { unique: false });
				}
			};
		});
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	/**
	 * Get the object store for operations
	 */
	private async getStore(mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
		const db = await this.open();
		const transaction = db.transaction([STORE_NAME], mode);
		return transaction.objectStore(STORE_NAME);
	}

	/**
	 * Add a new history entry
	 */
	async add(entry: HistoryEntry): Promise<HistoryEntry> {
		const store = await this.getStore("readwrite");

		return new Promise((resolve, reject) => {
			const request = store.add(entry);

			request.onsuccess = () => resolve(entry);
			request.onerror = () => reject(new Error(`Failed to add entry: ${request.error?.message}`));
		});
	}

	/**
	 * Get all history entries, optionally limited
	 */
	async getAll(limit?: number): Promise<HistoryEntry[]> {
		const store = await this.getStore("readonly");

		return new Promise((resolve, reject) => {
			const request = store.getAll();

			request.onsuccess = () => {
				let entries = request.result as HistoryEntry[];

				// Sort by timestamp descending (newest first)
				entries.sort((a, b) => b.timestamp - a.timestamp);

				// Validate entries
				entries = entries.filter(
					(entry): entry is HistoryEntry =>
						entry &&
						typeof entry === "object" &&
						typeof entry.id === "string" &&
						typeof entry.timestamp === "number" &&
						typeof entry.format === "string" &&
						Array.isArray(entry.data),
				);

				if (limit) {
					entries = entries.slice(0, limit);
				}

				resolve(entries);
			};

			request.onerror = () => reject(new Error(`Failed to get entries: ${request.error?.message}`));
		});
	}

	/**
	 * Get a specific history entry by ID
	 */
	async get(id: string): Promise<HistoryEntry | null> {
		const store = await this.getStore("readonly");

		return new Promise((resolve, reject) => {
			const request = store.get(id);

			request.onsuccess = () => {
				const entry = request.result as HistoryEntry | undefined;
				resolve(entry || null);
			};

			request.onerror = () => reject(new Error(`Failed to get entry: ${request.error?.message}`));
		});
	}

	/**
	 * Delete a history entry by ID
	 */
	async delete(id: string): Promise<boolean> {
		const store = await this.getStore("readwrite");

		return new Promise((resolve, reject) => {
			const request = store.delete(id);

			request.onsuccess = () => resolve(true);
			request.onerror = () => {
				if (request.error?.name === "NotFoundError") {
					resolve(false); // Entry didn't exist
				} else {
					reject(new Error(`Failed to delete entry: ${request.error?.message}`));
				}
			};
		});
	}

	/**
	 * Clear all history entries
	 */
	async clear(): Promise<boolean> {
		const store = await this.getStore("readwrite");

		return new Promise((resolve, reject) => {
			const request = store.clear();

			request.onsuccess = () => resolve(true);
			request.onerror = () => reject(new Error(`Failed to clear store: ${request.error?.message}`));
		});
	}

	/**
	 * Get the count of history entries
	 */
	async count(): Promise<number> {
		const store = await this.getStore("readonly");

		return new Promise((resolve, reject) => {
			const request = store.count();

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(new Error(`Failed to count entries: ${request.error?.message}`));
		});
	}

	/**
	 * Search history entries based on query
	 */
	async search(query: SearchQuery): Promise<HistoryEntry[]> {
		let entries = await this.getAll();

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
		if (query.dateFrom !== undefined) {
			const from = query.dateFrom;
			entries = entries.filter((entry) => entry.timestamp >= from);
		}

		if (query.dateTo !== undefined) {
			const to = query.dateTo;
			entries = entries.filter((entry) => entry.timestamp <= to);
		}

		// Filter by domains. Bug 1.10: also fall back to each item's URL
		// hostname so a stale `entry.domains` (e.g. saved before a URL hostname
		// change) doesn't cause a miss.
		if (query.domains && query.domains.length > 0) {
			entries = entries.filter((entry) => entryMatchesDomains(entry, query.domains ?? []));
		}

		return entries;
	}

	/**
	 * Get all unique domains from history
	 */
	async getDomains(): Promise<string[]> {
		const entries = await this.getAll();
		const domains = new Set<string>();

		for (const entry of entries) {
			for (const domain of entry.domains) {
				domains.add(domain);
			}
		}

		return Array.from(domains).sort();
	}

	/**
	 * Calculate the size of data in bytes (approximate for IndexedDB)
	 */
	calculateDataSize(data: unknown): number {
		return new Blob([JSON.stringify(data)]).size;
	}
}

// Singleton instance
const indexedDBInstance = new IndexedDB();

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
 * Check if migration from chrome.storage.local is needed
 */
export async function needsMigration(): Promise<boolean> {
	try {
		const result = await chrome.storage.local.get([MIGRATION_FLAG_KEY, LEGACY_HISTORY_KEY]);
		// Need migration if legacy data exists and migration hasn't been marked complete
		return !!(result[LEGACY_HISTORY_KEY] && !result[MIGRATION_FLAG_KEY]);
	} catch {
		return false;
	}
}

/**
 * Migrate history from chrome.storage.local to IndexedDB
 */
export async function migrateHistory(): Promise<void> {
	try {
		const result = await chrome.storage.local.get([LEGACY_HISTORY_KEY]);
		const legacyHistory = result[LEGACY_HISTORY_KEY] as HistoryEntry[] | undefined;

		if (!legacyHistory || legacyHistory.length === 0) {
			// Mark as migrated even if empty
			await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true });
			return;
		}

		// Validate and migrate each entry
		let migratedCount = 0;
		for (const entry of legacyHistory) {
			if (
				entry &&
				typeof entry === "object" &&
				typeof entry.id === "string" &&
				typeof entry.timestamp === "number" &&
				typeof entry.format === "string" &&
				Array.isArray(entry.data)
			) {
				try {
					await indexedDBInstance.add(entry);
					migratedCount++;
				} catch (err) {
					console.error(`Failed to migrate entry ${entry.id}:`, err);
				}
			}
		}

		console.info(`Migrated ${migratedCount} history entries to IndexedDB`);

		// Mark migration as complete
		await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true });

		// Optionally clear legacy data after successful migration
		// We keep it for now as a backup
		// await chrome.storage.local.remove([LEGACY_HISTORY_KEY]);
	} catch (err) {
		console.error("Failed to migrate history:", err);
		throw err;
	}
}

/**
 * Ensure migration has been performed before accessing IndexedDB
 */
async function ensureMigrated(): Promise<void> {
	if (await needsMigration()) {
		await migrateHistory();
	}
}

/**
 * Save a history entry to IndexedDB
 */
export async function saveHistoryEntry(
	entry: Omit<HistoryEntry, "id" | "dataSize"> & { data: ExtractedData[] },
): Promise<HistoryEntry | null> {
	await ensureMigrated();

	try {
		// Calculate data size
		const dataSize = calculateDataSize(entry.data);

		// Create new entry
		const newEntry: HistoryEntry = {
			id: generateId(),
			dataSize,
			...entry,
		};

		await indexedDBInstance.add(newEntry);
		return newEntry;
	} catch (err) {
		console.error("Failed to save history entry:", err);
		return null;
	}
}

/**
 * Get all history entries
 */
export async function getHistoryEntries(limit?: number): Promise<HistoryEntry[]> {
	await ensureMigrated();

	try {
		return await indexedDBInstance.getAll(limit);
	} catch (err) {
		console.error("Failed to get history entries:", err);
		return [];
	}
}

/**
 * Get a specific history entry by ID
 */
export async function getHistoryEntry(id: string): Promise<HistoryEntry | null> {
	await ensureMigrated();

	try {
		return await indexedDBInstance.get(id);
	} catch (err) {
		console.error("Failed to get history entry:", err);
		return null;
	}
}

/**
 * Delete a specific history entry
 */
export async function deleteHistoryEntry(id: string): Promise<boolean> {
	await ensureMigrated();

	try {
		return await indexedDBInstance.delete(id);
	} catch (err) {
		console.error("Failed to delete history entry:", err);
		return false;
	}
}

/**
 * Delete all history entries
 */
export async function deleteAllHistory(): Promise<boolean> {
	await ensureMigrated();

	try {
		return await indexedDBInstance.clear();
	} catch (err) {
		console.error("Failed to delete all history:", err);
		return false;
	}
}

/**
 * Search history entries based on query
 */
export async function searchHistory(query: SearchQuery): Promise<HistoryEntry[]> {
	await ensureMigrated();

	try {
		return await indexedDBInstance.search(query);
	} catch (err) {
		console.error("Failed to search history:", err);
		return [];
	}
}

/**
 * Get the count of history entries
 */
export async function getHistoryCount(): Promise<number> {
	await ensureMigrated();

	try {
		return await indexedDBInstance.count();
	} catch (err) {
		console.error("Failed to get history count:", err);
		return 0;
	}
}

/**
 * Get total storage size used by history (approximate)
 */
export async function getHistorySize(): Promise<number> {
	try {
		const entries = await getHistoryEntries();
		return entries.reduce((total, entry) => total + (entry.dataSize || 0), 0);
	} catch (err) {
		console.error("Failed to get history size:", err);
		return 0;
	}
}

/**
 * Extract all unique domains from history
 */
export async function getHistoryDomains(): Promise<string[]> {
	await ensureMigrated();

	try {
		return await indexedDBInstance.getDomains();
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

/**
 * Cleanup function - no longer needed with IndexedDB
 * Kept for API compatibility
 */
export async function cleanupOldHistory(_maxEntries: number = 100): Promise<void> {
	// IndexedDB doesn't have strict quota limits, so cleanup is optional
	// We keep this as a no-op for API compatibility
	console.info("cleanupOldHistory called - no-op with IndexedDB storage");
}
