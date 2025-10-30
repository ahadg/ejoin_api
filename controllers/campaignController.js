const Campaign = require('../models/Campaign');
const ContactList = require('../models/ContactList');
const CampaignStats = require("../models/campaignStats");
const { createAndEmitNotification } = require('./notificationController');
const CampaignService = require('../services/campaignService');
const MessageSentDetails = require('../models/MessageSentDetails');
const messageTrackingService = require('../services/messageTrackingService');

// Get all campaigns for user
exports.getCampaigns = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    const query = { user: req.user._id };
    if (status) query.status = status;

    const campaigns = await Campaign.find(query)
      .populate('contactList', 'name totalContacts')
      .populate('device', 'name status')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Campaign.countDocuments(query);

    res.json({
      code: 200,
      data: {
        campaigns,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total
      }
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching campaigns' });
  }
};

// Get campaign by ID
exports.getCampaignById = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ 
      _id: req.params.id, 
      user: req.user._id 
    })
    .populate('contactList')
    .populate('device');

    if (!campaign) {
      return res.status(404).json({ code: 404, reason: 'Campaign not found' });
    }

    res.json({ code: 200, data: { campaign } });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching campaign' });
  }
};

// Create new campaign
exports.createCampaign = async (req, res) => {
  try {
    const {
      name, contactList, device, messageContent,
      scheduledDate, priority, taskSettings, totalContacts, status, message
    } = req.body;

    // Verify contact list belongs to user
    if (contactList) {
      const contactListData = await ContactList.findOne({
        _id: contactList,
        user: req.user._id
      });
      if (!contactListData) {
        return res.status(400).json({
          code: 400,
          reason: 'Contact list not found or access denied'
        });
      }
    }

    const campaign = new Campaign({
      name,
      contactList,
      device,
      messageContent,
      message,
      scheduledDate,
      priority,
      taskSettings,
      user: req.user._id,
      totalContacts,
      status
    });

    await campaign.save();
    await campaign.populate('contactList', 'name totalContacts');
    await campaign.populate('device', 'name status');

    res.status(201).json({
      code: 201,
      message: 'Campaign created successfully',
      data: { campaign }
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ code: 500, reason: 'Error creating campaign' });
  }
};

// Update campaign
exports.updateCampaign = async (req, res) => {
  try {
    const {
      name, contactList, device, status, taskId,
      messageContent, scheduledDate, priority, taskSettings
    } = req.body;

    const contactListData = await ContactList.findOne({
      _id: contactList,
      user: req.user._id
    });
    if (!contactListData) {
      return res.status(400).json({
        code: 400,
        reason: 'Contact list not found or access denied'
      });
    }

    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      {
        totalContacts : contactListData?.optedInCount,
        name, contactList, device, status, taskId,
        messageContent, scheduledDate, priority, taskSettings,
        updatedAt: new Date(),
        ...req.body
      },
      { new: true, runValidators: true }
    ).populate('contactList').populate('device');

    if (!campaign) {
      return res.status(404).json({ code: 404, reason: 'Campaign not found' });
    }

    res.json({ code: 200, message: 'Campaign updated successfully', data: { campaign } });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ code: 500, reason: 'Error updating campaign' });
  }
};

// Delete campaign
exports.deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndDelete({
      _id: req.params.id, user: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ code: 404, reason: 'Campaign not found' });
    }

    res.json({ code: 200, message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ code: 500, reason: 'Error deleting campaign' });
  }
};

// Update campaign statistics
exports.updateCampaignStats = async (req, res) => {
  try {
    const { sentMessages, deliveredMessages, failedMessages } = req.body;

    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      {
        $inc: {
          sentMessages: sentMessages || 0,
          deliveredMessages: deliveredMessages || 0,
          failedMessages: failedMessages || 0
        },
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!campaign) {
      return res.status(404).json({ code: 404, reason: 'Campaign not found' });
    }

    res.json({
      code: 200,
      message: 'Campaign stats updated successfully',
      data: { campaign }
    });
  } catch (error) {
    console.error('Update campaign stats error:', error);
    res.status(500).json({ code: 500, reason: 'Error updating campaign stats' });
  }
};

// Start/pause campaign
exports.updateCampaignStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['active', 'paused', 'completed'].includes(status)) {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid status. Must be active, paused, or completed'
      });
    }

    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { status, updatedAt: new Date() },
      { new: true }
    ).populate('contactList').populate('device');

    if (!campaign) {
      return res.status(404).json({ code: 404, reason: 'Campaign not found' });
    }

    res.json({
      code: 200,
      message: `Campaign ${status} successfully`,
      data: { campaign }
    });
  } catch (error) {
    console.error('Update campaign status error:', error);
    res.status(500).json({ code: 500, reason: 'Error updating campaign status' });
  }
};

// Start campaign processing
exports.startCampaignProcessing = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await CampaignService.startCampaignProcessing(id);

    res.json({
      code: 200,
      message: 'Campaign processing started',
      data: result
    });
  } catch (error) {
    console.error('Start campaign processing error:', error);
    res.status(500).json({ code: 500, reason: error.message });
  }
};

