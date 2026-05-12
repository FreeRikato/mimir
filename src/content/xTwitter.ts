// Runs in MAIN world at document_start on x.com and twitter.com.
// Patches window.fetch to intercept TweetDetail GraphQL responses and stores
// the parsed JSON in window.__mimiXData[tweetId] for Mimir to read via executeScript.

type MimiXStore = Record<string, unknown>;

const w = window as Window & { __mimiXData?: MimiXStore };
w.__mimiXData = w.__mimiXData ?? {};

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
						(w.__mimiXData as MimiXStore)[tweetId] = data;
					}
				} catch {
					// Non-fatal — don't break X's rendering
				}
			})
			.catch(() => {});
	}

	return response;
};
