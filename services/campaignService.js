// services/campaignService.js
const { Worker, Queue } = require('bullmq');
const Campaign = require('../models/Campaign');
const ContactList = require('../models/ContactList');
const Contact = require('../models/Contact');
const Device = require('../models/Device');
const Message = require('../models/Message');
const MessageVariant = require('../models/MessageVariant');
//const { EjoinAPI } = require('../lib/api/ejoin');
//const { messageAPI } = require('../lib/api/messages');
const redis = require('../config/redis');
const DeviceClient = require('./deviceClient');
const aiGenerationController = require('../controllers/aiGenerationController');


class CampaignService {
  constructor() {
    this.queues = new Map();   // queueName -> Queue
    this.workers = new Map();  // queueName -> Worker
    this.init();
  }

  init() {
    // Cleanup on startup
    this.cleanupStuckJobs();

    // Start daily reset scheduler (kept for safety; you also have a cron job)
    this.startDailyResetScheduler();
  }

  // Create campaign queue and worker (one queue per campaign)
  async createCampaignProcessor(campaignId) {
    const queueName = `campaign-${campaignId}`;

    // Reuse if exists
    if (this.queues.has(queueName)) {
      return this.queues.get(queueName);
    }

    const queue = redis.createQueue(queueName, {
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        maxRetriesPerRequest: null,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    });

    // Worker processes a single "process-campaign" job which handles the whole campaign
    const worker = redis.createWorker(queueName, this.processCampaignJob.bind(this), {
      concurrency: 1 // process one campaign job at a time per queue
    });

    // Attach event listeners if you want (logging)
    worker.on('completed', (job) => {
      console.log(`Campaign worker completed job ${job.id} on ${queueName}`);
    });
    worker.on('failed', (job, err) => {
      console.error(`Campaign worker failed job ${job?.id} on ${queueName}:`, err);
    });

    this.queues.set(queueName, queue);
    this.workers.set(queueName, worker);

    return queue;
  }

