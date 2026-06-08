import { SubtitleError } from "../types";

// Reddit API response types
interface RedditListing {
	kind: "Listing";
	data: {
		children: RedditChild[];
		after: string | null;
	};
}

interface RedditPostData {
	id: string;
	title: string;
	author: string;
	subreddit: string;
	score: number;
	selftext: string;
	url: string;
	created_utc: number;
	is_self: boolean;
	permalink: string;
}

interface RedditCommentData {
	id: string;
	author: string;
	body: string;
	score: number;
	depth: number;
	parent_id: string;
	replies: RedditListing | "";
}

interface RedditMoreData {
	id: string;
	parent_id: string;
	children: string[];
	count: number;
}

type RedditChild =
	| { kind: "t3"; data: RedditPostData }
	| { kind: "t1"; data: RedditCommentData }
	| { kind: "more"; data: RedditMoreData };

export interface RedditFetchOptions {
	signal?: AbortSignal;
	// max number of morechildren API calls (each handles up to 100 child IDs)
	maxMoreCalls?: number;
}

export function isRedditPostUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.replace(/^(www\.|old\.|new\.)/, "");
		if (hostname !== "reddit.com") return false;
		return /^\/r\/[^/]+\/comments\/[^/]+/.test(parsed.pathname);
	} catch {
		return false;
	}
}

function parseRedditUrl(url: string): { subreddit: string; postId: string } | null {
	try {
		const parsed = new URL(url);
		const match = parsed.pathname.match(/^\/r\/([^/]+)\/comments\/([^/]+)/);
		if (!match?.[1] || !match?.[2]) return null;
		return { subreddit: match[1], postId: match[2] };
	} catch {
		return null;
	}
}

function formatDate(utcSeconds: number): string {
	return new Date(utcSeconds * 1000).toISOString().split("T")[0];
}

function indent(text: string, depth: number): string {
	if (depth === 0) return text;
	const pad = "  ".repeat(depth);
	return text
		.split("\n")
		.map((line) => pad + line)
		.join("\n");
}

function formatComment(data: RedditCommentData): string {
	const header = `u/${data.author} | Score: ${data.score}`;
	const body = data.body.trim();
	return indent(`${header}\n${body}`, data.depth);
}

function isDeletedOrRemoved(body: string): boolean {
	return body === "[deleted]" || body === "[removed]" || body.trim() === "";
}

interface TraverseResult {
	lines: string[];
	moreStubs: Array<{ childIds: string[] }>;
}

function traverseComments(children: RedditChild[]): TraverseResult {
	const lines: string[] = [];
	const moreStubs: Array<{ childIds: string[] }> = [];

	for (const child of children) {
		if (child.kind === "t1") {
			const { data } = child;
			if (isDeletedOrRemoved(data.body)) continue;

			lines.push(formatComment(data));
			lines.push("");

			if (data.replies && typeof data.replies !== "string" && data.replies.data?.children?.length > 0) {
				const nested = traverseComments(data.replies.data.children);
				lines.push(...nested.lines);
				moreStubs.push(...nested.moreStubs);
			}
		} else if (child.kind === "more") {
			const { data } = child;
			// id === "_" means "continue this thread" deep link — too expensive, skip
			if (data.id !== "_" && data.children.length > 0) {
				moreStubs.push({ childIds: data.children });
			}
		}
	}

	return { lines, moreStubs };
}

