const Redis = require('ioredis');
const { Queue, Worker } = require('bullmq');

class RedisConfig {
  constructor() {
    this.connection = null;
    this.queues = new Map();
    this.workers = new Map();
  }

  // Initialize Redis connection
  init() {
    try {
      const redisOptions = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        enableReadyCheck: false,
        lazyConnect: true
      };

      // Add password if provided
      if (process.env.REDIS_PASSWORD) {
        redisOptions.password = process.env.REDIS_PASSWORD;
      }

      // Add database if provided
      if (process.env.REDIS_DB) {
        redisOptions.db = parseInt(process.env.REDIS_DB);
      }

      this.connection = new Redis(redisOptions);

      this.connection.on('connect', () => {
        console.log('🔌 Redis connecting...');
      });

      this.connection.on('ready', () => {
        console.log('✅ Redis ready');
      });

      this.connection.on('error', (error) => {
        console.error('❌ Redis connection error:', error);
      });

      this.connection.on('close', () => {
        console.log('🔌 Redis connection closed');
      });

      this.connection.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting...');
      });

      return this.connection;
    } catch (error) {
      console.error('💥 Failed to initialize Redis:', error);
      throw error;
    }
  }

  // Get Redis connection
  getConnection() {
    if (!this.connection) {
      return this.init();
    }
    return this.connection;
  }

  // Create a BullMQ queue
  createQueue(name, options = {}) {
    if (this.queues.has(name)) {
      return this.queues.get(name);
    }

    const queue = new Queue(name, {
      connection: this.getConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        ...options.defaultJobOptions
      }
    });

    this.queues.set(name, queue);
    console.log(`📊 Created queue: ${name}`);
    return queue;
  }

  // Create a BullMQ worker
  createWorker(name, processor, options = {}) {
    if (this.workers.has(name)) {
      return this.workers.get(name);
    }

    const worker = new Worker(name, processor, {
      connection: this.getConnection(),
      concurrency: options.concurrency || 1,
      ...options
    });

    worker.on('completed', (job) => {
      console.log(`✅ Job ${job.id} completed in queue ${name}`);
    });

    worker.on('failed', (job, err) => {
      console.error(`❌ Job ${job?.id} failed in queue ${name}:`, err);
    });

    worker.on('error', (err) => {
      console.error(`💥 Worker error in queue ${name}:`, err);
    });

    worker.on('stalled', (jobId) => {
      console.warn(`⚠️ Job ${jobId} stalled in queue ${name}`);
    });

    this.workers.set(name, worker);
    console.log(`👷 Created worker: ${name}`);
    return worker;
  }

  // Close all connections
  async close() {
    console.log('🛑 Closing Redis connections...');
    
    // Close all workers
    for (const [name, worker] of this.workers) {
      await worker.close();
      console.log(`✅ Worker ${name} closed`);
    }
    this.workers.clear();

    // Close all queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      console.log(`✅ Queue ${name} closed`);
    }
    this.queues.clear();

    // Close Redis connection
    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
      console.log('✅ Redis connection closed');
    }
  }

  // Health check
  async healthCheck() {
    try {
      if (!this.connection) {
        return { status: 'disconnected', error: 'No connection established' };
      }

      const pingResult = await this.connection.ping();
      const info = await this.connection.info();

      return { 
        status: 'connected', 
        timestamp: new Date().toISOString(),
        ping: pingResult,
        queues: this.queues.size,
        workers: this.workers.size
      };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  // Get queue metrics
  async getQueueMetrics(queueName) {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }

      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed()
      ]);

      return {
        queue: queueName,
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        total: waiting.length + active.length + completed.length + failed.length + delayed.length
      };
    } catch (error) {
      console.error(`Error getting metrics for queue ${queueName}:`, error);
      throw error;
    }
  }

  // Get all queue metrics
  async getAllQueueMetrics() {
    const metrics = {};
    for (const [queueName] of this.queues) {
      metrics[queueName] = await this.getQueueMetrics(queueName);
    }
    return metrics;
  }

  // Clean old jobs
  async cleanOldJobs(queueName, gracePeriod = 24 * 60 * 60 * 1000) {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }

      const cutoffTime = Date.now() - gracePeriod;
      
      // Clean completed jobs
      const completedCleaned = await queue.clean(cutoffTime, 1000, 'completed');
      
      // Clean failed jobs
      const failedCleaned = await queue.clean(cutoffTime, 1000, 'failed');

      console.log(`🧹 Cleaned ${completedCleaned.length} completed and ${failedCleaned.length} failed jobs from queue ${queueName}`);
      
      return {
        completed: completedCleaned.length,
        failed: failedCleaned.length
      };
    } catch (error) {
      console.error(`Error cleaning old jobs from queue ${queueName}:`, error);
      throw error;
    }
  }
}

// Create singleton instance
const redisConfig = new RedisConfig();

module.exports = redisConfig;