  // New: process entire campaign job (the worker will call this)
  async processCampaignJob(job) {
    // job.data: { campaignId }
    const { campaignId } = job.data;
    console.log(`Worker processing campaign ${campaignId}`);

    // Load campaign with relations
    const campaign = await Campaign.findById(campaignId)
      .populate('contactList')
      .populate('device')
      .populate('message')
      .populate({
        path: 'message',
        populate: { path: 'variants', model: 'MessageVariant' }
      });

    if (!campaign || !campaign.contactList) {
      console.error(`Campaign or contact list not found for ${campaignId}`);
      await Campaign.findByIdAndUpdate(campaignId, { status: 'failed' });
      return;
    }

    // Re-fetch device (fresh)
    const device = await Device.findById(campaign.device._id);
    if (!device) {
      console.error(`Device not found for campaign ${campaignId}`);
      await Campaign.findByIdAndUpdate(campaignId, { status: 'failed' });
      return;
    }

    // Load opted-in contacts deterministically (sort by _id)
    let contacts = await Contact.find({
      contactList: campaign.contactList._id,
      optedIn: true
    }).sort({ _id: 1 }).lean();

    if (!contacts || contacts.length === 0) {
      console.log(`No opted-in contacts for campaign ${campaignId}`);
      await Campaign.findByIdAndUpdate(campaignId, { status: 'completed', completedAt: new Date() });
      return;
    }

    // Determine resume index (use sentCount as offset)
    // Ensure sentCount exists in campaign schema and is incremented by updateCampaignStats
    const startIndex = Number(campaign.sentCount || 0);
    if (startIndex >= contacts.length) {
      console.log(`Campaign ${campaignId} already finished (sentCount >= contacts)`);
      await Campaign.findByIdAndUpdate(campaignId, { status: 'completed', completedAt: new Date() });
      return;
    }

    // Ensure campaign status
    await Campaign.findByIdAndUpdate(campaignId, { status: 'active', processingStartedAt: campaign.processingStartedAt || new Date() });

    // iterate contacts sequentially starting from startIndex
    for (let i = startIndex; i < contacts.length; i++) {
      const contact = contacts[i];

      // Re-check campaign status (in case paused/stopped externally)
      const currentCampaign = await Campaign.findById(campaignId);
      if (!currentCampaign) {
        console.log(`Campaign ${campaignId} removed; stopping worker.`);
        return;
      }
      if (currentCampaign.status === 'paused' && currentCampaign.pauseReason !== 'resume_requested') {
        console.log(`Campaign ${campaignId} externally paused. Exiting worker.`);
        return;
      }
      if (currentCampaign.status === 'completed') {
        console.log(`Campaign ${campaignId} marked completed. Exiting worker.`);
        return;
      }

      // Re-load device to get the latest dailySent
      const freshDevice = await Device.findById(device._id);
      if (!freshDevice) {
        console.error(`Device missing while processing campaign ${campaignId}. Pausing.`);
        await this.pauseCampaign(campaignId, 'device_missing');
        return;
      }

      // Check device daily limit
      if (typeof freshDevice.dailyLimit === 'number' && typeof freshDevice.dailySent === 'number') {
        if (freshDevice.dailySent >= freshDevice.dailyLimit) {
          console.log(`Device ${freshDevice._id} reached daily limit. Pausing campaign ${campaignId}`);
          await this.pauseCampaign(campaignId, 'daily_limit_reached');
          return;
        }
      }

      // Check campaign daily limit
      const campaignDailySent = await this.getTodaySentCount(campaignId);
      if (campaign.taskSettings?.dailyMessageLimit && campaignDailySent >= campaign.taskSettings.dailyMessageLimit) {
        console.log(`Campaign ${campaignId} reached campaign daily limit. Pausing.`);
        await this.pauseCampaign(campaignId, 'daily_limit_reached');
        return;
      }

      // Generate message variant
      const finalMessage = await this.generateMessageVariant(campaignId, campaign.taskSettings || {}, contact);
      console.log("finalMessage",finalMessage);
      // Prepare SMS task (same structure you had)
      const smsTask = {
        id: Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
        from: "",
        sms: finalMessage.content,
        interval_min: campaign.taskSettings?.interval_min || 30000,
        interval_max: campaign.taskSettings?.interval_max || 50000,
        timeout: campaign.taskSettings?.timeout || 30,
        charset: campaign.taskSettings?.charset?.toLowerCase() === 'utf-8' ? 'utf8' : 'utf8',
        coding: campaign.taskSettings?.coding || 0,
        sms_type: campaign.taskSettings?.sms_type || 0,
        sdr: campaign.taskSettings?.sdr !== false,
        fdr: campaign.taskSettings?.fdr !== false,
        dr: campaign.taskSettings?.dr !== false,
        to_all: campaign.taskSettings?.to_all || true,
        flash_sms: campaign.taskSettings?.flash_sms || false,
        recipients: [contact.phoneNumber],
      };

      try {
        const client = new DeviceClient(freshDevice);
        const ejoinResponse = await client.sendSms(smsTask);
        console.log("sendSms_result", ejoinResponse);

        if (ejoinResponse?.[0]?.reason === "OK") {  
          // update campaign stats and device counters
          await this.updateCampaignStats(campaignId, { sentMessages: 1, lastSentAt: new Date() });
          await this.updateDeviceDailyCount(freshDevice._id);

          // optionally persist lastSentContactIndex
          await Campaign.findByIdAndUpdate(campaignId, {
            $set: { lastSentContactId: contact._id, updatedAt: new Date() }
          });

          // optionally emit progress events here (socket io) - not implemented
        } else {
          // treat as failure (increment failedMessages)
          console.error(`SMS send responded with error for campaign ${campaignId}`, ejoinResponse);
          await this.updateCampaignStats(campaignId, { failedMessages: 1 });
          // depending on strategy, you might continue or pause; we'll continue
        }

      } catch (err) {
        console.error(`Error sending SMS for campaign ${campaignId} to ${contact.phoneNumber}:`, err);
        await this.updateCampaignStats(campaignId, { failedMessages: 1 });
        // Optionally implement retry/backoff here; for now continue to next contact
      }

      // Delay between sends (interval). Worker will sleep here.
      const delay = this.getRandomDelay(
        campaign.taskSettings?.interval_min || 30000,
        campaign.taskSettings?.interval_max || 90000
      );
      console.log(`Campaign ${campaignId}: waiting ${delay / 1000}s before next send...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Completed campaign
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'completed',
      completedAt: new Date()
    });
    console.log(`Campaign ${campaignId} completed successfully`);
    return;
  }

  // Generate message variant (AI or static) - unchanged
  async generateMessageVariant(campaignId, taskSettings, contact) {
    const campaign = await Campaign.findById(campaignId)
      .populate('message')
      .populate({
        path: 'message',
        populate: { path: 'variants', model: 'MessageVariant' }
      });
  
    console.log("generateMessageVariant_start", { 
      campaignId, 
      messageVariationType: campaign?.taskSettings?.messageVariationType,
      useAiGeneration: campaign?.taskSettings?.useAiGeneration,
      contact: contact?.phoneNumber 
    });
  
    // Handle single_variant type - use campaign's messageContent
    if (campaign?.taskSettings?.messageVariationType === 'single_variant') {
      console.log("Using single variant from messageContent");
      return {
        content: campaign.messageContent || 'Default message',
        variantId: 'single-base-message',
        tone: 'Professional',
        characterCount: (campaign.messageContent || 'Default message').length
      };
    }
  
    // Handle multiple_variants type - randomly select from message variants
    if (campaign?.taskSettings?.messageVariationType === 'multiple_variants') {
      if (campaign?.message?.variants && campaign.message.variants.length > 0) {
        const randomVariant = campaign.message.variants[
          Math.floor(Math.random() * campaign.message.variants.length)
        ];
        console.log("Selected random variant from multiple variants:", randomVariant._id);
        return {
          content: randomVariant.content,
          variantId: randomVariant._id,
          tone: randomVariant.tone || 'Professional',
          characterCount: randomVariant.characterCount
        };
      } else {
        console.log("No variants found, falling back to base message");
        // Fallback to base message if no variants exist
        return {
          content: campaign?.messageContent || 'Default message',
          variantId: 'fallback-base-message',
          tone: 'Professional',
          characterCount: (campaign?.messageContent || 'Default message').length
        };
      }
    }
  
    // Handle ai_random type - generate AI variant
    if (campaign?.taskSettings?.messageVariationType === 'ai_random' || 
        campaign?.taskSettings?.useAiGeneration) {
      
      console.log("Generating AI variant for contact:", contact.phoneNumber);
      // Use the AI generation controller
      try {
        const aiResponse = await aiGenerationController.generateWithGrok({
          prompt: campaign?.taskSettings?.aiPrompt || campaign?.messageContent,
          variantCount: 1,
          characterLimit: 160,
          tones: ['Professional', 'Friendly', 'Urgent'],
          languages: ['English'],
          creativityLevel: 0.8,
          includeEmojis: true,
          companyName: campaign?.taskSettings?.companyName || 'Your company',
          unsubscribeText: 'Reply STOP to unsubscribe',
          customInstructions: ``
        });
        console.log("aiResponse",aiResponse);
        console.log("aiResponse_content",aiResponse?.[0]?.content);
  
        if (aiResponse && aiResponse[0]?.content) {
          const variant = aiResponse?.[0];
          console.log("AI variant generated successfully");
          return {
            content: variant.content,
            variantId: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            tone: variant.tone || 'AI-Generated',
            characterCount: variant.characterCount
          };
        }
      } catch (error) {
        console.error('AI message generation failed, using fallback:', error);
        // Fall through to fallback options
      }
  
      // AI fallback: try message variants
      if (campaign?.message?.variants && campaign.message.variants.length > 0) {
        const randomVariant = campaign.message.variants[
          Math.floor(Math.random() * campaign.message.variants.length)
        ];
        console.log("AI failed, using random variant as fallback");
        return {
          content: randomVariant.content,
          variantId: randomVariant._id,
          tone: randomVariant.tone || 'Professional',
          characterCount: randomVariant.characterCount
        };
      }
  
      // Final fallback: use base message
      console.log("Using base message as final fallback");
      return {
        content: campaign?.messageContent || campaign?.taskSettings?.aiPrompt || 'Default message',
        variantId: 'ai-fallback-base-message',
        tone: 'Professional',
        characterCount: (campaign?.messageContent || campaign?.taskSettings?.aiPrompt || 'Default message').length
      };
    }
  
    // Default fallback if no conditions matched
    console.log("No message variation type specified, using default");
    return {
      content: campaign?.messageContent || 'Default message',
      variantId: 'default-base-message',
      tone: 'Professional',
      characterCount: (campaign?.messageContent || 'Default message').length
    };
  }
  

  // Check daily message limits (kept but worker also checks device each iteration)
  async checkDailyLimit(campaignId, deviceId) {
    const campaign = await Campaign.findById(campaignId);
    const device = await Device.findById(deviceId);
    if (!campaign || !device) return false;

    const campaignDailySent = await this.getTodaySentCount(campaignId);
    if (campaignDailySent >= (campaign.taskSettings?.dailyMessageLimit || 300)) {
      return false;
    }

    if (device.dailySent >= device.dailyLimit) {
      return false;
    }

    return true;
  }

  async getTodaySentCount(campaignId) {
    const campaign = await Campaign.findById(campaignId);
    return campaign.sentMessagesToday || 0;
  }

  // Start campaign background processing (now adds single process-campaign job)
  async startCampaignProcessing(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId)
        .populate('contactList')
        .populate('device')
        .populate('message');

      if (!campaign || !campaign.contactList) {
        throw new Error('Campaign or contact list not found');
      }
      console.log("campaign_start");

      // Create queue + worker for this campaign
      const queue = await this.createCampaignProcessor(campaignId);
      console.log("campaign_end");
      // Add one job that the worker will process
      await queue.add('process-campaign', {
        campaignId
      }, {
        jobId: `process-campaign-${campaignId}-${Date.now()}` // unique id
      });

      // Update campaign status
      await Campaign.findByIdAndUpdate(campaignId, {
        status: 'active',
        processingStartedAt: new Date()
      });

      console.log(`Queued campaign ${campaignId} for processing`);
      return { success: true };
    } catch (error) {
      console.error('Error starting campaign processing:', error);
      throw error;
    }
  }

  // Get random delay between min and max
  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Pause campaign (pauses queue and sets DB state)
  async pauseCampaign(campaignId, reason = 'manual') {
    const queueName = `campaign-${campaignId}`;
    const queue = this.queues.get(queueName);

    if (queue) {
      try {
        await queue.pause();
      } catch (err) {
        console.error(`Error pausing queue ${queueName}:`, err);
      }
    }

    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'paused',
      pauseReason: reason,
      pausedAt: new Date()
    });

    console.log(`Campaign ${campaignId} paused: ${reason}`);
  }

  // Resume campaign (re-queue a process-campaign job)
  async resumeCampaign(campaignId) {
    // Unpause queue (if exists) and add job again to resume processing
    const queueName = `campaign-${campaignId}`;
    let queue = this.queues.get(queueName);

    if (!queue) {
      // create queue + worker if not present
      queue = await this.createCampaignProcessor(campaignId);
    } else {
      try {
        await queue.resume();
      } catch (err) {
        console.error(`Error resuming queue ${queueName}:`, err);
      }
    }

    // Add a new process-campaign job to pick up where left off
    await queue.add('process-campaign', { campaignId }, {
      jobId: `process-campaign-resume-${campaignId}-${Date.now()}`
    });

    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'active',
      pauseReason: null,
      resumedAt: new Date()
    });

    console.log(`Campaign ${campaignId} resumed`);
  }

  // Stop campaign (obliterate queue + close worker)
  async stopCampaign(campaignId) {
    const queueName = `campaign-${campaignId}`;
    const queue = this.queues.get(queueName);

    if (queue) {
      try {
        await queue.obliterate({ force: true });
      } catch (err) {
        console.error(`Error obliterating queue ${queueName}:`, err);
      }
      this.queues.delete(queueName);
    }

    const worker = this.workers.get(queueName);
    if (worker) {
      try {
        await worker.close();
      } catch (err) {
        console.error(`Error closing worker for ${queueName}:`, err);
      }
      this.workers.delete(queueName);
    }
    console.log("campaign_stopped");
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'paused',
      completedAt: new Date()
    });

    console.log(`Campaign ${campaignId} stopped`);
  }

  // Update campaign stats (incremental updates)
  async updateCampaignStats(campaignId, updates) {
    const updateData = {
      $inc: updates,
      $set: { updatedAt: new Date() }
    };

    if (updates.sentMessages) {
      updateData.$inc.sentMessagesToday = updates.sentMessages;
    }

    // Also increment sentCount for progress tracking if sentMessages present
    if (!updateData.$inc.sentCount && updates.sentMessages) {
      updateData.$inc.sentCount = updates.sentMessages;
    }

    await Campaign.findByIdAndUpdate(campaignId, updateData);
  }

  // Update device daily count
  async updateDeviceDailyCount(deviceId) {
    await Device.findByIdAndUpdate(deviceId, {
      $inc: { dailySent: 1 },
      $set: { lastSeen: new Date() }
    });
  }

  // Reset daily counts (run this daily via cron). Now requeues paused campaigns.
  async resetDailyCounts() {
    // Reset campaign daily counts
    await Campaign.updateMany({}, {
      $set: { sentMessagesToday: 0 }
    });

    // Reset device daily counts
    await Device.updateMany({}, {
      $set: { dailySent: 0 }
    });

    // Resume paused campaigns that hit daily limits by re-queuing them
    const pausedCampaigns = await Campaign.find({
      status: 'paused',
      pauseReason: 'daily_limit_reached'
    });

    for (const campaign of pausedCampaigns) {
      try {
        console.log(`Resuming paused campaign ${campaign._id} after daily reset`);
        await this.resumeCampaign(campaign._id);
      } catch (err) {
        console.error(`Failed to resume campaign ${campaign._id}:`, err);
      }
    }

    console.log('Daily counts reset and campaigns resumed where applicable');
  }

  // Start daily reset scheduler (fallback in case cron job isn't used)
  startDailyResetScheduler() {
    // Run every day at midnight (server local time)
    setInterval(() => {
      this.resetDailyCounts().catch(err => console.error('resetDailyCounts error:', err));
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  // Cleanup stuck jobs
  async cleanupStuckJobs() {
    try {
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);

      for (const [queueName, queue] of this.queues) {
        try {
          await queue.clean(cutoffTime, 1000, 'completed');
          await queue.clean(cutoffTime, 1000, 'failed');
        } catch (err) {
          console.error(`Error cleaning queue ${queueName}:`, err);
        }
      }

      console.log('Stuck jobs cleanup completed');
    } catch (error) {
      console.error('Error cleaning up stuck jobs:', error);
    }
  }

  // Get campaign queue status (unchanged)
  async getCampaignQueueStatus(campaignId) {
    const queueName = `campaign-${campaignId}`;
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { status: 'not_found' };
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed()
      ]);

      return {
        status: 'active',
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        total: waiting.length + active.length + completed.length + failed.length + delayed.length
      };
    } catch (error) {
      console.error(`Error getting queue status for campaign ${campaignId}:`, error);
      return { status: 'error', error: error.message };
    }
  }
}

module.exports = new CampaignService();
