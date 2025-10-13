// jobs/dailyResetJob.js
const cron = require('node-cron');
const CampaignService = require('../services/campaignService');

// Run every day at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily reset job...');
  try {
    await CampaignService.resetDailyCounts();
    console.log('Daily reset completed successfully');
  } catch (error) {
    console.error('Daily reset job failed:', error);
  }
});