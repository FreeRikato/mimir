import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleError } from "../types";
import { fetchRedditPost } from "./reddit";

const VALID_URL = "https://www.reddit.com/r/programming/comments/abc123/some_post/";

function makePostResponse(overrides: { comments?: unknown; is_self?: boolean; selftext?: string } = {}): Response {
	const isSelf = overrides.is_self ?? false;
	const selftext = overrides.selftext ?? "";
	const comments = overrides.comments ?? [];
	const body = JSON.stringify([
		{
			kind: "Listing",
			data: {
				children: [
					{
						kind: "t3",
						data: {
							id: "abc123",
							title: "Hello",
							author: "alice",
							subreddit: "programming",
							score: 1,
							selftext,
							url: "https://example.com",
							created_utc: 1700000000,
							is_self: isSelf,
							permalink: "/r/programming/comments/abc123/some_post/",
						},
					},
				],
			},
		},
		{
			kind: "Listing",
			data: { children: comments, after: null },
		},
	]);
	return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
}

function make429(retryAfter?: string): Response {
	return new Response("rate limited", {
		status: 429,
		headers: retryAfter ? { "Retry-After": retryAfter } : {},
	});
}

describe("fetchRedditPost (ERR-4: 429 Retry-After)", () => {
	const originalFetch = global.fetch;
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		global.fetch = originalFetch;
	});

	it("retries once after Retry-After seconds and succeeds on the second attempt", async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockImplementationOnce(() => Promise.resolve(make429("1")))
			.mockImplementationOnce(() => Promise.resolve(makePostResponse({ is_self: true, selftext: "body" })));
		global.fetch = fetchMock as unknown as typeof fetch;

		const promise = fetchRedditPost(VALID_URL);
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(result.title).toBe("Hello");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("throws a SERVER_ERROR SubtitleError if Retry-After is missing or unparseable", async () => {
		const fetchMock = vi.fn<() => Promise<Response>>().mockImplementation(() => Promise.resolve(make429()));
		global.fetch = fetchMock as unknown as typeof fetch;

		await expect(fetchRedditPost(VALID_URL)).rejects.toMatchObject({ code: "SERVER_ERROR" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not wait for absurdly large Retry-After values (> 60 s)", async () => {
		const fetchMock = vi.fn<() => Promise<Response>>().mockImplementation(() => Promise.resolve(make429("300")));
		global.fetch = fetchMock as unknown as typeof fetch;

		await expect(fetchRedditPost(VALID_URL)).rejects.toMatchObject({ code: "SERVER_ERROR" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("fetchRedditPost (ERR-8: empty payload throws NO_SUBTITLES)", () => {
	const originalFetch = global.fetch;
	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("throws NO_SUBTITLES when there is no body, no comments, and no more-children", async () => {
		global.fetch = vi
			.fn<() => Promise<Response>>()
			.mockImplementation(() =>
				Promise.resolve(makePostResponse({ is_self: false, selftext: "" })),
			) as unknown as typeof fetch;

		await expect(fetchRedditPost(VALID_URL)).rejects.toMatchObject({ code: "NO_SUBTITLES" });
	});

	it("returns a result when the post has at least one comment", async () => {
		const comments = [
			{
				kind: "t1",
				data: {
					id: "c1",
					author: "bob",
					body: "Hi",
					score: 1,
					depth: 0,
					parent_id: "t3_abc123",
					replies: "",
				},
			},
		];
		global.fetch = vi
			.fn<() => Promise<Response>>()
			.mockImplementation(() => Promise.resolve(makePostResponse({ comments }))) as unknown as typeof fetch;

		const result = await fetchRedditPost(VALID_URL);
		expect(result.text).toContain("Hi");
	});

	it("returns a result when the post has a selftext body even with zero comments", async () => {
		global.fetch = vi
			.fn<() => Promise<Response>>()
			.mockImplementation(() =>
				Promise.resolve(makePostResponse({ is_self: true, selftext: "My thoughts" })),
			) as unknown as typeof fetch;

		const result = await fetchRedditPost(VALID_URL);
		expect(result.text).toContain("My thoughts");
	});
});
