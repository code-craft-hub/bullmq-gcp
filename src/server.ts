import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { helloQueue, emailQueue, imageQueue, criticalQueue, allQueues } from './queues';

const app = express();
const PORT = process.env.PORT || 3000;

console.log(`🚀 Server Process Started (PID: ${process.pid})`);

// ==========================================
// BULL BOARD SETUP
// ==========================================

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(helloQueue),
    new BullMQAdapter(emailQueue),
    new BullMQAdapter(imageQueue),
    new BullMQAdapter(criticalQueue),
  ],
  serverAdapter: serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

// ==========================================
// API ROUTES
// ==========================================

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'Bull MQ + Bull Board Demo - Separated Architecture',
    serverPid: process.pid,
    architecture: {
      server: 'Handles HTTP requests and adds jobs to queues',
      workers: 'Separate processes that consume and process jobs'
    },
    endpoints: {
      'GET /': 'This info',
      'GET /health': 'Health check',
      'GET /admin/queues': 'Bull Board UI',
      'POST /jobs/hello': 'Add hello job (always succeeds)',
      'POST /jobs/email': 'Add email job with priority',
      'POST /jobs/image': 'Add image job (30% failure rate)',
      'POST /jobs/critical': 'Add critical job (retries 3 times)',
      'POST /jobs/delayed': 'Add delayed job',
      'POST /jobs/batch': 'Add batch of jobs',
      'GET /stats': 'Get queue statistics',
      'POST /queues/:queue/pause': 'Pause a queue',
      'POST /queues/:queue/resume': 'Resume a queue',
      'DELETE /queues/:queue/clean': 'Clean completed/failed jobs',
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    serverPid: process.pid,
    timestamp: new Date().toISOString()
  });
});

// 1. Simple Hello Job
app.post('/jobs/hello', async (req, res) => {
  try {
    const { name = 'World' } = req.body;
    const job = await helloQueue.add('hello-job', { name, addedBy: process.pid });
    res.json({ 
      success: true, 
      jobId: job.id, 
      queue: 'hello-queue',
      serverPid: process.pid
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 2. Email Job with Priority
app.post('/jobs/email', async (req, res) => {
  try {
    const { to, subject, priority = 'normal', type = 'notification' } = req.body;
    
    const job = await emailQueue.add(
      'send-email',
      { to, subject, type, priority },
      { priority: priority === 'high' ? 1 : priority === 'normal' ? 5 : 10 }
    );
    
    res.json({ 
      success: true, 
      jobId: job.id, 
      queue: 'email-queue', 
      priority,
      serverPid: process.pid
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 3. Image Processing Job
app.post('/jobs/image', async (req, res) => {
  try {
    const { filename, size = 1024 } = req.body;
    const job = await imageQueue.add('process-image', { filename, size });
    res.json({ 
      success: true, 
      jobId: job.id, 
      queue: 'image-queue',
      note: '30% chance of failure',
      serverPid: process.pid
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 4. Critical Job
app.post('/jobs/critical', async (req, res) => {
  try {
    const { task } = req.body;
    const job = await criticalQueue.add('critical-task', { task });
    res.json({ 
      success: true, 
      jobId: job.id, 
      queue: 'critical-queue',
      note: 'Will retry up to 3 times',
      serverPid: process.pid
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 5. Delayed Job
app.post('/jobs/delayed', async (req, res) => {
  try {
    const { name = 'Delayed User', delayMs = 5000 } = req.body;
    const job = await helloQueue.add(
      'delayed-hello',
      { name },
      { delay: delayMs }
    );
    res.json({ 
      success: true, 
      jobId: job.id,
      queue: 'hello-queue',
      delayMs,
      willRunAt: new Date(Date.now() + delayMs).toISOString(),
      serverPid: process.pid
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 6. Batch Jobs
app.post('/jobs/batch', async (req, res) => {
  try {
    const { count = 10 } = req.body;
    const jobs = [];
    
    for (let i = 0; i < count; i++) {
      jobs.push({
        name: `batch-job`,
        data: { name: `User ${i + 1}`, batchId: Date.now() }
      });
    }
    
    await helloQueue.addBulk(jobs);
    res.json({ 
      success: true, 
      jobsAdded: count,
      queue: 'hello-queue',
      serverPid: process.pid
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 7. Queue Statistics
app.get('/stats', async (req, res) => {
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
app.post('/queues/:queue/pause', async (req, res) => {
  try {
    const queueMap: Record<string, any> = {
      hello: helloQueue,
      email: emailQueue,
      image: imageQueue,
      critical: criticalQueue,
    };
    
    const queue = queueMap[req.params.queue];
    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }
    
    await queue.pause();
    res.json({ success: true, message: `${req.params.queue} queue paused` });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 9. Resume Queue
app.post('/queues/:queue/resume', async (req, res) => {
  try {
    const queueMap: Record<string, any> = {
      hello: helloQueue,
      email: emailQueue,
      image: imageQueue,
      critical: criticalQueue,
    };
    
    const queue = queueMap[req.params.queue];
    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }
    
    await queue.resume();
    res.json({ success: true, message: `${req.params.queue} queue resumed` });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 10. Clean Queue
app.delete('/queues/:queue/clean', async (req, res) => {
  try {
    const queueMap: Record<string, any> = {
      hello: helloQueue,
      email: emailQueue,
      image: imageQueue,
      critical: criticalQueue,
    };
    
    const queue = queueMap[req.params.queue];
    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }
    
    await queue.clean(0, 100, 'completed');
    await queue.clean(0, 100, 'failed');
    
    res.json({ success: true, message: `${req.params.queue} queue cleaned` });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT} (PID: ${process.pid})`);
  console.log(`📊 Bull Board UI: http://localhost:${PORT}/admin/queues`);
  console.log(`\n💡 Architecture:`);
  console.log(`   - This server ONLY handles HTTP requests and adds jobs to queues`);
  console.log(`   - Workers run separately and process the jobs`);
  console.log(`   - Workers can scale independently from the server`);
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

const gracefulShutdown = async () => {
  console.log(`\n🛑 [Server:${process.pid}] Shutting down gracefully...`);
  
  await Promise.all(allQueues.map(queue => queue.close()));
  
  console.log(`✅ [Server:${process.pid}] All queues closed`);
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);