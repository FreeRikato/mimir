import { SubtitleError } from "../types";

export function isXTweetUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.replace(/^www\./, "");
		if (hostname !== "x.com" && hostname !== "twitter.com") return false;
		return /\/status\/\d+/.test(parsed.pathname);
	} catch {
		return false;
	}
}

export function parseXTweetId(url: string): string | null {
	try {
		const match = new URL(url).pathname.match(/\/status\/(\d+)/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

// ── GraphQL response types (defensive — all fields optional) ──────────────────

interface TweetLegacy {
	full_text?: string;
	created_at?: string;
	favorite_count?: number;
	retweet_count?: number;
	reply_count?: number;
	conversation_id_str?: string;
	id_str?: string;
	in_reply_to_screen_name?: string;
}

interface UserLegacy {
	name?: string;
	screen_name?: string;
}

interface TweetResult {
	__typename?: string;
	legacy?: TweetLegacy;
	core?: {
		user_results?: {
			result?: {
				legacy?: UserLegacy;
			};
		};
	};
	tweet?: TweetResult; // tombstoned tweets wrap in .tweet
}

interface ItemContent {
	itemType?: string;
	tweet_results?: {
		result?: TweetResult;
	};
}

interface TimelineItem {
	itemContent?: ItemContent;
}

interface TimelineEntry {
	entryId?: string;
	content?: {
		entryType?: string;
		itemContent?: ItemContent; // TimelineTimelineItem
		items?: Array<{ item?: TimelineItem }>; // TimelineTimelineModule
	};
}

interface TimelineInstruction {
	type?: string;
	entries?: TimelineEntry[];
}

interface TweetDetailResponse {
	data?: {
		threaded_conversation_with_injections_v2?: {
			instructions?: TimelineInstruction[];
		};
	};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveTweetResult(raw: TweetResult | undefined): TweetResult | null {
	if (!raw) return null;
	// Tombstoned/restricted tweets are nested under .tweet
	return raw.__typename === "TweetWithVisibilityResults" && raw.tweet ? raw.tweet : raw;
}

function formatDate(createdAt: string): string {
	try {
		return new Date(createdAt).toISOString().split("T")[0];
	} catch {
		return createdAt;
	}
}

function formatTweetBlock(result: TweetResult, index: number, isMain: boolean): string | null {
	const legacy = result.legacy;
	const userLegacy = result.core?.user_results?.result?.legacy;

	if (!legacy?.full_text) return null;

	const author = userLegacy?.screen_name ? `@${userLegacy.screen_name}` : "unknown";
	const displayName = userLegacy?.name ?? author;
	const date = legacy.created_at ? formatDate(legacy.created_at) : "";
	const likes = legacy.favorite_count ?? 0;
	const retweets = legacy.retweet_count ?? 0;
	const replies = legacy.reply_count ?? 0;

	// Strip trailing media/card URLs (t.co links at end of full_text)
	const text = legacy.full_text.replace(/https:\/\/t\.co\/\S+$/, "").trim();

	if (isMain) {
		return [`# ${displayName} (${author})`, ``, `${date} | ♥ ${likes} | 🔁 ${retweets} | 💬 ${replies}`, ``, text].join(
			"\n",
		);
	}

	const prefix = index === 0 ? "" : `[${index}] `;
	return [`${prefix}${author} | ${date} | ♥ ${likes}`, text].join("\n");
}

function extractItemContent(itemContent: ItemContent | undefined): TweetResult | null {
	if (!itemContent) return null;
	return resolveTweetResult(itemContent.tweet_results?.result);
}

// ── Main formatter ────────────────────────────────────────────────────────────

export function formatXThread(rawData: unknown, tweetId: string): { title: string; text: string; mainFound: boolean } {
	const data = rawData as TweetDetailResponse;
	const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions ?? [];

	const addEntries = instructions.find((i) => i.type === "TimelineAddEntries");
	const entries: TimelineEntry[] = addEntries?.entries ?? [];

	const tweetBlocks: string[] = [];
	let mainTweetTitle = `Tweet ${tweetId}`;
	let mainFound = false;
	let replyIndex = 0;

	for (const entry of entries) {
		const entryId = entry.entryId ?? "";
		const content = entry.content;
		if (!content) continue;

		// Skip cursor entries
		if (entryId.startsWith("cursor-") || entryId.includes("-cursor-")) continue;

		const isMainTweet = entryId === `tweet-${tweetId}` || entryId.startsWith(`tweet-${tweetId}`);

		if (content.entryType === "TimelineTimelineItem" || !content.entryType) {
			// Single tweet entry
			const result = extractItemContent(content.itemContent);
			if (!result) continue;

			if (isMainTweet && !mainFound) {
				const block = formatTweetBlock(result, 0, true);
				if (block) {
					mainTweetTitle =
						result.core?.user_results?.result?.legacy?.name ??
						`@${result.core?.user_results?.result?.legacy?.screen_name ?? tweetId}`;
					tweetBlocks.unshift(block);
					mainFound = true;
				}
			} else {
				const block = formatTweetBlock(result, ++replyIndex, false);
				if (block) tweetBlocks.push(block);
			}
		} else if (content.entryType === "TimelineTimelineModule") {
			// Inline threaded group (self-thread replies shown together)
			const items = content.items ?? [];
			for (const item of items) {
				const result = extractItemContent(item.item?.itemContent);
				if (!result) continue;

				if (isMainTweet && !mainFound) {
					const block = formatTweetBlock(result, 0, true);
					if (block) {
						mainTweetTitle =
							result.core?.user_results?.result?.legacy?.name ??
							`@${result.core?.user_results?.result?.legacy?.screen_name ?? tweetId}`;
						tweetBlocks.unshift(block);
						mainFound = true;
					}
				} else {
					const block = formatTweetBlock(result, ++replyIndex, false);
					if (block) tweetBlocks.push(block);
				}
			}
		}
	}

	if (tweetBlocks.length === 0) {
		throw new SubtitleError(
			"No tweet content found in captured data. The tweet may be protected or the page may not have fully loaded.",
			"PARSE_ERROR",
			undefined,
		);
	}

	const separator = `\n\n---\n\n`;
	const replySectionHeader = replyIndex > 0 ? `\n\n## Replies\n\n` : "";

	const mainBlock = tweetBlocks[0];
	const replyBlocks = tweetBlocks.slice(1);

	const text = mainBlock + (replyBlocks.length > 0 ? replySectionHeader + replyBlocks.join(separator) : "");

	return { title: mainTweetTitle, text, mainFound };
}

// ── executeScript bridge (serialisable, runs in MAIN world) ──────────────────

// This function is passed verbatim to chrome.scripting.executeScript — keep it
// self-contained with no closure references.
export function readXDataFromPage(tweetId: string): unknown | null {
	const store = (window as Window & { __mimiXData?: Record<string, unknown> }).__mimiXData;
	return store?.[tweetId] ?? null;
}
