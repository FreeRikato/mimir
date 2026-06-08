// Tiny mock FastAPI-style backend.
// Fails the first N requests with a sequence of status codes, then 200.
// Default sequence: 408, 503 (i.e. demonstrate retry for both a transient
// 4xx and a 5xx in one run).
// Use: PORT=8765 STATUSES=408,503 node manual-qa/mock-backend.mjs
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8765);
const statuses = (process.env.STATUSES ?? "408,503").split(",").map((s) => Number(s.trim()));
let hits = 0;

const server = createServer((req, res) => {
	hits++;
	const log = `[hit ${hits}] ${req.method} ${req.url}`;
	const failingStatus = statuses[hits - 1];
	if (failingStatus !== undefined) {
		console.log(`${log} -> ${failingStatus} (failure)`);
		res.writeHead(failingStatus, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "transient", message: `backend returning ${failingStatus}` }));
		return;
	}
	console.log(`${log} -> 200 (success)`);
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(
		JSON.stringify({
			video_id: "abc123",
			language: "en",
			subtitle_count: 1,
			subtitles: [{ start: "00:00:00.000", end: "00:00:05.000", text: "hello world" }],
			metadata: {
				video_id: "abc123",
				title: "Demo Video",
				duration: 300,
				channel: "Demo",
			},
		}),
	);
});

server.listen(port, "127.0.0.1", () => {
	console.log(`mock backend listening on http://127.0.0.1:${port}, will fail with [${statuses.join(", ")}] then 200`);
});
