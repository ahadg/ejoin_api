// app.js or server.js
const cron = require('node-cron');
const campaignService = require('../services/campaignService');
const redisConfig = require('../config/redis');

// Daily cleanup at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('🔄 Running daily cleanup...');
  
  try {
    // Clean old jobs from all queues
    for (const [queueName] of campaignService.queues) {
      await redisConfig.cleanOldJobs(queueName, 24 * 60 * 60 * 1000); // 24 hours
    }
    
    // Cleanup stuck jobs
    await campaignService.cleanupStuckJobs();
    
    console.log('✅ Daily cleanup completed');
  } catch (error) {
    console.error('❌ Daily cleanup failed:', error);
  }
});

// Daily cleanup at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('🔄 Running hourly stuck job cleanup...');
  try {
    await campaignService.cleanupStuckJobs();
  } catch (error) {
    console.error('❌ Hourly cleanup failed:', error);
  }
});