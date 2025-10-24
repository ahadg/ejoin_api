// services/campaignService.js
const { Worker, Queue } = require('bullmq');
const Campaign = require('../models/Campaign');
const ContactList = require('../models/ContactList');
const Contact = require('../models/Contact');
const Device = require('../models/Device');
const Sim = require('../models/Sim');
const redis = require('../config/redis');
const DeviceClient = require('./deviceClient');
const aiGenerationController = require('../controllers/aiGenerationController');
const messageTrackingService = require('./messageTrackingService');
const MessageSentDetails = require('../models/MessageSentDetails');

class CampaignService {
  constructor() {
    this.queues = new Map();   // queueName -> Queue
    this.workers = new Map();  // queueName -> Worker
    this.messageTracking = messageTrackingService; 
    this.simRoundRobinIndex = new Map(); // campaignId -> current SIM index
    this.variantRoundRobinIndex = new Map(); // campaignId -> current variant index
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
    try {
      // Get all active SIMs for the device
      console.log("deviceId", deviceId)
      const sims = await Sim.find({
        device: deviceId,
        inserted: true,
        slotActive: true,
        status: 'active'
      }).sort({ port: 1, slot: 1 });

      if (sims.length === 0) {
        throw new Error(`No active SIMs found for device ${deviceId}`);
      }

      // Check daily limits for each SIM
      const availableSims = [];
      for (const sim of sims) {
        // Reset daily count if it's a new day
        await this.resetSimDailyCountIfNeeded(sim);
        
        if (sim.dailySent < sim.dailyLimit) {
          availableSims.push(sim);
        }
      }

      if (availableSims.length === 0) {
        throw new Error(`All SIMs have reached their daily limits for device ${deviceId}`);
      }

      return availableSims;
    } catch (error) {
      console.error('Error getting available SIMs:', error);
      throw error;
    }
  }

  // Reset SIM daily count if it's a new day
  async resetSimDailyCountIfNeeded(sim) {
    const today = new Date().toDateString();
    const lastReset = sim.lastResetDate.toDateString();
    
    if (today !== lastReset) {
      await Sim.findByIdAndUpdate(sim._id, {
        dailySent: 0,
        todaySent: 0,
        lastResetDate: new Date()
      });
    }
  }

  // Get SIM for contact (with affinity)
  async getSimForContact(deviceId, campaignId, contact) {
    try {
      // Check if contact already has an assigned SIM
      if (contact.assignedSim?.simId) {
        const assignedSim = await Sim.findById(contact.assignedSim.simId);
        
        // Verify the SIM is still available and within limits
        if (assignedSim && 
            assignedSim.device.toString() === deviceId.toString() &&
            assignedSim.inserted && 
            assignedSim.slotActive && 
            assignedSim.status === 'active') {
          
          // Reset daily count if needed
          //await this.resetSimDailyCountIfNeeded(assignedSim);
          
          // Check if SIM is within daily limits
          if (assignedSim.dailySent < assignedSim.dailyLimit) {
            console.log(`Using assigned SIM ${assignedSim._id} for contact ${contact.phoneNumber}`);
            
            // Update last used timestamp
            await this.updateContactSimUsage(contact._id, assignedSim._id);
            
            return assignedSim;
          } else {
            console.log(`Assigned SIM ${assignedSim._id} reached daily limit for contact ${contact.phoneNumber}`);
          }
        } else {
          console.log(`Assigned SIM not available for contact ${contact.phoneNumber}, finding new SIM`);
        }
      }
      
      // If no assigned SIM or assigned SIM is not available, get next available SIM
      const availableSims = await this.getAvailableSims(deviceId, campaignId);
      
      if (availableSims.length === 0) {
        throw new Error(`No available SIMs found for device ${deviceId}`);
      }
      
      // Use round-robin to select a SIM
      if (!this.simRoundRobinIndex.has(campaignId)) {
        this.simRoundRobinIndex.set(campaignId, 0);
      }
      
      let currentIndex = this.simRoundRobinIndex.get(campaignId);
      let selectedSim = null;
      let attempts = 0;
      
      while (attempts < availableSims.length && !selectedSim) {
        const sim = availableSims[currentIndex];
        const freshSim = await Sim.findById(sim._id);
        
        if (freshSim && freshSim.dailySent < freshSim.dailyLimit) {
          selectedSim = freshSim;
          // Update index for next call
          const nextIndex = (currentIndex + 1) % availableSims.length;
          this.simRoundRobinIndex.set(campaignId, nextIndex);
        }
        
        currentIndex = (currentIndex + 1) % availableSims.length;
        attempts++;
      }
      
      if (!selectedSim) {
        throw new Error('No available SIMs found within daily limits');
      }
      
      // Assign this SIM to the contact for future messages
      await this.assignSimToContact(contact._id, selectedSim._id, deviceId);
      console.log(`Assigned new SIM ${selectedSim._id} to contact ${contact.phoneNumber}`);
      
      return selectedSim;
      
    } catch (error) {
      console.error('Error getting SIM for contact:', error);
      throw error;
    }
  }

