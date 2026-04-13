// services/campaignService.js
const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Device = require('../models/Device');
const Sim = require('../models/Sim');
const redis = require('../config/redis');
const DeviceClient = require('./deviceClient');
const messageTrackingService = require('./messageTrackingService');
const CampaignSimService = require('./campaignSimService');
const CampaignVariantService = require('./campaignVariantService');

class CampaignService {
  constructor() {
    this.queues = new Map();   // queueName -> Queue
    this.workers = new Map();  // queueName -> Worker
    this.messageTracking = messageTrackingService;
    this.simRoundRobinIndex = new Map(); // campaignId -> current SIM index
    this.variantRoundRobinIndex = new Map(); // campaignId -> current variant index
    this.simService = new CampaignSimService({
      simRoundRobinIndex: this.simRoundRobinIndex
    });
    this.variantService = new CampaignVariantService({
      variantRoundRobinIndex: this.variantRoundRobinIndex
    });
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

  // Get available SIMs for a device in circular order
  async getAvailableSims(deviceId, campaignId) {
    return this.simService.getAvailableSims(deviceId, campaignId);
  }

  // Reset SIM daily count if it's a new day
  async resetSimDailyCountIfNeeded(sim) {
    return this.simService.resetSimDailyCountIfNeeded(sim);
  }

  // Get SIM for contact (with affinity)
  async getSimForContact(deviceId, campaignId, contact) {
    return this.simService.getSimForContact(deviceId, campaignId, contact);
  }

  // Assign SIM to contact
  async assignSimToContact(contactId, simId, deviceId) {
    return this.simService.assignSimToContact(contactId, simId, deviceId);
  }

  // Update SIM usage timestamp for contact
  async updateContactSimUsage(contactId, simId) {
    return this.simService.updateContactSimUsage(contactId, simId);
  }

  // FIXED: Proper timezone conversion
  isWithinAllowedHours(timeRestrictions) {
    if (!timeRestrictions?.enabled) {
      return true; // No restrictions enabled
    }

    try {
      const now = new Date();
      const timezone = timeRestrictions.timezone || 'America/Toronto';

      // Convert current time to target timezone using proper method
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
        minute: '2-digit'
      });

      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find(part => part.type === 'hour').value);
      const minute = parseInt(parts.find(part => part.type === 'minute').value);
      const currentTimeInMinutes = hour * 60 + minute;

      const startHour = timeRestrictions.startHour || 9;
      const endHour = timeRestrictions.endHour || 17;
      const startTimeInMinutes = startHour * 60;
      const endTimeInMinutes = endHour * 60;

      console.log(`Time check - Current: ${hour}:${minute} (${currentTimeInMinutes}min), Allowed: ${startHour}:00-${endHour}:00 (${startTimeInMinutes}-${endTimeInMinutes}min), Timezone: ${timezone}`);

