/**
 * History storage - now backed by IndexedDB
 *
 * This file re-exports the IndexedDB implementation for backward compatibility.
 * The actual implementation is in indexeddb.ts
 */

export {
	cleanupOldHistory,
	createHistoryEntry,
	deleteAllHistory,
	deleteHistoryEntry,
	getHistoryCount,
	getHistoryDomains,
	getHistoryEntries,
	getHistoryEntry,
	getHistorySize,
	migrateHistory,
	needsMigration,
	saveHistoryEntry,
	searchHistory,
} from "./indexeddb";