  // Assign SIM to contact
  async assignSimToContact(contactId, simId, deviceId) {
    try {
      await Contact.findByIdAndUpdate(contactId, {
        $set: {
          'assignedSim': {
            simId: simId,
            deviceId: deviceId,
            assignedAt: new Date(),
            lastUsedAt: new Date()
          }
        }
      });
    } catch (error) {
      console.error(`Error assigning SIM to contact ${contactId}:`, error);
      throw error;
    }
  }

  // Update SIM usage timestamp for contact
  async updateContactSimUsage(contactId, simId) {
    try {
      await Contact.findByIdAndUpdate(contactId, {
        $set: {
          'assignedSim.lastUsedAt': new Date()
        }
      });
    } catch (error) {
      console.error(`Error updating SIM usage for contact ${contactId}:`, error);
      // Don't throw - this shouldn't break the main flow
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
      console.log(`Campaign status change emitted: ${campaignId} - ${oldStatus} → ${newStatus}`);
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

      // Get SIM for contact (with affinity)
      let sim;
      try {
        sim = await this.getSimForContact(campaign.device._id, campaignId, contact);
      } catch (error) {
        console.error(`No available SIM found for campaign ${campaignId}:`, error);
        await this.pauseCampaign(campaignId, 'daily_limit_reached');
        return;
      }
      console.log("SIM selected sim.port",sim.port.toString())
      // Check campaign daily limit
      const campaignDailySent = await this.getTodaySentCount(campaignId);
      if (campaign.taskSettings?.dailyMessageLimit && campaignDailySent >= campaign.taskSettings.dailyMessageLimit) {
        console.log(`Campaign ${campaignId} reached campaign daily limit. Pausing.`);
        await this.pauseCampaign(campaignId, 'daily_limit_reached');
        return;
      }

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
          await this.updateCampaignStats(campaignId, { sentMessages: 1, lastSentAt: new Date() });
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
          await this.updateCampaignStats(campaignId, { failedMessages: 1 });

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
        await this.updateCampaignStats(campaignId, { failedMessages: 1 });

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
  
    // Handle multiple_variants type - use round-robin selection from message variants
    if (campaign?.taskSettings?.messageVariationType === 'multiple_variants') {
      if (campaign?.message?.variants && campaign.message.variants.length > 0) {
        // Initialize round-robin index for this campaign if not exists
        if (!this.variantRoundRobinIndex.has(campaignId)) {
          this.variantRoundRobinIndex.set(campaignId, 0);
        }
  
        // Get current index and select variant
        const currentIndex = this.variantRoundRobinIndex.get(campaignId);
        const selectedVariant = campaign.message.variants[currentIndex];
        
        // Update index for next call (circular)
        const nextIndex = (currentIndex + 1) % campaign.message.variants.length;
        this.variantRoundRobinIndex.set(campaignId, nextIndex);
  
        console.log("Selected round-robin variant:", {
          variantId: selectedVariant._id,
          index: currentIndex,
          totalVariants: campaign.message.variants.length,
          nextIndex: nextIndex
        });
  
        return {
          content: selectedVariant.content,
          variantId: selectedVariant._id,
          tone: selectedVariant.tone || 'Professional',
          characterCount: selectedVariant.characterCount
        };
      } else {
        console.log("No variants found, falling back to base message");
        return {
          content: campaign?.messageContent || 'Default message',
          variantId: 'fallback-base-message',
          tone: 'Professional',
          characterCount: (campaign?.messageContent || 'Default message').length
        };
      }
    }
  
    // Handle ai_random type - generate AI variant (without uniqueness check)
    if (campaign?.taskSettings?.messageVariationType === 'ai_random' || 
        campaign?.taskSettings?.useAiGeneration) {
      
      console.log("current_campaign:", campaign);
      console.log("current_campaign_message:", campaign?.message);
      console.log("current_campaign_message_settings:", campaign?.message?.settings);
      console.log("current_campaign_message_characterLimit:", campaign?.message?.settings?.characterLimit);
  
      // Get previous messages to guide AI generation (but no uniqueness enforcement)
      const previousMessages = await this.getPreviousCampaignMessages(campaignId);
      console.log(`Found ${previousMessages.length} previous messages for context`);
  
      // Use the AI generation controller with previous messages as context only
      try {
        const aiResponse = await aiGenerationController.generateWithGrok({
          prompt: campaign?.message?.originalPrompt || campaign?.message?.baseMessage,
          variantCount: 1,
          characterLimit: campaign?.message?.settings?.get("characterLimit"),
          tones: campaign?.message?.settings?.get("tones"),
          languages: campaign?.message?.settings?.get("languages"),
          creativityLevel: campaign?.message?.settings?.get("creativityLevel"),
          includeEmojis: campaign?.message?.settings?.get("includeEmojis"),
          companyName: campaign?.message?.settings?.get("companyName") || '',
          companyAddress : campaign?.message?.settings?.get("companyAddress") || '',
          companyEmail : campaign?.message?.settings?.get("companyEmail") || '',
          companyPhone : campaign?.message?.settings?.get("companyPhone") || '',
          companyWebsite : campaign?.message?.settings?.get("companyWebsite") || '',
          unsubscribeText: campaign?.message?.settings?.get("unsubscribeText"),
          customInstructions: campaign?.message?.settings?.get("customInstructions"),
          category: campaign?.message?.category,
          previousMessages: previousMessages // Pass previous messages for context only
        });
        
        console.log("aiResponse", aiResponse);
        console.log("aiResponse_content", aiResponse?.[0]?.content);
  
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
  
      // AI fallback: use round-robin for message variants if available
      if (campaign?.message?.variants && campaign.message.variants.length > 0) {
        // Initialize round-robin index for fallback
        if (!this.variantRoundRobinIndex.has(campaignId)) {
          this.variantRoundRobinIndex.set(campaignId, 0);
        }
  
        const currentIndex = this.variantRoundRobinIndex.get(campaignId);
        const selectedVariant = campaign.message.variants[currentIndex];
        
        const nextIndex = (currentIndex + 1) % campaign.message.variants.length;
        this.variantRoundRobinIndex.set(campaignId, nextIndex);
  
        console.log("AI failed, using round-robin variant as fallback");
        return {
          content: selectedVariant.content,
          variantId: selectedVariant._id,
          tone: selectedVariant.tone || 'Professional',
          characterCount: selectedVariant.characterCount
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

  // Update SIM daily count
  async updateSimDailyCount(simId) {
    await Sim.findByIdAndUpdate(simId, {
      $inc: { dailySent: 1, todaySent: 1 },
      $set: { lastUpdated: new Date() }
    });
  }

  async getPreviousCampaignMessages(campaignId, limit = 50) {
    try {
      const previousMessages = await MessageSentDetails.find({
        campaign: campaignId,
        status: { $in: ['sent', 'delivered'] }
      })
      .select('content -_id')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  
      return previousMessages.map(msg => msg.content);
    } catch (error) {
      console.error(`Error fetching previous messages for campaign ${campaignId}:`, error);
      return [];
    }
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
    const pausedCampaigns = await Campaign.find({
      status: 'paused',
      $or: [
        { pauseReason: 'daily_limit_reached' },
        { pauseReason: 'no_available_sims' }
      ]
    });

    for (const campaign of pausedCampaigns) {
      try {
        console.log(`Resuming paused campaign ${campaign._id} after daily reset`);
        await this.resumeCampaign(campaign._id);
      } catch (err) {
        console.error(`Failed to resume campaign ${campaign._id}:`, err);
      }
    }

    console.log('Daily counts reset for campaigns, SIMs, and devices');
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
    try {
      const contact = await Contact.findById(contactId)
        .populate('assignedSim.simId')
        .populate('assignedSim.deviceId');
      
      if (!contact || !contact.assignedSim) {
        return null;
      }

      return {
        sim: contact.assignedSim.simId,
        device: contact.assignedSim.deviceId,
        assignedAt: contact.assignedSim.assignedAt,
        lastUsedAt: contact.assignedSim.lastUsedAt
      };
    } catch (error) {
      console.error(`Error getting contact SIM info for ${contactId}:`, error);
      return null;
    }
  }

  // Reassign SIM to contact (manual override)
  async reassignSimToContact(contactId, newSimId, deviceId) {
    try {
      await this.assignSimToContact(contactId, newSimId, deviceId);
      console.log(`Manually reassigned SIM ${newSimId} to contact ${contactId}`);
      return { success: true };
    } catch (error) {
      console.error(`Error reassigning SIM to contact ${contactId}:`, error);
      throw error;
    }
  }

  // Get campaign SIM usage statistics
  async getCampaignSimUsage(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId).populate('contactList');
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      // Get all contacts in this campaign with their assigned SIMs
      const contacts = await Contact.find({
        contactList: campaign.contactList._id
      })
      .populate('assignedSim.simId')
      .select('phoneNumber assignedSim');

      // Group by SIM
      const simUsage = {};
      let contactsWithSim = 0;
      let contactsWithoutSim = 0;

      contacts.forEach(contact => {
        if (contact.assignedSim?.simId) {
          const simId = contact.assignedSim.simId._id.toString();
          if (!simUsage[simId]) {
            simUsage[simId] = {
              sim: contact.assignedSim.simId,
              contactCount: 0,
              contacts: []
            };
          }
          simUsage[simId].contactCount++;
          simUsage[simId].contacts.push({
            phoneNumber: contact.phoneNumber,
            assignedAt: contact.assignedSim.assignedAt,
            lastUsedAt: contact.assignedSim.lastUsedAt
          });
          contactsWithSim++;
        } else {
          contactsWithoutSim++;
        }
      });

      return {
        campaignId,
        campaignName: campaign.name,
        totalContacts: contacts.length,
        contactsWithSim,
        contactsWithoutSim,
        simUsage: Object.values(simUsage)
      };
    } catch (error) {
      console.error(`Error getting campaign SIM usage for ${campaignId}:`, error);
      throw error;
    }
  }


  // Reset variant round-robin index for a campaign
  async resetVariantRoundRobin(campaignId) {
    this.variantRoundRobinIndex.set(campaignId, 0);
    console.log(`Reset variant round-robin index for campaign ${campaignId}`);
    return { success: true };
  }
}

module.exports = new CampaignService();