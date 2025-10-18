// services/messageTrackingService.js
const MessageSentDetails = require('../models/MessageSentDetails');
const CampaignStats = require('../models/campaignStats');
const Campaign = require('../models/Campaign');

class MessageTrackingService {
  
  /**
   * Track a single message with comprehensive details
   */
  async trackMessage(messageData) {
    try {
      const {
        campaignId,
        contactId,
        phoneNumber,
        content,
        variantId,
        tone,
        characterCount,
        deviceId,
        deviceName,
        taskId,
        status = 'pending',
        processingTime,
        response,
        error,
        simId,
        userId
      } = messageData;

      // Get or create campaign stats for today
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let campaignStats = await CampaignStats.findOne({
        campaign: campaignId,
        date: today
      });

      if (!campaignStats) {
        campaignStats = await CampaignStats.create({
          campaign: campaignId,
          user: userId,
          date: today
        });
      }

      // Generate unique message ID
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create message detail record
      const MessageSDetails = await MessageSentDetails.create({
        campaign: campaignId,
        campaignStats: campaignStats._id,
        user: userId,
        contact: contactId,
        device: deviceId,
        messageVariant: variantId,
        messageId,
        phoneNumber,
        content,
        characterCount,
        tone,
        deviceName,
        simId,
        taskId,
        processingTime,
        sendResponse: response,
        errorDetails: error ? {
          message: error.message || error,
          recoverable: false
        } : undefined
      });

      // Update status with history
      await MessageSDetails.updateStatus(status, 'initial_send');
      await MessageSDetails.save();

      // Update campaign stats counters
      await this.updateCampaignStatsCounters(campaignId, campaignStats._id, status);

      console.log(`Tracked message ${messageId} for campaign ${campaignId} with status: ${status}`);
      return MessageSDetails;

    } catch (error) {
      console.error('Error tracking message:', error);
      throw error;
    }
  }


  /**
   * Update campaign & Campaign stats counters
   */
  async updateCampaignStatsCounters(campaignId, campaignStatsId, newStatus, oldStatus = null) {
    const updateQuery = {};
    
    // Decrement old status counter if provided
    // if (oldStatus) {
    //   switch (oldStatus) {
    //     case 'sent': updateQuery.$inc = { sentMessages: -1 }; break;
    //     case 'delivered': updateQuery.$inc = { deliveredMessages: -1 }; break;
    //     case 'failed': updateQuery.$inc = { failedMessages: -1 }; break;
    //     case 'read': updateQuery.$inc = { readMessages: -1 }; break;
    //     case 'pending': updateQuery.$inc = { pendingMessages: -1 }; break;
    //   }
    // }

    // Increment new status counter
    if (!updateQuery.$inc) updateQuery.$inc = {};
    
    switch (newStatus) {
      case 'sent':
        updateQuery.$inc.sentMessages = 1;
        updateQuery.$inc.deliveredMessages = 1; // also increment delivered
        break;
    
      case 'delivered':
        updateQuery.$inc.deliveredMessages = 1;
        break;
    
      case 'failed':
        updateQuery.$inc.failedMessages = 1;
        break;
    
      case 'read':
        updateQuery.$inc.readMessages = 1;
        break;
    
      case 'pending':
        updateQuery.$inc.pendingMessages = 1;
        break;
    }    

    await CampaignStats.findByIdAndUpdate(campaignStatsId, updateQuery);
    
    // Also update main campaign counters
    const campaignUpdate = {};
    switch (newStatus) {
      case 'sent': 
        campaignUpdate.$inc = { sentMessages: 1 };
        campaignUpdate.$inc = { deliveredMessages: 1 };
        campaignUpdate.$inc = { sentCount: 1 };
        break;
      case 'delivered': 
        campaignUpdate.$inc = { deliveredMessages: 1 };
        break;
      case 'failed': 
        campaignUpdate.$inc = { failedMessages: 1 };
        break;
    }

    // if (campaignUpdate.$inc) {
    //   await Campaign.findByIdAndUpdate(campaignId, campaignUpdate);
    // }
  }

