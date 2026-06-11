import { describe, expect, it } from "vitest";
import { formatXThread } from "./xTwitter";

const TWEET_ID = "1234567890";

function buildResponse(entries: Array<{ entryId: string; isMain?: boolean; author?: string; text?: string }>): unknown {
	return {
		data: {
			threaded_conversation_with_injections_v2: {
				instructions: [
					{
						type: "TimelineAddEntries",
						entries: entries.map((e) => ({
							entryId: e.entryId,
							content: {
								entryType: "TimelineTimelineItem",
								itemContent: {
									tweet_results: {
										result: {
											__typename: "Tweet",
											legacy: {
												full_text: e.text ?? "Hello world",
												created_at: "Mon Jan 01 00:00:00 +0000 2024",
												favorite_count: 1,
												retweet_count: 0,
												reply_count: 0,
											},
											core: {
												user_results: {
													result: {
														legacy: {
															screen_name: e.author ?? "alice",
															name: e.author ?? "alice",
														},
													},
												},
											},
										},
									},
								},
							},
						})),
					},
				],
			},
		},
	};
}

describe("formatXThread (DI-3: entryId prefix validation)", () => {
	it("matches the standard tweet- prefix", () => {
		const res = buildResponse([{ entryId: `tweet-${TWEET_ID}`, isMain: true, text: "main tweet" }]);
		const out = formatXThread(res, TWEET_ID);
		expect(out.mainFound).toBe(true);
		expect(out.text).toContain("main tweet");
	});

	it("falls back to the status- prefix (forward-compatible with schema drift)", () => {
		const res = buildResponse([{ entryId: `status-${TWEET_ID}`, text: "main via status-" }]);
		const out = formatXThread(res, TWEET_ID);
		expect(out.mainFound).toBe(true);
		expect(out.text).toContain("main via status-");
	});

	it("rejects an unknown prefix and reports mainFound=false", () => {
		const res = buildResponse([{ entryId: `unknown-${TWEET_ID}`, text: "weird shape" }]);
		const out = formatXThread(res, TWEET_ID);
		expect(out.mainFound).toBe(false);
		// The tweet still shows up in the reply list — the call is not
		// thrown away silently.
		expect(out.text).toContain("weird shape");
	});
});
