// services/campaignService.js
const { Worker, Queue } = require('bullmq');
const Campaign = require('../models/Campaign');
const ContactList = require('../models/ContactList');
const Contact = require('../models/Contact');
const Device = require('../models/Device');
const redis = require('../config/redis');
const DeviceClient = require('./deviceClient');
const aiGenerationController = require('../controllers/aiGenerationController');
const messageTrackingService = require('./messageTrackingService');

class CampaignService {
  constructor() {
    this.queues = new Map();   // queueName -> Queue
    this.workers = new Map();  // queueName -> Worker
    this.messageTracking = messageTrackingService; 
    this.init();
  }

  init() {
    // Cleanup on startup
    this.cleanupStuckJobs();
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

  // Emit campaign progress via socket.io
  async emitCampaignProgress(campaignId) {
    try {
      const { io } = require('../app');
      const campaign = await Campaign.findById(campaignId)
        .populate('user', '_id')
        .populate('contactList');
      
      if (!campaign || !campaign.user) {
        console.log(`Campaign or user not found for progress emission: ${campaignId}`);
        return;
      }

      // Calculate progress percentage
      const totalContacts = campaign.contactList?.contactCount || 0;
      const progress = totalContacts > 0 ? Math.round((campaign.sentCount / totalContacts) * 100) : 0;

      const updateData = {
        campaignId: campaign._id,
        campaignName: campaign.name,
        updates: {
          sentMessages: campaign.sentMessages || 0,
          deliveredMessages: campaign.deliveredMessages || 0,
          failedMessages: campaign.failedMessages || 0,
          progress: progress,
          status: campaign.status, // Use the actual campaign status
          pauseReason: campaign.pauseReason, // Include pause reason if any
          averageProcessingTime: campaign.averageProcessingTime || 0,
          updatedAt: campaign.updatedAt,
          // Include timestamps for better UI updates
          processingStartedAt: campaign.processingStartedAt,
          pausedAt: campaign.pausedAt,
          resumedAt: campaign.resumedAt,
          completedAt: campaign.completedAt,
        },
      };

      // Emit to user-specific room
      io.to(`user:${campaign.user._id}`).emit("campaign-update", updateData);
      
      console.log(`Progress emitted for campaign ${campaignId}: ${progress}% (Status: ${campaign.status})`);
    } catch (error) {
      console.error(`Error emitting campaign progress for ${campaignId}:`, error);
    }
  }

  // Emit campaign status change (for specific status updates)
  async emitCampaignStatusChange(campaignId, oldStatus, newStatus, reason = null) {
    try {
      const { io } = require('../app');
      const campaign = await Campaign.findById(campaignId).populate('user', '_id');
      
      if (!campaign || !campaign.user) return;

      const statusData = {
        campaignId: campaign._id,
        campaignName: campaign.name,
        statusUpdate: {
          oldStatus,
          newStatus,
          reason,
          timestamp: new Date().toISOString()
        }
      };

      io.to(`user:${campaign.user._id}`).emit("campaign-status-change", statusData);
      console.log(`Campaign status change emitted: ${campaignId} - ${oldStatus} → ${newStatus}`);
    } catch (error) {
      console.error(`Error emitting campaign status change for ${campaignId}:`, error);
    }
  }

  // Track message with comprehensive details
  async trackMessageEvent(campaignId, contact, messageData, status, response = null, error = null, processingTime = null) {
    try {
      const campaign = await Campaign.findById(campaignId)
        .populate('user')
        .populate('device');

      if (!campaign) {
        console.error(`Campaign not found for tracking message: ${campaignId}`);
        return;
      }

      const trackingData = {
        campaignId: campaignId,
        contactId: contact._id,
        phoneNumber: contact.phoneNumber,
        content: messageData.content,
        variantId: messageData.variantId,
        tone: messageData.tone,
        characterCount: messageData.characterCount,
        deviceId: campaign.device._id,
        deviceName: campaign.device.name,
        taskId: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: status,
        processingTime: processingTime,
        response: response,
        error: error,
        userId: campaign.user._id
      };

      await this.messageTracking.trackMessage(trackingData);
      console.log(`Message tracked for campaign ${campaignId}, contact ${contact.phoneNumber}, status: ${status}`);
    } catch (trackingError) {
      console.error(`Error tracking message for campaign ${campaignId}:`, trackingError);
      // Don't throw here - we don't want message tracking failures to stop the campaign
    }
  }

  // New: process entire campaign job (the worker will call this)
  async processCampaignJob(job) {
    const { campaignId } = job.data;
    console.log(`Worker processing campaign ${campaignId}`);

    // Load campaign with relations
    const campaign = await Campaign.findById(campaignId)
      .populate('contactList')
      .populate('device')
      .populate('message')
      .populate('user')
      .populate({
        path: 'message',
        populate: { path: 'variants', model: 'MessageVariant' }
      });

    if (!campaign || !campaign.contactList) {
      console.error(`Campaign or contact list not found for ${campaignId}`);
      await Campaign.findByIdAndUpdate(campaignId, { status: 'failed' });
      await this.emitCampaignProgress(campaignId);
      return;
    }

    // Re-fetch device (fresh)
    const device = await Device.findById(campaign.device._id);
    if (!device) {
      console.error(`Device not found for campaign ${campaignId}`);
      await Campaign.findByIdAndUpdate(campaignId, { status: 'failed' });
      await this.emitCampaignProgress(campaignId);
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
      await this.emitCampaignProgress(campaignId);
      return;
    }

    // Determine resume index (use sentCount as offset)
    const startIndex = Number(campaign.sentCount || 0);
    if (startIndex >= contacts.length) {
      console.log(`Campaign ${campaignId} already finished (sentCount >= contacts)`);
      await Campaign.findByIdAndUpdate(campaignId, { status: 'completed', completedAt: new Date() });
      await this.emitCampaignProgress(campaignId);
      return;
    }

    // Ensure campaign status
    await Campaign.findByIdAndUpdate(campaignId, { status: 'active', processingStartedAt: campaign.processingStartedAt || new Date() });
    await this.emitCampaignProgress(campaignId);

    // iterate contacts sequentially starting from startIndex
    for (let i = startIndex; i < contacts.length; i++) {
      const contact = contacts[i];
      const processingStartTime = Date.now();

      // Re-check campaign status (in case paused/stopped externally)
      const currentCampaign = await Campaign.findById(campaignId);
      if (!currentCampaign) {
        console.log(`Campaign ${campaignId} removed; stopping worker.`);
        await this.emitCampaignProgress(campaignId);
        return;
      }
      if (currentCampaign.status === 'paused' && currentCampaign.pauseReason !== 'resume_requested') {
        console.log(`Campaign ${campaignId} externally paused. Exiting worker.`);
        await this.emitCampaignProgress(campaignId);
        return;
      }
      if (currentCampaign.status === 'completed') {
        console.log(`Campaign ${campaignId} marked completed. Exiting worker.`);
        await this.emitCampaignProgress(campaignId);
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

      // Prepare SMS task
      const smsTask = 
      {
        id: Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
        from: "",
        sms: finalMessage.content,
        interval_min: 0,
        interval_max: 1000,
        timeout: campaign.taskSettings?.timeout || 30,
        charset: campaign.taskSettings?.charset?.toLowerCase() === 'utf-8' ? 'utf8' : 'utf8',
        coding: campaign.taskSettings?.coding || 0,
        //sms_type: campaign.taskSettings?.sms_type || 0,
        sdr: campaign.taskSettings?.sdr !== false,
        fdr: campaign.taskSettings?.fdr !== false,
        dr: campaign.taskSettings?.dr !== false,
        to_all: campaign.taskSettings?.to_all || true,
        //flash_sms: campaign.taskSettings?.flash_sms || false,
        recipients: [contact.phoneNumber],
      };

      try {
        // Track message as pending before sending
        // await this.trackMessageEvent(
        //   campaignId, 
        //   contact, 
        //   finalMessage, 
        //   'pending', 
        //   null, 
        //   null, 
        //   null
        // );

        const client = new DeviceClient(freshDevice);
        const ejoinResponse = await client.sendSms([smsTask]);
        console.log("sendSms_result", ejoinResponse);

        const processingTime = Date.now() - processingStartTime;

        if (ejoinResponse?.[0]?.reason === "OK") {  
          // Update campaign stats and device counters
          await this.updateCampaignStats(campaignId, { sentMessages: 1, lastSentAt: new Date() });
          await this.updateDeviceDailyCount(freshDevice._id);

          // Track successful message
          await this.trackMessageEvent(
            campaignId, 
            contact, 
            finalMessage, 
            'sent', 
            ejoinResponse, 
            null, 
            processingTime
          );

          // Optionally persist lastSentContactIndex
          await Campaign.findByIdAndUpdate(campaignId, {
            $set: { lastSentContactId: contact._id, updatedAt: new Date() }
          });

          // Emit progress update after successful send
          await this.emitCampaignProgress(campaignId);
        } else {
          // Handle failure response
          console.error(`SMS send responded with error for campaign ${campaignId}`, ejoinResponse);
          await this.updateCampaignStats(campaignId, { failedMessages: 1 });

          // Track failed message
          await this.trackMessageEvent(
            campaignId, 
            contact, 
            finalMessage, 
            'failed', 
            ejoinResponse, 
            ejoinResponse?.[0]?.reason || 'Unknown error', 
            processingTime
          );

          // Emit progress update even on failure to show failed count
          await this.emitCampaignProgress(campaignId);
        }

      } catch (err) {
        const processingTime = Date.now() - processingStartTime;
        console.error(`Error sending SMS for campaign ${campaignId} to ${contact.phoneNumber}:`, err);
        await this.updateCampaignStats(campaignId, { failedMessages: 1 });

        // Track errored message
        await this.trackMessageEvent(
          campaignId, 
          contact, 
          finalMessage, 
          'failed', 
          null, 
          err.message, 
          processingTime
        );

        // Emit progress update on error
        await this.emitCampaignProgress(campaignId);
        // Optionally implement retry/backoff here; for now continue to next contact
      }

      // Completed campaign
      await Campaign.findByIdAndUpdate(campaignId, {
        status: 'completed',
        completedAt: new Date()
      });
      
      // Emit final progress update
      await this.emitCampaignProgress(campaignId);
      await this.emitCampaignStatusChange(campaignId, 'active', 'completed', 'campaign_finished');
      

      // Delay between sends (interval). Worker will sleep here.
      const delay = this.getRandomDelay(
        campaign.taskSettings?.interval_min || 30000,
        campaign.taskSettings?.interval_max || 90000
      );
      console.log(`Campaign ${campaignId}: waiting ${delay / 1000}s before next send...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

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
      
      console.log("current_campaign:", campaign);
      console.log("current_campaign_message:", campaign?.message);
      console.log("current_campaign_message:", campaign?.message?.settings);
      console.log("current_campaign_message:", campaign?.message?.settings?.characterLimit);
      // Use the AI generation controller
      try {
        const aiResponse = await aiGenerationController.generateWithGrok({
          prompt: campaign?.message?.originalPrompt || campaign?.message?.baseMessage,
          variantCount: 1,
          characterLimit:campaign?.message?.settings?.get("characterLimit"),
          tones: campaign?.message?.settings?.get("tones"),
          languages: campaign?.message?.settings?.get("languages"),
          creativityLevel: campaign?.message?.settings?.get("creativityLevel"),
          includeEmojis: campaign?.message?.settings?.get("includeEmojis"),
          companyName: campaign?.message?.settings?.get("companyName") || 'Your company',
          unsubscribeText: campaign?.message?.settings?.get("unsubscribeText"),
          customInstructions: campaign?.message?.settings?.get("customInstructions")
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

  // Check daily message limits
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

  // Start campaign background processing
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

      // Emit start event via socket
      await this.emitCampaignStatusChange(campaignId, 'draft', 'active', 'campaign_started');
      await this.emitCampaignProgress(campaignId);

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

    // Get current status before updating
    const currentCampaign = await Campaign.findById(campaignId);
    const oldStatus = currentCampaign?.status || 'active';

    // Update campaign status
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'paused',
      pauseReason: reason,
      pausedAt: new Date()
    });

    // Emit pause events via socket
    await this.emitCampaignStatusChange(campaignId, oldStatus, 'paused', reason);
    await this.emitCampaignProgress(campaignId);

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

    // Update campaign status
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'active',
      pauseReason: null,
      resumedAt: new Date()
    });

    // Emit resume events via socket
    await this.emitCampaignStatusChange(campaignId, 'paused', 'active', 'campaign_resumed');
    await this.emitCampaignProgress(campaignId);

    console.log(`Campaign ${campaignId} resumed`);
  }

  // Stop campaign (obliterate queue + close worker)
  async stopCampaign(campaignId) {
    const queueName = `campaign-${campaignId}`;
    const queue = this.queues.get(queueName);

    // Get current status before updating
    const currentCampaign = await Campaign.findById(campaignId);
    const oldStatus = currentCampaign?.status || 'active';

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
    
    // Update campaign status
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'stopped',
      completedAt: new Date()
    });

    // Emit stop events via socket
    await this.emitCampaignStatusChange(campaignId, oldStatus, 'stopped', 'manual_stop');
    await this.emitCampaignProgress(campaignId);

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
      updateData.$inc.deliveredMessages = updates.sentMessages;
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

  // Get campaign queue status
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
  // Restore campaign processors after server restart
  async restoreActiveCampaigns() {
    try {
      console.log('Restoring active campaigns after restart...');
      const activeCampaigns = await Campaign.find({
        status: { $in: ['active', 'paused'] } // restore these
      });

      for (const campaign of activeCampaigns) {
        console.log(`Restoring campaign queue for: ${campaign._id}`);
        const queue = await this.createCampaignProcessor(campaign._id);

        // Optionally re-add the job if not already in Redis
        const jobs = await queue.getJobs(['waiting', 'active', 'delayed']);
        const alreadyQueued = jobs.some(job => job.data.campaignId.toString() === campaign._id.toString());
        
        if (!alreadyQueued && campaign.status === 'active') {
          console.log(`Re-adding process-campaign job for ${campaign._id}`);
          await queue.add('process-campaign', { campaignId: campaign._id }, {
            jobId: `process-campaign-${campaign._id}-${Date.now()}`
          });  
        }
      }

      console.log('✅ Active campaign restoration completed.');
    } catch (err) {
      console.error('Error restoring campaigns:', err);
    }
  }

}

module.exports = new CampaignService();