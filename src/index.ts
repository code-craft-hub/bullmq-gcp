import express from "express";
import { Queue, Worker, QueueEvents } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const app = express();
const PORT = process.env.PORT || 3000;

// Redis connection config
const redisConnection = {
  host: "localhost",
  port: 6379,
};

// 1. Simple Hello Queue
const helloQueue = new Queue("hello-queue", {
  connection: redisConnection,
});

// 2. Email Queue (with priority)
const emailQueue = new Queue("email-queue", {
  connection: redisConnection,
});

// 3. Image Processing Queue (with delays)
const imageQueue = new Queue("image-queue", {
  connection: redisConnection,
});

// 4. Critical Jobs Queue (with retry logic)
const criticalQueue = new Queue("critical-queue", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

// ==========================================
// QUEUE EVENTS
// ==========================================

const helloEvents = new QueueEvents("hello-queue", {
  connection: redisConnection,
});
helloEvents.on("completed", ({ jobId }) => {
  console.log(`[HELLO-QUEUE] Job ${jobId} completed`);
});

const emailEvents = new QueueEvents("email-queue", {
  connection: redisConnection,
});
emailEvents.on("completed", ({ jobId }) => {
  console.log(`[EMAIL-QUEUE] Job ${jobId} completed`);
});
const imageEvents = new QueueEvents("image-queue", {
  connection: redisConnection,
});
imageEvents.on("completed", ({ jobId }) => {
  console.log(`[IMAGE-QUEUE] Job ${jobId} completed`);
});

const criticalEvents = new QueueEvents("critical-queue", {
  connection: redisConnection,
});
criticalEvents.on("completed", ({ jobId }) => {
  console.log(`[CRITICAL-QUEUE] Job ${jobId} completed`);
});

// 1. Hello Worker - Simple success
const helloWorker = new Worker(
  "hello-queue",
  async (job) => {
    const now = new Date();
    console.log(`[HELLO-WORKER] Processing job ${job.id}:`, job.data);
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    console.log(
      "Finished response : ",
      (new Date().getTime() - now.getTime()) / 1000,
      " seconds"
    );
    return {
      message: `Hello ${job.data.name}!`,
      processedAt: new Date().toISOString(),
    };
  },
  { connection: redisConnection }
);

// 2. Email Worker - With priority handling
const emailWorker = new Worker(
  "email-queue",
  async (job) => {
    console.log(
      `[EMAIL-WORKER] Processing ${job.data.type} email to ${job.data.to}`
    );

    const delay = job.data.priority === "high" ? 5000 : 20000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    return {
      sent: true,
      to: job.data.to,
      subject: job.data.subject,
      sentAt: new Date().toISOString(),
    };
  },
  { connection: redisConnection, concurrency: 3 }
);

// 3. Image Worker - Simulates failures
const imageWorker = new Worker(
  "image-queue",
  async (job) => {
    console.log(`[IMAGE-WORKER] Processing image ${job.data.filename}`);

    await new Promise((resolve) => setTimeout(resolve, 15000));

    // Simulate random failures (30% chance)
    if (Math.random() < 0.3) {
      throw new Error(`Failed to process image: ${job.data.filename}`);
    }

    return {
      filename: job.data.filename,
      url: `https://cdn.example.com/${job.data.filename}`,
      size: job.data.size,
      processedAt: new Date().toISOString(),
    };
  },
  { connection: redisConnection }
);

// 4. Critical Worker - With retries
const criticalWorker = new Worker(
  "critical-queue",
  async (job) => {
    console.log(
      `[CRITICAL-WORKER] Attempt ${job.attemptsMade + 1} for job ${job.id}`
    );

    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Fail on first 2 attempts, succeed on 3rd
    if (job.attemptsMade < 4) {
      throw new Error(`Temporary failure (attempt ${job.attemptsMade + 1})`);
    }

    return {
      task: job.data.task,
      completedAfterAttempts: job.attemptsMade + 1,
      processedAt: new Date().toISOString(),
    };
  },
  { connection: redisConnection }
);

// Worker event listeners
[helloWorker, emailWorker, imageWorker, criticalWorker].forEach((worker) => {
  worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    console.log(`❌ Job ${job?.id} failed:`, err.message);
  });
});

// ==========================================
// BULL BOARD SETUP
// ==========================================

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [
    new BullMQAdapter(helloQueue),
    new BullMQAdapter(emailQueue),
    new BullMQAdapter(imageQueue),
    new BullMQAdapter(criticalQueue),
  ],
  serverAdapter: serverAdapter,
});

