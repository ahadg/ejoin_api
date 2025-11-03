// jobs/timeRestrictionMonitor.js
const cron = require('node-cron');
const CampaignService = require('../services/campaignService');
const Campaign = require('../models/Campaign');

// At minute 0 of every hour
cron.schedule('0 * * * *', 
  async () => {
  console.log('🕐 Checking time restrictions for active campaigns...');
  
  try {
    // Get all campaigns with time restrictions enabled
    const campaigns = await Campaign.find({
      'taskSettings.timeRestrictions.enabled': true,
      status: { $in: ['active', 'paused'] }
    });

    for (const campaign of campaigns) {
      try {
        await CampaignService.checkTimeRestrictions(campaign._id);
      } catch (error) {
        console.error(`Error processing time restrictions for campaign ${campaign._id}:`, error);
      }
    }

    console.log(`✅ Time restriction check completed for ${campaigns.length} campaigns`);
  } catch (error) {
    console.error('Error in time restriction monitor:', error);
  }
});

// Run every day at midnight Toronto (Eastern) time
cron.schedule(
  '0 0 * * *',
  async () => {
    console.log('Running daily reset job (Canada time)...');
    try {
      await CampaignService.resetDailyCounts();
      console.log('Daily reset completed successfully');
    } catch (error) {
      console.error('Daily reset job failed:', error);
    }
  },
  {
    timezone: 'America/Toronto', // Canadian Eastern Time
  }
);

console.log('🕐 Time restriction monitor initialized');