      // Handle normal time ranges
      if (startTimeInMinutes <= endTimeInMinutes) {
        return currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes < endTimeInMinutes;
      } else {
        // Overnight range (e.g., 22:00 - 6:00)
        return currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes < endTimeInMinutes;
      }
    } catch (error) {
      console.error('Error checking time restrictions:', error);
      return true; // Default to allowing if there's an error
    }
  }

  // FIXED: Enhanced time restriction check with better state management
  async checkAndHandleTimeRestrictions(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign || !campaign.taskSettings?.timeRestrictions?.enabled) {
        return { shouldProcess: true, reason: 'no_restrictions' };
      }

      const timeRestrictions = campaign.taskSettings.timeRestrictions;
      const isWithinHours = this.isWithinAllowedHours(timeRestrictions);

      console.log(`Time restriction check for campaign ${campaignId}:`, {
        enabled: timeRestrictions.enabled,
        timezone: timeRestrictions.timezone,
        startHour: timeRestrictions.startHour,
        endHour: timeRestrictions.endHour,
        isWithinHours,
        currentStatus: campaign.status,
        pauseReason: campaign.pauseReason
      });

      // Handle auto-pause when outside hours
      if (campaign.status === 'active' && !isWithinHours) {
        console.log(`Auto-pausing campaign ${campaignId} - outside allowed hours`);
        await Campaign.findByIdAndUpdate(campaignId, {
          status: 'paused',
          pauseReason: 'outside_allowed_hours',
          pausedAt: new Date(),
          updatedAt: new Date()
        });

        // Pause the queue to stop processing
        const queueName = `campaign-${campaignId}`;
        const queue = this.queues.get(queueName);
        if (queue) {
          try {
            await queue.pause();
          } catch (err) {
            console.error(`Error pausing queue ${queueName}:`, err);
          }
        }

        await this.emitCampaignStatusChange(campaignId, 'active', 'paused', 'outside_allowed_hours');
        return { shouldProcess: false, reason: 'outside_hours_paused' };
      }

      // Handle auto-resume when back within hours
      if (campaign.status === 'paused' &&
        campaign.pauseReason === 'outside_allowed_hours' &&
        isWithinHours) {
        console.log(`Auto-resuming campaign ${campaignId} - within allowed hours`);

        // Resume the queue
        const queueName = `campaign-${campaignId}`;
        const queue = this.queues.get(queueName);
        if (queue) {
          try {
            await queue.resume();
          } catch (err) {
            console.error(`Error resuming queue ${queueName}:`, err);
          }
        }

        await Campaign.findByIdAndUpdate(campaignId, {
          status: 'active',
          pauseReason: null,
          resumedAt: new Date(),
          updatedAt: new Date()
        });

        await this.emitCampaignStatusChange(campaignId, 'paused', 'active', 'within_hours_auto_resume');
        return { shouldProcess: true, reason: 'within_hours_resumed' };
      }

      // If campaign is paused for time restrictions and still outside hours, don't process
      if (campaign.status === 'paused' && campaign.pauseReason === 'outside_allowed_hours' && !isWithinHours) {
        return { shouldProcess: false, reason: 'still_outside_hours' };
      }

      return { shouldProcess: isWithinHours, reason: isWithinHours ? 'within_hours' : 'outside_hours' };
    } catch (error) {
      console.error(`Error checking time restrictions for campaign ${campaignId}:`, error);
      return { shouldProcess: true, reason: 'error_default_allow' };
    }
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
      console.log(`usCampaign status change emitted: ${campaignId} - ${oldStatus} → ${newStatus}`);
      console.log(`user:${campaign.user._id}`);
    } catch (error) {
      console.error(`Error emitting campaign status change for ${campaignId}:`, error);
    }
  }

  // Track message with comprehensive details
  async trackMessageEvent(campaignId, contact, messageData, status, response = null, error = null, processingTime = null, simId = null, taskId = null) {
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
        simId: simId, // Track which SIM was used
        taskId: taskId,
        status: status,
        processingTime: processingTime,
        response: response,
        error: error,
        userId: campaign.user._id
      };

      await this.messageTracking.trackMessage(trackingData);
      console.log(`Message tracked for campaign ${campaignId}, contact ${contact.phoneNumber}, status: ${status}, SIM: ${simId}`);
    } catch (trackingError) {
      console.error(`Error tracking message for campaign ${campaignId}:`, trackingError);
      // Don't throw here - we don't want message tracking failures to stop the campaign
    }
  }

  // Process entire campaign job (the worker will call this)
  async processCampaignJob(job) {
    const { campaignId } = job.data;
    console.log(`Worker processing campaign ${campaignId}`);

    // FIXED: Check time restrictions BEFORE loading campaign data
    const timeCheck = await this.checkAndHandleTimeRestrictions(campaignId);
    if (!timeCheck.shouldProcess) {
      console.log(`Campaign ${campaignId} cannot process: ${timeCheck.reason}`);
      return;
    }

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

    if (!campaign || !campaign.contactList || !campaign.device) {
      console.error(`Campaign, contact list, or device not found for ${campaignId}`);
      await Campaign.findByIdAndUpdate(campaignId, { status: 'failed' });
      await this.emitCampaignProgress(campaignId);
      return;
    }

    // FIXED: Double-check time restrictions after loading campaign
    const finalTimeCheck = await this.checkAndHandleTimeRestrictions(campaignId);
    if (!finalTimeCheck.shouldProcess) {
      console.log(`Campaign ${campaignId} stopped processing due to time restrictions: ${finalTimeCheck.reason}`);
      return;
    }

    // Get available SIMs for the device (just for validation)
    let availableSims;
    try {
      availableSims = await this.getAvailableSims(campaign.device._id, campaignId);
      if (availableSims.length === 0) {
        console.error(`No available SIMs for campaign ${campaignId}`);
        await this.pauseCampaign(campaignId, 'no_available_sims');
        return;
      }
    } catch (error) {
      console.error(`Error getting SIMs for campaign ${campaignId}:`, error);
      await this.pauseCampaign(campaignId, 'sim_error');
      return;
    }

    // Load opted-in contacts with their assigned SIM data
    let contacts = await Contact.find({
      contactList: campaign.contactList._id,
      optedIn: true
    })
      .populate('assignedSim.simId')
      .sort({ _id: 1 })
      .lean();

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
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'active',
      processingStartedAt: campaign.processingStartedAt || new Date()
    });
    await this.emitCampaignProgress(campaignId);

    // Process contacts sequentially starting from startIndex
    for (let i = startIndex; i < contacts.length; i++) {
      const contact = contacts[i];
      const processingStartTime = Date.now();

      // FIXED: Check time restrictions before each message
      const perMessageTimeCheck = await this.checkAndHandleTimeRestrictions(campaignId);
      if (!perMessageTimeCheck.shouldProcess) {
        console.log(`Stopping campaign ${campaignId} at contact ${i} due to time restrictions`);
        return;
      }

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

      // Get SIM for contact 
      let sim;
      try {
        sim = await this.getSimForContact(campaign.device._id, campaignId, contact);
      } catch (error) {
        console.error(`No available SIM found for campaign ${campaignId}:`, error);
        await this.pauseCampaign(campaignId, 'daily_limit_reached');
        return;
      }
      console.log("SIM selected sim.port", sim.port.toString())

      // Generate message variant
      const finalMessage = await this.generateMessageVariant(campaignId, campaign.taskSettings || {}, contact);

      // Prepare SMS task with specific SIM port
      const smsTask = {
        id: Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
        from: sim.port.toString(), // Use SIM port number as 'from'
        sms: finalMessage.content,
        interval_min: 0,
        interval_max: 1000,
        timeout: campaign.taskSettings?.timeout || 30,
        charset: campaign.taskSettings?.charset?.toLowerCase() === 'utf-8' ? 'utf8' : 'utf8',
        coding: campaign.taskSettings?.coding || 0,
        sdr: campaign.taskSettings?.sdr !== false,
        fdr: campaign.taskSettings?.fdr !== false,
        dr: campaign.taskSettings?.dr !== false,
        to_all: campaign.taskSettings?.to_all || true,
        recipients: [contact.phoneNumber],
      };

      try {
        const client = new DeviceClient(campaign.device);
        const ejoinResponse = await client.sendSms([smsTask]);
        console.log("sendSms_result", ejoinResponse);

        const processingTime = Date.now() - processingStartTime;

        if (ejoinResponse?.[0]?.reason === "OK") {
          // Update campaign stats and SIM counters
          await this.updateSimDailyCount(sim._id);

          // Update device last seen
          await Device.findByIdAndUpdate(campaign.device._id, {
            $set: { lastSeen: new Date() }
          });

          // Track successful message
          await this.trackMessageEvent(
            campaignId,
            contact,
            finalMessage,
            'sent',
            ejoinResponse,
            null,
            processingTime,
            sim._id,
            ejoinResponse?.[0]?.id
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

          // Track failed message
          await this.trackMessageEvent(
            campaignId,
            contact,
            finalMessage,
            'failed',
            ejoinResponse,
            ejoinResponse?.[0]?.reason || 'Unknown error',
            processingTime,
            sim._id,
            ejoinResponse?.[0]?.id
          );

          // Emit progress update even on failure to show failed count
          await this.emitCampaignProgress(campaignId);
        }

      } catch (err) {
        const processingTime = Date.now() - processingStartTime;
        console.error(`Error sending SMS for campaign ${campaignId} to ${contact.phoneNumber}:`, err);

        // Track errored message
        await this.trackMessageEvent(
          campaignId,
          contact,
          finalMessage,
          'failed',
          null,
          err.message,
          processingTime,
          sim._id,
          null
        );

        // Emit progress update on error
        await this.emitCampaignProgress(campaignId);
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

    // Campaign completed
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'completed',
      completedAt: new Date()
    });

    // Emit final progress update
    await this.emitCampaignProgress(campaignId);
    await this.emitCampaignStatusChange(campaignId, 'active', 'completed', 'campaign_finished');

    console.log(`Campaign ${campaignId} completed successfully`);
    return;
  }

  // Generate message variant (AI or static) with round-robin for multiple variants
  async generateMessageVariant(campaignId, taskSettings, contact) {
    return this.variantService.generateMessageVariant(campaignId, taskSettings, contact);
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

    // Check if any SIMs are available
    try {
      const availableSims = await this.getAvailableSims(deviceId, campaignId);
      return availableSims.length > 0;
    } catch (error) {
      return false;
    }
  }

  async getTodaySentCount(campaignId) {
    const campaign = await Campaign.findById(campaignId);
    return campaign.sentMessagesToday || 0;
  }

  // FIXED: Enhanced start campaign with time restriction validation
  async startCampaignProcessing(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId)
        .populate('contactList')
        .populate('device')
        .populate('message');

      if (!campaign || !campaign.contactList) {
        throw new Error('Campaign or contact list not found');
      }

      // FIXED: Enhanced time restriction check before starting
      if (campaign?.taskSettings?.timeRestrictions?.enabled) {
        const timeCheck = await this.checkAndHandleTimeRestrictions(campaignId);

        if (!timeCheck.shouldProcess) {
          console.log(`Cannot start campaign ${campaignId} - ${timeCheck.reason}`);

          // Only update if not already in the correct state
          if (campaign.status !== 'paused' || campaign.pauseReason !== timeCheck.reason) {
            await Campaign.findByIdAndUpdate(campaignId, {
              status: 'paused',
              pauseReason: timeCheck.reason,
              pausedAt: new Date(),
              updatedAt: new Date()
            });

            await this.emitCampaignStatusChange(campaignId, campaign.status, 'paused', timeCheck.reason);
          }

          throw new Error(`Cannot start campaign: ${timeCheck.reason}`);
        }
      }

      // Create queue + worker for this campaign
      const queue = await this.createCampaignProcessor(campaignId);

      // Add one job that the worker will process
      await queue.add('process-campaign', {
        campaignId
      }, {
        jobId: `process-campaign-${campaignId}-${Date.now()}` // unique id
      });

      // Update campaign status
      await Campaign.findByIdAndUpdate(campaignId, {
        status: 'active',
        processingStartedAt: new Date(),
        pauseReason: null, // Clear any previous pause reason
        updatedAt: new Date()
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

  // FIXED: Enhanced pause campaign with better state management
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

    // Only update if not already in the target state
    if (currentCampaign?.status !== 'paused' || currentCampaign?.pauseReason !== reason) {
      await Campaign.findByIdAndUpdate(campaignId, {
        status: 'paused',
        pauseReason: reason,
        pausedAt: new Date()
      });

      // Emit pause events via socket
      await this.emitCampaignStatusChange(campaignId, oldStatus, 'paused', reason);
      await this.emitCampaignProgress(campaignId);

      console.log(`Campaign ${campaignId} paused: ${reason}`);
    } else {
      console.log(`Campaign ${campaignId} already paused with reason: ${reason}`);
    }
  }

  // FIXED: Enhanced resume campaign with time restriction check
  // FIXED: Enhanced resume campaign with better time restriction handling
  async resumeCampaign(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      // If campaign was paused due to time restrictions, check if we're now within hours
      if (campaign.pauseReason === 'outside_allowed_hours') {
        const timeCheck = await this.checkAndHandleTimeRestrictions(campaignId);

        if (!timeCheck.shouldProcess) {
          console.log(`Cannot resume campaign ${campaignId} - still outside allowed hours`);
          // Keep it paused with the same reason
          await Campaign.findByIdAndUpdate(campaignId, {
            status: 'paused',
            pauseReason: 'outside_allowed_hours',
            updatedAt: new Date()
          });
          throw new Error('Cannot resume campaign outside allowed hours');
        }

        // If we're now within hours, clear the pause reason and continue
        console.log(`Campaign ${campaignId} is now within allowed hours, proceeding with resume`);
      }

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

      // Update campaign status - clear pause reason if it was for time restrictions
      const updateData = {
        status: 'active',
        resumedAt: new Date(),
        updatedAt: new Date()
      };

      // Only clear pause reason if it was for time restrictions
      if (campaign.pauseReason === 'outside_allowed_hours') {
        updateData.pauseReason = null;
      }

      await Campaign.findByIdAndUpdate(campaignId, updateData);

      // Emit resume events via socket
      await this.emitCampaignStatusChange(campaignId, 'paused', 'active', 'campaign_resumed');
      await this.emitCampaignProgress(campaignId);

      console.log(`Campaign ${campaignId} resumed successfully`);

    } catch (error) {
      console.error(`Error resuming campaign ${campaignId}:`, error);
      throw error;
    }
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

    // Clear round-robin indices for this campaign
    this.simRoundRobinIndex.delete(campaignId);
    this.variantRoundRobinIndex.delete(campaignId);

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

  // Update SIM daily count
  async updateSimDailyCount(simId) {
    await Sim.findByIdAndUpdate(simId, {
      $inc: { dailySent: 1, todaySent: 1 },
      $set: { lastUpdated: new Date() }
    });
  }

  async getPreviousCampaignMessages(campaignId, limit = 50) {
    return this.variantService.getPreviousCampaignMessages(campaignId, limit);
  }

  // Reset daily counts (run this daily via cron). Now requeues paused campaigns.
  async resetDailyCounts() {
    // Reset campaign daily counts
    await Campaign.updateMany({}, {
      $set: { sentMessagesToday: 0 }
    });

    // Reset SIM daily counts
    await Sim.updateMany({}, {
      $set: { dailySent: 0, todaySent: 0, lastResetDate: new Date() }
    });

    // Reset device daily counts
    await Device.updateMany({}, {
      $set: { dailySent: 0 }
    });

    // Resume paused campaigns that hit daily limits by re-queuing them
    // const pausedCampaigns = await Campaign.find({
    //   status: 'paused',
    //   $or: [
    //     { pauseReason: 'daily_limit_reached' },
    //     { pauseReason: 'no_available_sims' }
    //   ]
    // });

    // for (const campaign of pausedCampaigns) {
    //   try {
    //     console.log(`Resuming paused campaign ${campaign._id} after daily reset`);
    //     await this.resumeCampaign(campaign._id);
    //   } catch (err) {
    //     console.error(`Failed to resume campaign ${campaign._id}:`, err);
    //   }
    // }

    // console.log('Daily counts reset for campaigns, SIMs, and devices');
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

  // Get contact's assigned SIM information
  async getContactSimInfo(contactId) {
    return this.simService.getContactSimInfo(contactId);
  }

  // Reassign SIM to contact (manual override)
  async reassignSimToContact(contactId, newSimId, deviceId) {
    return this.simService.reassignSimToContact(contactId, newSimId, deviceId);
  }

  // Get campaign SIM usage statistics
  async getCampaignSimUsage(campaignId) {
    return this.simService.getCampaignSimUsage(campaignId);
  }

  // Reset variant round-robin index for a campaign
  async resetVariantRoundRobin(campaignId) {
    return this.variantService.resetVariantRoundRobin(campaignId);
  }

  // NEW: Check all campaigns for time restrictions (to be called by cron job)
  async checkAllCampaignTimeRestrictions() {
    try {
      const campaigns = await Campaign.find({
        status: { $in: ['active', 'paused'] },
        'taskSettings.timeRestrictions.enabled': true
      });

      console.log(`Checking time restrictions for ${campaigns.length} campaigns`);

      for (const campaign of campaigns) {
        try {
          await this.checkAndHandleTimeRestrictions(campaign._id);
        } catch (error) {
          console.error(`Error checking time restrictions for campaign ${campaign._id}:`, error);
        }
      }

      console.log('Completed time restriction checks for all campaigns');
    } catch (error) {
      console.error('Error checking all campaign time restrictions:', error);
    }
  }
}

module.exports = new CampaignService();
