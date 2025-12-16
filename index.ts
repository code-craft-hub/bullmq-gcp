import express from 'express';
import { Queue, Worker } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const app = express();
const PORT = 3000;

// Redis connection config
const redisConnection = {
  host: 'localhost',
  port: 6379,
};

// Create a queue
const helloQueue = new Queue('hello-queue', {
  connection: redisConnection,
});

// Create a worker to process jobs
const worker = new Worker(
  'hello-queue',
  async (job) => {
    console.log(`Processing job ${job.id} with data:`, job.data);
    
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return { 
      message: `Hello ${job.data.name}!`,
      processedAt: new Date().toISOString()
    };
  },
  { connection: redisConnection }
);

// Worker event listeners
worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} failed with error:`, err.message);
});

// Setup Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(helloQueue)],
  serverAdapter: serverAdapter,
});

// Mount Bull Board UI
app.use('/admin/queues', serverAdapter.getRouter());

// API Routes
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'Bull MQ + Bull Board Demo',
    endpoints: {
      'GET /': 'This info',
      'POST /jobs': 'Add a new job to the queue',
      'GET /admin/queues': 'Bull Board UI (open in browser)'
    }
  });
});

app.post('/jobs', async (req, res) => {
  try {
    const { name = 'World' } = req.body;
    
    const job = await helloQueue.add('hello-job', {
      name,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Job added to queue',
      jobId: job.id,
      data: job.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Bull Board UI: http://localhost:${PORT}/admin/queues`);
  console.log('\nTo add a job, run:');
  console.log(`curl -X POST http://localhost:${PORT}/jobs -H "Content-Type: application/json" -d '{"name":"Alice"}'`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  await helloQueue.close();
  process.exit(0);
});