// Pause campaign
exports.pauseCampaign = async (req, res) => {
  try {
    const { id } = req.params;

    await CampaignService.pauseCampaign(id);

    res.json({
      code: 200,
      message: 'Campaign paused successfully'
    });
  } catch (error) {
    console.error('Pause campaign error:', error);
    res.status(500).json({ code: 500, reason: error.message });
  }
};

// Resume campaign
exports.resumeCampaign = async (req, res) => {
  try {
    const { id } = req.params;

    await CampaignService.resumeCampaign(id);

    res.json({
      code: 200,
      message: 'Campaign resumed successfully'
    });
  } catch (error) {
    console.error('Resume campaign error:', error);
    res.status(500).json({ code: 500, reason: error.message });
  }
};

// Stop campaign
exports.stopCampaign = async (req, res) => {
  try {
    const { id } = req.params;

    await CampaignService.stopCampaign(id);

    res.json({
      code: 200,
      message: 'Campaign stopped successfully'
    });
  } catch (error) {
    console.error('Stop campaign error:', error);
    res.status(500).json({ code: 500, reason: error.message });
  }
};

// Webhook handler for SMS status updates
// Webhook handler for SMS status updates
exports.smsStatusWebhook = async (req, res) => {
  try {
    const { type, statuses } = req.body;
    const io = req.app.get("io"); // Socket.IO instance

    if (type !== "sms-sent-status") {
      return res.status(400).json({ code: 400, reason: "Invalid webhook type" });
    }

    if (!statuses || !Array.isArray(statuses)) {
      return res.status(400).json({ code: 400, reason: "Invalid statuses format" });
    }

    // Normalize "today" to midnight UTC
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const updatePromises = statuses.map(async (status) => {
      const { tid, sent = 0, failed = 0, unsent = 0, sdr = [], fdr = [] } = status;

      // Process successful deliveries (sdr)
      const deliveryPromises = sdr.map(async (delivery) => {
        try {
          const { number, ts, code } = delivery;
          
          // Find the message by phone number and taskId
          const messageDetail = await MessageSentDetails.findOne({
            taskId: tid.toString(),
            //phoneNumber: number
          });

          if (messageDetail) {
            // Update message status to delivered
            await messageTrackingService.updateMessageStatus(
              messageDetail.messageId,
              'delivered',
              'webhook_delivery_report',
              {
                timestamp: new Date(ts * 1000), // Convert Unix timestamp to Date
                code: code,
                deliveryData: delivery
              }
            );
            return { success: true, messageId: messageDetail.messageId, status: 'delivered' };
          }
          return { success: false, reason: 'message_not_found', number };
        } catch (error) {
          console.error(`Error processing delivery for number ${delivery.number}:`, error);
          return { success: false, reason: 'error', error: error.message, number: delivery.number };
        }
      });

      // Process failures (fdr)
      const failurePromises = fdr.map(async (failure) => {
        try {
          const { number, ts, code, gsm_cause } = failure;
          
          // Find the message by phone number and taskId
          const messageDetail = await MessageSentDetails.findOne({
            taskId: tid.toString(),
            //phoneNumber: number
          });

          if (messageDetail) {
            // Update message status to failed
            await messageTrackingService.updateMessageStatus(
              messageDetail.messageId,
              'failed',
              'webhook_failure_report',
              {
                timestamp: new Date(ts * 1000), // Convert Unix timestamp to Date
                code: code,
                gsmCause: gsm_cause,
                failureData: failure
              }
            );
            return { success: true, messageId: messageDetail.messageId, status: 'failed' };
          }
          return { success: false, reason: 'message_not_found', number };
        } catch (error) {
          console.error(`Error processing failure for number ${failure.number}:`, error);
          return { success: false, reason: 'error', error: error.message, number: failure.number };
        }
      });

      // Process sent messages that don't have delivery reports yet
      // const sentMessagesUpdate = async () => {
      //   try {
      //     // Find all pending messages for this task that haven't been updated yet
      //     const pendingMessages = await MessageSentDetails.find({
      //       taskId: tid.toString(),
      //       status: 'pending'
      //     }).limit(sent); // Limit to the number reported as sent

      //     const updatePromises = pendingMessages.map(async (message) => {
      //       await messageTrackingService.updateMessageStatus(
      //         message.messageId,
      //         'sent',
      //         'webhook_sent_confirmation'
      //       );
      //       return { success: true, messageId: message.messageId, status: 'sent' };
      //     });

      //     return await Promise.all(updatePromises);
      //   } catch (error) {
      //     console.error('Error updating sent messages:', error);
      //     return [];
      //   }
      // };

      // Execute all updates
      const [deliveryResults, failureResults, 
        //sentResults

      ] = await Promise.all([
        Promise.all(deliveryPromises),
        Promise.all(failurePromises),
        //sentMessagesUpdate()
      ]);


      return {
        taskId: tid,
        messageResults: {
          deliveries: deliveryResults,
          failures: failureResults,
        }
      };
    });

    const results = await Promise.all(updatePromises);
    const successful = results.filter(Boolean).length;

    res.json({
      code: 200,
      message: `Processed ${successful} status updates`,
      data: {
        processed: successful,
        failed: results.length - successful,
        details: results.filter(Boolean)
      },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ code: 500, reason: "Error processing webhook" });
  }
};


