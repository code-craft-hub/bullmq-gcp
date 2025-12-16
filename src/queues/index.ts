import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

// Define all queues
export const helloQueue = new Queue('hello-queue', {
  connection: redisConnection,
});

export const emailQueue = new Queue('email-queue', {
  connection: redisConnection,
});

export const imageQueue = new Queue('image-queue', {
  connection: redisConnection,
});

export const criticalQueue = new Queue('critical-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

export const allQueues = [helloQueue, emailQueue, imageQueue, criticalQueue];
