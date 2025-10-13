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

class CampaignService {
  constructor() {
    this.queues = new Map();
    this.workers = new Map();
    this.init();
  }

  init() {
    // Cleanup on startup
    this.cleanupStuckJobs();
    
    // Start daily reset scheduler
    this.startDailyResetScheduler();
  }

  // Create campaign queue and worker
  async createCampaignProcessor(campaignId) {
    const queueName = `campaign:${campaignId}`;
    
    if (this.queues.has(queueName)) {
      return this.queues.get(queueName);
    }

    const queue = redis.createQueue(queueName, {
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    });

    const worker = redis.createWorker(queueName, this.processCampaignJob.bind(this), {
      concurrency: 1 // Process one message at a time
    });

    this.queues.set(queueName, queue);
    this.workers.set(queueName, worker);

    return queue;
  }

  // Process individual campaign messages
  async processCampaignJob(job) {
    const { campaignId, contact, device, taskSettings } = job.data;
    
    try {
      console.log(`Processing SMS for campaign ${campaignId} to ${contact.phoneNumber}`);
      
      // Check daily limits
      const canSend = await this.checkDailyLimit(campaignId, device._id);
      if (!canSend) {
        console.log(`Daily limit reached for campaign ${campaignId}, pausing...`);
        await this.pauseCampaign(campaignId, 'daily_limit_reached');
        return { status: 'paused', reason: 'daily_limit_reached' };
      }

      // Generate or select message variant
      const finalMessage = await this.generateMessageVariant(
        campaignId,
        taskSettings, 
        contact
      );

      // Prepare SMS task
      const smsTask = {
        id: Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
        from: "",
        sms: finalMessage.content,
        interval_min: taskSettings.interval_min || 30000,
        interval_max: taskSettings.interval_max || 50000,
        timeout: taskSettings.timeout || 30,
        charset: taskSettings.charset?.toLowerCase() === 'utf-8' ? 'utf8' : 'utf8',
        coding: taskSettings.coding || 0,
        sms_type: taskSettings.sms_type || 0,
        sdr: taskSettings.sdr !== false,
        fdr: taskSettings.fdr !== false,
        dr: taskSettings.dr !== false,
        to_all: taskSettings.to_all || true,
        flash_sms: taskSettings.flash_sms || false,
        recipients: [contact.phoneNumber],
      };

      const client = new DeviceClient(device);
      const ejoinResponse = await client.sendSms(smsTask);
      console.log("sendSms_result",ejoinResponse);
      // [ { id: 1086473958, code: 0, reason: 'OK' } ]

      // Send SMS
      //const ejoinResponse = await EjoinAPI.submitSmsTasks(device, [smsTask]);
      
      if (ejoinResponse?.[0]?.reason === "OK") {
        // Update campaign stats
        await this.updateCampaignStats(campaignId, {
          sentMessages: 1,
          lastSentAt: new Date()
        });

        // Update device daily count
        await this.updateDeviceDailyCount(device._id);

        return { 
          status: 'sent', 
          taskId: ejoinResponse[0].id,
          phoneNumber: contact.phoneNumber,
          message: finalMessage.content,
          variantId: finalMessage.variantId
        };
      } else {
        throw new Error(`SMS sending failed: ${ejoinResponse.message}`);
      }
    } catch (error) {
      console.error(`Error processing campaign job for ${campaignId}:`, error);
      
      // Update failed count
      await this.updateCampaignStats(campaignId, {
        failedMessages: 1
      });

      throw error;
    }
  }

  // Generate message variant (AI or static)
  async generateMessageVariant(campaignId, taskSettings, contact) {
    const campaign = await Campaign.findById(campaignId).populate('message');
    
    if (taskSettings.useAiGeneration && taskSettings.aiPrompt) {
      try {
        // Generate AI message variant on the fly
        const aiResponse = await messageAPI.generateVariants({
          prompt: taskSettings.aiPrompt,
          variantCount: 1,
          characterLimit: 160,
          tones: ['Professional', 'Friendly', 'Urgent'],
          languages: ['English'],
          creativityLevel: 0.8,
          includeEmojis: true,
          companyName: taskSettings.companyName || 'Our Company',
          unsubscribeText: 'Reply STOP to unsubscribe',
          customInstructions: `Include personalization for ${contact.firstName || 'customer'}`
        });

        if (aiResponse.data?.variants?.[0]?.content) {
          const variant = aiResponse.data.variants[0];
          return {
            content: variant.content,
            variantId: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            tone: variant.tone,
            characterCount: variant.characterCount
          };
        }
      } catch (error) {
        console.error('AI message generation failed, using fallback:', error);
        // Fall back to base message
      }
    }

    // Use static variants from message or base message
    if (campaign?.message?.variants && campaign.message.variants.length > 0) {
      const randomVariant = campaign.message.variants[
        Math.floor(Math.random() * campaign.message.variants.length)
      ];
      return {
        content: randomVariant.content,
        variantId: randomVariant._id,
        tone: randomVariant.tone,
        characterCount: randomVariant.characterCount
      };
    }

    // Use campaign's base message
    return {
      content: campaign?.messageContent || taskSettings.aiPrompt || 'Default message',
      variantId: 'base-message',
      tone: 'Professional',
      characterCount: (campaign?.messageContent || taskSettings.aiPrompt || 'Default message').length
    };
  }