app.use("/admin/queues", serverAdapter.getRouter());

// ==========================================
// API ROUTES
// ==========================================

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Bull MQ + Bull Board Demo with PM2",
    endpoints: {
      "GET /": "This info",
      "GET /admin/queues": "Bull Board UI",
      "POST /jobs/hello": "Add hello job (always succeeds)",
      "POST /jobs/email": "Add email job with priority",
      "POST /jobs/image": "Add image job (30% failure rate)",
      "POST /jobs/critical": "Add critical job (retries 3 times)",
      "POST /jobs/delayed": "Add delayed job",
      "POST /jobs/batch": "Add batch of jobs",
      "GET /stats": "Get queue statistics",
      "POST /queues/:queue/pause": "Pause a queue",
      "POST /queues/:queue/resume": "Resume a queue",
      "DELETE /queues/:queue/clean": "Clean completed/failed jobs",
    },
  });
});

// 1. Simple Hello Job
app.post("/jobs/hello", async (req, res) => {
  try {
    const { name = "World" } = req.body;
    const job = await helloQueue.add("hello-job", { name });
    res.json({ success: true, jobId: job.id, queue: "hello-queue" });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 2. Email Job with Priority
app.post("/jobs/email", async (req, res) => {
  try {
    const {
      to,
      subject,
      priority = "normal",
      type = "notification",
    } = req.body;

    const job = await emailQueue.add(
      "send-email",
      { to, subject, type, priority },
      { priority: priority === "high" ? 1 : priority === "normal" ? 5 : 10 }
    );

    res.json({ success: true, jobId: job.id, queue: "email-queue", priority });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 3. Image Processing Job (with failures)
app.post("/jobs/image", async (req, res) => {
  try {
    const { filename, size = 1024 } = req.body;
    const job = await imageQueue.add("process-image", { filename, size });
    res.json({
      success: true,
      jobId: job.id,
      queue: "image-queue",
      note: "30% chance of failure",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 4. Critical Job with Retries
app.post("/jobs/critical", async (req, res) => {
  try {
    const { task } = req.body;
    const job = await criticalQueue.add("critical-task", { task });
    res.json({
      success: true,
      jobId: job.id,
      queue: "critical-queue",
      note: "Will retry up to 3 times",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 5. Delayed Job
app.post("/jobs/delayed", async (req, res) => {
  try {
    const { name = "Delayed User", delayMs = 5000 } = req.body;
    const job = await helloQueue.add(
      "delayed-hello",
      { name },
      { delay: delayMs }
    );
    res.json({
      success: true,
      jobId: job.id,
      queue: "hello-queue",
      delayMs,
      willRunAt: new Date(Date.now() + delayMs).toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 6. Batch Jobs
app.post("/jobs/batch", async (req, res) => {
  try {
    const { count = 10 } = req.body;
    const jobs = [];

    for (let i = 0; i < count; i++) {
      jobs.push({
        name: `batch-job`,
        data: { name: `User ${i + 1}`, batchId: Date.now() },
      });
    }

    await helloQueue.addBulk(jobs);
    res.json({
      success: true,
      jobsAdded: count,
      queue: "hello-queue",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 7. Queue Statistics
app.get("/stats", async (req, res) => {
  try {
    const stats = {
      hello: await helloQueue.getJobCounts(),
      email: await emailQueue.getJobCounts(),
      image: await imageQueue.getJobCounts(),
      critical: await criticalQueue.getJobCounts(),
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 8. Pause Queue
app.post("/queues/:queue/pause", async (req, res) => {
  try {
    const queueMap: Record<string, Queue> = {
      hello: helloQueue,
      email: emailQueue,
      image: imageQueue,
      critical: criticalQueue,
    };

    const queue = queueMap[req.params.queue];
    if (!queue) {
      return res.status(404).json({ error: "Queue not found" });
    }

    await queue.pause();
    res.json({ success: true, message: `${req.params.queue} queue paused` });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 9. Resume Queue
app.post("/queues/:queue/resume", async (req, res) => {
  try {
    const queueMap: Record<string, Queue> = {
      hello: helloQueue,
      email: emailQueue,
      image: imageQueue,
      critical: criticalQueue,
    };

    const queue = queueMap[req.params.queue];
    if (!queue) {
      return res.status(404).json({ error: "Queue not found" });
    }

    await queue.resume();
    res.json({ success: true, message: `${req.params.queue} queue resumed` });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 10. Clean Queue
app.delete("/queues/:queue/clean", async (req, res) => {
  try {
    const queueMap: Record<string, Queue> = {
      hello: helloQueue,
      email: emailQueue,
      image: imageQueue,
      critical: criticalQueue,
    };

    const queue = queueMap[req.params.queue];
    if (!queue) {
      return res.status(404).json({ error: "Queue not found" });
    }

    await queue.clean(0, 100, "completed");
    await queue.clean(0, 100, "failed");

    res.json({ success: true, message: `${req.params.queue} queue cleaned` });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Bull Board UI: http://localhost:${PORT}/admin/queues`);
  console.log(`\n📝 Example commands:`);
  console.log(
    `curl -X POST http://localhost:${PORT}/jobs/hello -H "Content-Type: application/json" -d '{"name":"Alice"}'`
  );
  console.log(
    `curl -X POST http://localhost:${PORT}/jobs/email -H "Content-Type: application/json" -d '{"to":"test@example.com","subject":"Test","priority":"high"}'`
  );
  console.log(
    `curl -X POST http://localhost:${PORT}/jobs/image -H "Content-Type: application/json" -d '{"filename":"photo.jpg"}'`
  );
  console.log(
    `curl -X POST http://localhost:${PORT}/jobs/batch -H "Content-Type: application/json" -d '{"count":20}'`
  );
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

const gracefulShutdown = async () => {
  console.log("\n🛑 Shutting down gracefully...");

  await Promise.all([
    helloWorker.close(),
    emailWorker.close(),
    imageWorker.close(),
    criticalWorker.close(),
    helloQueue.close(),
    emailQueue.close(),
    imageQueue.close(),
    criticalQueue.close(),
  ]);

  console.log("✅ All workers and queues closed");
  process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// import express from 'express';
// import { Queue, Worker } from 'bullmq';
// import { createBullBoard } from '@bull-board/api';
// import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
// import { ExpressAdapter } from '@bull-board/express';

// const app = express();
// const PORT = 3000;

// // Redis connection config
// const redisConnection = {
//   host: 'localhost',
//   port: 6379,
// };

// // Create a queue
// const helloQueue = new Queue('hello-queue', {
//   connection: redisConnection,
// });

// // Create a worker to process jobs
// const worker = new Worker(
//   'hello-queue',
//   async (job) => {
//     console.log(`Processing job ${job.id} with data:`, job.data);

//     // Simulate some work
//     await new Promise(resolve => setTimeout(resolve, 2000));

//     return {
//       message: `Hello ${job.data.name}!`,
//       processedAt: new Date().toISOString()
//     };
//   },
//   { connection: redisConnection }
// );

// // Worker event listeners
// worker.on('completed', (job) => {
//   console.log(`Job ${job.id} completed!`);
// });

// worker.on('failed', (job, err) => {
//   console.log(`Job ${job?.id} failed with error:`, err.message);
// });

// // Setup Bull Board
// const serverAdapter = new ExpressAdapter();
// serverAdapter.setBasePath('/admin/queues');

// createBullBoard({
//   queues: [new BullMQAdapter(helloQueue)],
//   serverAdapter: serverAdapter,
// });

// // Mount Bull Board UI
// app.use('/admin/queues', serverAdapter.getRouter());

// // API Routes
// app.use(express.json());

// app.get('/', (req, res) => {
//   res.json({
//     message: 'Bull MQ + Bull Board Demo',
//     endpoints: {
//       'GET /': 'This info',
//       'POST /jobs': 'Add a new job to the queue',
//       'GET /admin/queues': 'Bull Board UI (open in browser)'
//     }
//   });
// });

// app.post('/jobs', async (req, res) => {
//   try {
//     const { name = 'World' } = req.body;

//     const job = await helloQueue.add('hello-job', {
//       name,
//       timestamp: new Date().toISOString()
//     });

//     res.json({
//       success: true,
//       message: 'Job added to queue',
//       jobId: job.id,
//       data: job.data
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       error: error instanceof Error ? error.message : 'Unknown error'
//     });
//   }
// });

// // Start server
// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
//   console.log(`Bull Board UI: http://localhost:${PORT}/admin/queues`);
//   console.log('\nTo add a job, run:');
//   console.log(`curl -X POST http://localhost:${PORT}/jobs -H "Content-Type: application/json" -d '{"name":"Alice"}'`);
// });

// // Graceful shutdown
// process.on('SIGTERM', async () => {
//   await worker.close();
//   await helloQueue.close();
//   process.exit(0);
// });
