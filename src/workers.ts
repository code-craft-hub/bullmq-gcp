import { Worker, QueueEvents } from 'bullmq';
import { redisConnection } from './config/redis';

console.log(`🔧 Worker Process Started (PID: ${process.pid})`);

// QUEUE EVENTS MONITORING

const helloEvents = new QueueEvents('hello-queue', { connection: redisConnection });
helloEvents.on('completed', ({ jobId }) => {
  console.log(`[HELLO-QUEUE] ✅ Job ${jobId} completed`);
});
helloEvents.on('failed', ({ jobId, failedReason }) => {
  console.log(`[HELLO-QUEUE] ❌ Job ${jobId} failed: ${failedReason}`);
});

const emailEvents = new QueueEvents('email-queue', { connection: redisConnection });
emailEvents.on('completed', ({ jobId }) => {
  console.log(`[EMAIL-QUEUE] ✅ Job ${jobId} completed`);
});

const imageEvents = new QueueEvents('image-queue', { connection: redisConnection });

imageEvents.on('failed', ({ jobId, failedReason }) => {
  console.log(`[IMAGE-QUEUE] ❌ Job ${jobId} failed: ${failedReason}`);
});

const criticalEvents = new QueueEvents('critical-queue', { connection: redisConnection });

criticalEvents.on('completed', ({ jobId }) => {
  console.log(`[CRITICAL-QUEUE] ✅ Job ${jobId} completed after retries`);
});

// WORKERS DEFINITION

// 1. Hello Worker - Simple success
const helloWorker = new Worker(
  'hello-queue',
  async (job) => {
    console.log(`[HELLO-WORKER:${process.pid}] Processing job ${job.id}:`, job.data);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    return { 
      message: `Hello ${job.data.name}!`,
      processedAt: new Date().toISOString(),
      processedBy: process.pid
    };
  },
  { 
    connection: redisConnection,
    concurrency: 5 // Process 5 jobs simultaneously
  }
);

// 2. Email Worker - With priority handling
const emailWorker = new Worker(
  'email-queue',
  async (job) => {
    console.log(`[EMAIL-WORKER:${process.pid}] Processing ${job.data.type} email to ${job.data.to}`);
    
    const delay = job.data.priority === 'high' ? 7000 : 20000;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return {
      sent: true,
      to: job.data.to,
      subject: job.data.subject,
      sentAt: new Date().toISOString(),
      processedBy: process.pid
    };
  },
  { 
    connection: redisConnection,
    concurrency: 10 // Email workers can handle more concurrent jobs
  }
);

// 3. Image Worker - Simulates failures
const imageWorker = new Worker(
  'image-queue',
  async (job) => {
    console.log(`[IMAGE-WORKER:${process.pid}] Processing image ${job.data.filename}`);
    
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Simulate random failures (30% chance)
    if (Math.random() < 0.3) {
      throw new Error(`Failed to process image: ${job.data.filename}`);
    }
    
    return {
      filename: job.data.filename,
      url: `https://cdn.example.com/${job.data.filename}`,
      size: job.data.size,
      processedAt: new Date().toISOString(),
      processedBy: process.pid
    };
  },
  { 
    connection: redisConnection,
    concurrency: 3 // Image processing is resource-intensive
  }
);

// 4. Critical Worker - With retries
const criticalWorker = new Worker(
  'critical-queue',
  async (job) => {
    console.log(`[CRITICAL-WORKER:${process.pid}] Attempt ${job.attemptsMade + 1} for job ${job.id}`);
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Fail on first 2 attempts, succeed on 3rd
    if (job.attemptsMade < 2) {
      throw new Error(`Temporary failure (attempt ${job.attemptsMade + 1})`);
    }
    
    return {
      task: job.data.task,
      completedAfterAttempts: job.attemptsMade + 1,
      processedAt: new Date().toISOString(),
      processedBy: process.pid
    };
  },
  { 
    connection: redisConnection,
    concurrency: 2
  }
);

// WORKER EVENT LISTENERS

const workers = [helloWorker, emailWorker, imageWorker, criticalWorker];

workers.forEach((worker, index) => {
  const workerNames = ['HELLO', 'EMAIL', 'IMAGE', 'CRITICAL'];
  
  worker.on('completed', (job) => {
    console.log(`✅ [${workerNames[index]}-WORKER:${process.pid}] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.log(`❌ [${workerNames[index]}-WORKER:${process.pid}] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error(`🔥 [${workerNames[index]}-WORKER:${process.pid}] Worker error:`, err);
  });
});

// GRACEFUL SHUTDOWN

const gracefulShutdown = async () => {
  console.log(`\n🛑 [Worker:${process.pid}] Shutting down gracefully...`);
  
  await Promise.all(workers.map(worker => worker.close()));
  
  console.log(`✅ [Worker:${process.pid}] All workers closed`);
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

console.log(`✅ All workers initialized and ready (PID: ${process.pid})`);