async function fetchMoreChildren(
	postId: string,
	childIds: string[],
	signal?: AbortSignal,
): Promise<RedditCommentData[]> {
	const CHUNK_SIZE = 100;
	const INTER_CALL_DELAY_MS = 500;
	const results: RedditCommentData[] = [];

	for (let i = 0; i < childIds.length; i += CHUNK_SIZE) {
		if (signal?.aborted) break;

		const chunk = childIds.slice(i, i + CHUNK_SIZE);
		const params = new URLSearchParams({
			link_id: `t3_${postId}`,
			children: chunk.join(","),
			api_type: "json",
		});

		try {
			const response = await fetch(`https://www.reddit.com/api/morechildren.json?${params}`, {
				signal,
				headers: { Accept: "application/json" },
			});

			if (!response.ok) break;

			const json = await response.json();
			const things: RedditChild[] = json?.json?.data?.things ?? [];

			for (const thing of things) {
				if (thing.kind === "t1") {
					results.push(thing.data);
				}
			}
		} catch {
			// Non-fatal: return what we have so far
			break;
		}

		if (i + CHUNK_SIZE < childIds.length) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, INTER_CALL_DELAY_MS);
				signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
			});
		}
	}

	return results;
}

export async function fetchRedditPost(
	url: string,
	options: RedditFetchOptions = {},
): Promise<{ title: string; text: string }> {
	const { signal, maxMoreCalls = 3 } = options;

	const parsed = parseRedditUrl(url);
	if (!parsed) {
		throw new SubtitleError("Invalid Reddit post URL", "INVALID_URL", undefined, url);
	}

	const { subreddit, postId } = parsed;
	const apiUrl = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=500&raw_json=1`;

	let response: Response;
	try {
		response = await fetch(apiUrl, {
			signal,
			headers: { Accept: "application/json" },
		});
	} catch (err) {
		if (signal?.aborted) {
			throw new SubtitleError("Cancelled", "NETWORK_ERROR", undefined, url);
		}
		throw new SubtitleError(
			`Failed to fetch Reddit post: ${err instanceof Error ? err.message : "Network error"}`,
			"NETWORK_ERROR",
			err instanceof Error ? err : undefined,
			url,
		);
	}

	if (response.status === 429) {
		throw new SubtitleError("Reddit rate limit exceeded. Please try again shortly.", "SERVER_ERROR", undefined, url);
	}
	if (!response.ok) {
		throw new SubtitleError(`Reddit API returned ${response.status}`, "API_ERROR", undefined, url);
	}

	let json: [RedditListing, RedditListing];
	try {
		json = await response.json();
	} catch (err) {
		throw new SubtitleError(
			"Failed to parse Reddit API response",
			"PARSE_ERROR",
			err instanceof Error ? err : undefined,
			url,
		);
	}

	const postChild = json[0]?.data?.children?.[0];
	if (postChild?.kind !== "t3") {
		throw new SubtitleError("Could not find post data in Reddit API response", "PARSE_ERROR", undefined, url);
	}

	const post = postChild.data;
	const commentsListing = json[1];

	const lines: string[] = [
		`# ${post.title}`,
		``,
		`Author: u/${post.author} | r/${post.subreddit} | Score: ${post.score} | ${formatDate(post.created_utc)}`,
		``,
	];

	if (post.is_self && post.selftext?.trim()) {
		lines.push(post.selftext.trim());
		lines.push(``);
	}

	lines.push(`---`);
	lines.push(``);
	lines.push(`## Comments`);
	lines.push(``);

	const { lines: commentLines, moreStubs } = traverseComments(commentsListing?.data?.children ?? []);
	lines.push(...commentLines);

	// Fetch morechildren stubs, capped by maxMoreCalls
	if (moreStubs.length > 0 && !signal?.aborted) {
		const allChildIds = moreStubs.flatMap((s) => s.childIds);
		const uniqueIds = [...new Set(allChildIds)].slice(0, maxMoreCalls * 100);

		if (uniqueIds.length > 0) {
			const moreComments = await fetchMoreChildren(postId, uniqueIds, signal);

			if (moreComments.length > 0) {
				lines.push(``);
				lines.push(`### More Comments`);
				lines.push(``);

				for (const comment of moreComments) {
					if (isDeletedOrRemoved(comment.body)) continue;
					lines.push(formatComment(comment));
					lines.push(``);
				}
			}
		}
	}

	return { title: post.title, text: lines.join("\n") };
}