  // Check daily message limits
  async checkDailyLimit(campaignId, deviceId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const campaign = await Campaign.findById(campaignId);
    const device = await Device.findById(deviceId);

    if (!campaign || !device) return false;

    // Check campaign daily limit
    const campaignDailySent = await this.getTodaySentCount(campaignId);
    if (campaignDailySent >= (campaign.taskSettings?.dailyMessageLimit || 300)) {
      return false;
    }

    // Check device daily limit
    if (device.dailySent >= device.dailyLimit) {
      return false;
    }

    return true;
  }

  async getTodaySentCount(campaignId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's sent messages from campaign stats
    const campaign = await Campaign.findById(campaignId);
    return campaign.sentMessagesToday || 0;
  }

  // Start campaign background processing
  async startCampaignProcessing(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId)
        .populate('contactList')
        .populate('device')
        .populate('message')
        .populate({
          path: 'message',
          populate: {
            path: 'variants',
            model: 'MessageVariant'
          }
        });

      if (!campaign || !campaign.contactList) {
        throw new Error('Campaign or contact list not found');
      }

      // Get opted-in contacts
      const contacts = await Contact.find({
        contactList: campaign.contactList._id,
        optedIn: true
      });

      if (contacts.length === 0) {
        throw new Error('No opted-in contacts found');
      }

      // Create campaign queue
      const queue = await this.createCampaignProcessor(campaignId);

      // Add jobs to queue with random delays
      for (const contact of contacts) {
        const delay = this.getRandomDelay(
          campaign.taskSettings?.interval_min || 30000,
          campaign.taskSettings?.interval_max || 90000
        );

        await queue.add('send-sms', {
          campaignId,
          contact,
          device: campaign.device,
          taskSettings: campaign.taskSettings
        }, {
          delay,
          jobId: `${campaignId}-${contact.phoneNumber}-${Date.now()}`
        });
      }

      // Update campaign status
      await Campaign.findByIdAndUpdate(campaignId, {
        status: 'active',
        processingStartedAt: new Date(),
        totalContacts: contacts.length
      });

      console.log(`Started processing campaign ${campaignId} with ${contacts.length} contacts`);

      return { success: true, queuedContacts: contacts.length };
    } catch (error) {
      console.error('Error starting campaign processing:', error);
      throw error;
    }
  }

  // Get random delay between min and max
  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Pause campaign
  async pauseCampaign(campaignId, reason = 'manual') {
    const queueName = `campaign:${campaignId}`;
    const queue = this.queues.get(queueName);
    
    if (queue) {
      await queue.pause();
    }

    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'paused',
      pauseReason: reason
    });

    console.log(`Campaign ${campaignId} paused: ${reason}`);
  }

  // Resume campaign
  async resumeCampaign(campaignId) {
    const queueName = `campaign:${campaignId}`;
    const queue = this.queues.get(queueName);
    
    if (queue) {
      await queue.resume();
    }

    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'active',
      pauseReason: null
    });

    console.log(`Campaign ${campaignId} resumed`);
  }

  // Stop campaign
  async stopCampaign(campaignId) {
    const queueName = `campaign:${campaignId}`;
    const queue = this.queues.get(queueName);
    
    if (queue) {
      await queue.obliterate({ force: true });
      this.queues.delete(queueName);
    }

    const worker = this.workers.get(queueName);
    if (worker) {
      await worker.close();
      this.workers.delete(queueName);
    }

    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'completed',
      completedAt: new Date()
    });

    console.log(`Campaign ${campaignId} stopped`);
  }

  // Update campaign stats
  async updateCampaignStats(campaignId, updates) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const updateData = {
      $inc: updates,
      $set: { updatedAt: new Date() }
    };

    // If updating sent messages, also update today's count
    if (updates.sentMessages) {
      updateData.$inc.sentMessagesToday = updates.sentMessages;
    }

    await Campaign.findByIdAndUpdate(campaignId, updateData);
  }

  // Update device daily count
  async updateDeviceDailyCount(deviceId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await Device.findByIdAndUpdate(deviceId, {
      $inc: { dailySent: 1 },
      $set: { lastSeen: new Date() }
    });
  }

  // Reset daily counts (run this daily via cron)
  async resetDailyCounts() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Reset campaign daily counts
    await Campaign.updateMany({}, {
      $set: { sentMessagesToday: 0 }
    });

    // Reset device daily counts
    await Device.updateMany({}, {
      dailySent: 0
    });

    // Resume paused campaigns that hit daily limits
    const pausedCampaigns = await Campaign.find({
      status: 'paused',
      pauseReason: 'daily_limit_reached'
    });

    for (const campaign of pausedCampaigns) {
      await this.resumeCampaign(campaign._id);
    }

    console.log('Daily counts reset and campaigns resumed');
  }

  // Start daily reset scheduler
  startDailyResetScheduler() {
    // Run every day at midnight
    setInterval(() => {
      this.resetDailyCounts();
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  // Cleanup stuck jobs
  async cleanupStuckJobs() {
    try {
      // Clean jobs older than 24 hours
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
      
      for (const [queueName, queue] of this.queues) {
        await queue.clean(cutoffTime, 1000, 'completed');
        await queue.clean(cutoffTime, 1000, 'failed');
      }
      
      console.log('Stuck jobs cleanup completed');
    } catch (error) {
      console.error('Error cleaning up stuck jobs:', error);
    }
  }

  // Get campaign queue status
  async getCampaignQueueStatus(campaignId) {
    const queueName = `campaign:${campaignId}`;
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