  /**
   * Get message details by messageId
   */
  async getMessageSentDetails(messageId) {
    try {
      return await MessageSentDetails.findOne({ messageId })
        .populate('campaign', 'name status')
        .populate('contact', 'phoneNumber firstName lastName')
        .populate('device', 'name number')
        .populate('messageVariant', 'content tone');
    } catch (error) {
      console.error('Error getting message detail:', error);
      throw error;
    }
  }

  /**
   * Get message history for a campaign with pagination and filtering
   */
  async getCampaignMessageHistory(campaignId, options = {}) {
    try {
      const {
        status,
        startDate,
        endDate,
        phoneNumber,
        deviceId,
        variantId,
        page = 1,
        limit = 50,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      const query = { campaign: campaignId };
      
      // Build filter query
      if (status) query.status = status;
      if (phoneNumber) query.phoneNumber = { $regex: phoneNumber, $options: 'i' };
      if (deviceId) query.device = deviceId;
      if (variantId) query.messageVariant = variantId;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      const [messages, total] = await Promise.all([
        MessageSentDetails.find(query)
          .populate('contact', 'phoneNumber firstName lastName')
          .populate('device', 'name number')
          .populate('messageVariant', 'content tone')
          .sort(sort)
          .limit(limit)
          .skip(skip)
          .lean(),
        MessageSentDetails.countDocuments(query)
      ]);

      return {
        messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      console.error('Error getting campaign message history:', error);
      throw error;
    }
  }

  /**
   * Update message status (for delivery reports, read receipts, etc.)
   */
  async updateMessageStatus(messageId, newStatus, reason = '', deliveryData = null) {
    try {
      const MessageSDetails = await MessageSentDetails.findOne({ messageId });
      
      if (!MessageSDetails) {
        console.warn(`MessageSDetails not found for messageId: ${messageId}`);
        return null;
      }

      const oldStatus = MessageSDetails.status;

      // Update status with history
      await MessageSDetails.updateStatus(newStatus, reason, deliveryData);
      await MessageSDetails.save();

      // Update campaign stats counters
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const campaignStats = await CampaignStats.findOne({
        campaign: MessageSDetails.campaign,
        date: today
      });

      if (campaignStats) {
        await this.updateCampaignStatsCounters(
          MessageSDetails.campaign, 
          campaignStats._id, 
          newStatus, 
          oldStatus
        );
      }

      console.log(`Updated message ${messageId} status from ${oldStatus} to ${newStatus}`);
      return MessageSDetails;

    } catch (error) {
      console.error('Error updating message status:', error);
      throw error;
    }
  }

  /**
   * Get campaign analytics with detailed metrics
   */
  // async getCampaignAnalytics(campaignId, period = '7d') {
  //   try {
  //     const startDate = new Date();
  //     switch (period) {
  //       case '1d':
  //         startDate.setDate(startDate.getDate() - 1);
  //         break;
  //       case '7d':
  //         startDate.setDate(startDate.getDate() - 7);
  //         break;
  //       case '30d':
  //         startDate.setDate(startDate.getDate() - 30);
  //         break;
  //       default:
  //         startDate.setDate(startDate.getDate() - 7);
  //     }

  //     const stats = await CampaignStats.find({
  //       campaign: campaignId,
  //       date: { $gte: startDate }
  //     }).sort({ date: 1 });

  //     const messageSentdetails = await MessageSentDetails.find({
  //       campaign: campaignId,
  //       createdAt: { $gte: startDate }
  //     }).populate('device').populate('messageVariant');

  //     const analytics = {
  //       totalSent: 0,
  //       totalDelivered: 0,
  //       totalFailed: 0,
  //       totalRead: 0,
  //       deliveryRate: 0,
  //       readRate: 0,
  //       averageProcessingTime: 0,
  //       averageDeliveryLatency: 0,
  //       dailyBreakdown: [],
  //       variantPerformance: {},
  //       devicePerformance: {},
  //       hourlyDistribution: Array(24).fill(0).map((_, i) => ({ hour: i, count: 0 }))
  //     };

  //     let totalProcessingTime = 0;
  //     let totalDeliveryLatency = 0;
  //     let deliveredCount = 0;
  //     const variantStats = {};
  //     const deviceStats = {};

  //     // Process stats
  //     stats.forEach(stat => {
  //       analytics.totalSent += stat.sentMessages || 0;
  //       analytics.totalDelivered += stat.deliveredMessages || 0;
  //       analytics.totalFailed += stat.failedMessages || 0;
  //       analytics.totalRead += stat.readMessages || 0;

  //       analytics.dailyBreakdown.push({
  //         date: stat.date,
  //         sent: stat.sentMessages || 0,
  //         delivered: stat.deliveredMessages || 0,
  //         failed: stat.failedMessages || 0,
  //         read: stat.readMessages || 0,
  //         deliveryRate: stat.sentMessages > 0 ? 
  //           ((stat.deliveredMessages || 0) / stat.sentMessages * 100) : 0
  //       });
  //     });

  //     // Process message details for detailed analytics
  //     messageSentdetails.forEach(msg => {
  //       // Processing time
  //       if (msg.processingTime) {
  //         totalProcessingTime += msg.processingTime;
  //       }

  //       // Delivery latency
  //       if (msg.deliveryLatency) {
  //         totalDeliveryLatency += msg.deliveryLatency;
  //         deliveredCount++;
  //       }

  //       // Variant performance
  //       if (msg.messageVariant) {
  //         const variantId = msg.messageVariant._id.toString();
  //         if (!variantStats[variantId]) {
  //           variantStats[variantId] = { 
  //             sent: 0, 
  //             delivered: 0, 
  //             failed: 0,
  //             variant: msg.messageVariant
  //           };
  //         }
  //         variantStats[variantId].sent++;
  //         if (msg.status === 'delivered') variantStats[variantId].delivered++;
  //         if (msg.status === 'failed') variantStats[variantId].failed++;
  //       }

  //       // Device performance
  //       if (msg.device) {
  //         const deviceId = msg.device._id.toString();
  //         if (!deviceStats[deviceId]) {
  //           deviceStats[deviceId] = { 
  //             sent: 0, 
  //             delivered: 0, 
  //             failed: 0,
  //             device: msg.device
  //           };
  //         }
  //         deviceStats[deviceId].sent++;
  //         if (msg.status === 'delivered') deviceStats[deviceId].delivered++;
  //         if (msg.status === 'failed') deviceStats[deviceId].failed++;
  //       }

  //       // Hourly distribution
  //       if (msg.sentAt) {
  //         const hour = new Date(msg.sentAt).getHours();
  //         analytics.hourlyDistribution[hour].count++;
  //       }
  //     });

  //     // Calculate rates
  //     analytics.deliveryRate = analytics.totalSent > 0 ? 
  //       (analytics.totalDelivered / analytics.totalSent * 100) : 0;
  //     analytics.readRate = analytics.totalDelivered > 0 ? 
  //       (analytics.totalRead / analytics.totalDelivered * 100) : 0;

  //     // Calculate averages
  //     analytics.averageProcessingTime = messageSentdetails.length > 0 ? 
  //       (totalProcessingTime / messageSentdetails.length) : 0;
  //     analytics.averageDeliveryLatency = deliveredCount > 0 ? 
  //       (totalDeliveryLatency / deliveredCount) : 0;

  //     // Format performance data
  //     analytics.variantPerformance = variantStats;
  //     analytics.devicePerformance = deviceStats;

  //     return analytics;

  //   } catch (error) {
  //     console.error('Error getting campaign analytics:', error);
  //     throw error;
  //   }
  // }

  /**
   * Bulk update message statuses
   */
  async bulkUpdateMessageStatus(messageIds, newStatus, reason = '') {
    try {
      return await MessageSentDetails.bulkUpdateStatus(messageIds, newStatus, reason);
    } catch (error) {
      console.error('Error bulk updating message statuses:', error);
      throw error;
    }
  }

  /**
   * Get messages by status for a campaign
   */
  async getMessagesByStatus(campaignId, status, limit = 100) {
    try {
      return await MessageSentDetails.find({
        campaign: campaignId,
        status: status
      })
      .populate('contact', 'phoneNumber firstName lastName')
      .populate('device', 'name number')
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();
    } catch (error) {
      console.error('Error getting messages by status:', error);
      throw error;
    }
  }
}

// Create and export instance
const messageTrackingService = new MessageTrackingService();
module.exports = messageTrackingService;