/**
 * Job Queue — standalone durable job processing
 *
 * Demonstrates the jobQueue as a self-contained processing engine:
 * concurrency, progress, priority, scheduling, rate limiting,
 * introspection, batch add, persistence, and distributed bridging.
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/job-queue.ts
 */
import { subscribe } from "callbag-recharge/extra";
import { jobQueue, topic } from "callbag-recharge/messaging";
import { memoryAdapter } from "callbag-recharge/utils";

// ---------------------------------------------------------------------------
// 1. Basic queue with concurrency and progress
// ---------------------------------------------------------------------------

const emailQueue = jobQueue<string, { sent: boolean }>(
	"emails",
	async (signal, _address, progress) => {
		progress(0.1);
		// Simulate sending an email
		await new Promise((r) => setTimeout(r, 100));
		if (signal.aborted) throw new Error("cancelled");
		progress(0.9);
		return { sent: true };
	},
	{ concurrency: 5 },
);

// React to companion stores
subscribe(emailQueue.active, (n) => console.log(`Active: ${n}`));
subscribe(emailQueue.progress, (p) => console.log(`Progress: ${(p * 100).toFixed(0)}%`));

// Add jobs
emailQueue.add("alice@example.com");
emailQueue.add("bob@example.com");

// Listen for events
emailQueue.on("completed", (job) => {
	console.log(`Job ${job.seq} completed in ${job.duration}ms`, job.result);
});

// ---------------------------------------------------------------------------
// 2. Priority ordering
// ---------------------------------------------------------------------------

const priorityQueue = jobQueue<{ task: string }, void>(
	"tasks",
	async (_signal, data) => {
		console.log(`Processing: ${data.task}`);
	},
	{ concurrency: 3 },
);

// Lower priority number = processed first (within a pull batch)
priorityQueue.add({ task: "low-priority" }, { priority: 10 });
priorityQueue.add({ task: "high-priority" }, { priority: 1 });
priorityQueue.add({ task: "medium-priority" }, { priority: 5 });

// ---------------------------------------------------------------------------
// 3. Scheduled jobs
// ---------------------------------------------------------------------------

const scheduledQueue = jobQueue<string, void>("scheduled", async (_signal, data) => {
	console.log(`Running scheduled: ${data}`);
});

// Run 30 seconds from now
scheduledQueue.add("report-generation", {
	runAt: new Date(Date.now() + 30_000),
});

// Introspect the scheduled job
const info = scheduledQueue.getJob(1);
console.log(`Job status: ${info?.status}`); // "scheduled"

// ---------------------------------------------------------------------------
// 4. Batch add + retry + dead letter queue
// ---------------------------------------------------------------------------

const dlq = topic<string>("failed-jobs");

const batchQueue = jobQueue<string, void>(
	"batch-work",
	async (_signal, data) => {
		if (data === "poison") throw new Error("bad data");
	},
	{
		retry: { maxRetries: 2, backoff: () => 100 },
		deadLetterTopic: dlq,
	},
);

// Add multiple jobs atomically
batchQueue.addBatch(["good-1", "poison", "good-2"]);

// Failed jobs route to the dead letter topic after retries exhausted
batchQueue.on("failed", (job) => {
	console.log(`Job ${job.seq} failed after ${job.attempts} attempts`);
});

// ---------------------------------------------------------------------------
// 5. Rate limiting
// ---------------------------------------------------------------------------

const apiQueue = jobQueue<string, Response>("api-calls", async (_signal, url) => fetch(url), {
	concurrency: 10,
	rateLimit: { max: 5, windowMs: 1000 }, // max 5 job starts per second
});

// ---------------------------------------------------------------------------
// 6. Job introspection and removal
// ---------------------------------------------------------------------------

const longQueue = jobQueue<string, void>("long-jobs", async (signal) => {
	await new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, 60_000);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(new Error("aborted"));
		});
	});
});

const seq = longQueue.add("long-task");

// Check status
const job = longQueue.getJob(seq);
console.log(`Job ${seq}: status=${job?.status}, attempts=${job?.attempts}`);

// Cancel it
longQueue.remove(seq);

// ---------------------------------------------------------------------------
// 7. Persistence — survive restarts
// ---------------------------------------------------------------------------

const adapter = memoryAdapter(); // swap with a file/db adapter in production

const persistentQueue = jobQueue<string, string>(
	"persistent",
	async (_signal, data) => `done:${data}`,
	{ persistence: adapter },
);

persistentQueue.add("important-work");

// After restart, create a new queue with the same name + adapter.
// Completed jobs are recovered for introspection via getJob().

// ---------------------------------------------------------------------------
// 8. Distributed jobs via topicBridge
// ---------------------------------------------------------------------------

// Expose the internal topic for wiring into a topicBridge:
//
//   import { topicBridge, wsMessageTransport } from 'callbag-recharge/messaging';
//
//   const bridge = topicBridge(
//     wsMessageTransport({ url: 'ws://worker-node:8080' }),
//     { 'emails:jobs': { topic: emailQueue.inner.topic } },
//   );
//
// Remote workers consume from the same topic, enabling distributed processing.

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// Pause/resume lifecycle
emailQueue.pause();
console.log(`Paused: ${emailQueue.isPaused}`); // true
emailQueue.resume();

// Tear down
emailQueue.destroy();
priorityQueue.destroy();
scheduledQueue.destroy();
batchQueue.destroy();
apiQueue.destroy();
longQueue.destroy();
persistentQueue.destroy();
dlq.destroy();
