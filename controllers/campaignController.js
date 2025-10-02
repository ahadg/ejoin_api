const Campaign = require('../models/Campaign');
const ContactList = require('../models/ContactList');

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
      scheduledDate, priority, taskSettings, totalContacts
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
      scheduledDate,
      priority,
      taskSettings,
      user: req.user._id,
      totalContacts
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

    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      {
        name, contactList, device, status, taskId,
        messageContent, scheduledDate, priority, taskSettings,
        updatedAt: new Date()
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

// Webhook handler for SMS status updates
exports.smsStatusWebhook = async (req, res) => {
  try {
    const { type, statuses } = req.body;
    const io = req.app.get('io'); // Get Socket.IO instance

    console.log('Webhook received:', { type, statuses });

    // Validate webhook type
    if (type !== 'sms-sent-status') {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid webhook type'
      });
    }

    if (!statuses || !Array.isArray(statuses)) {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid statuses format'
      });
    }

    // Process each status update
    const updatePromises = statuses.map(async (status) => {
      const { tid, sent = 0, failed = 0, unsent = 0, sdr = [] } = status;

      // Find campaign by task ID
      const campaign = await Campaign.findOne({ taskId: tid }).populate('user');
      if (!campaign) {
        console.log(`Campaign not found for task ID: ${tid}`);
        return null;
      }

      // Delivered = SDR count
      const deliveredMessages = sdr.length;

      // Total cost from SDR
      const totalCost = sdr.reduce((sum, report) => sum + (report.cost || 0), 0);

      // Completed = sent + failed + unsent
      const completedMessages = sent + failed + unsent;

      // Calculate progress
      const progress = campaign.totalContacts > 0 ? 
        Math.min(100, (completedMessages / campaign.totalContacts) * 100) : 0;

      // Update campaign data
      let updateData = {
        $inc: {
          sentMessages: sent,
          deliveredMessages: deliveredMessages,
          failedMessages: failed,
          completedMessages: completedMessages,
          cost: totalCost
        },
        $set: { 
          updatedAt: new Date(),
          progress: progress
        }
      };

      // Mark as completed if all contacts processed
      if (campaign.completedMessages + completedMessages >= campaign.totalContacts) {
        updateData.$set.status = 'completed';
        updateData.$set.completedAt = new Date();
      }

      const updatedCampaign = await Campaign.findOneAndUpdate(
        { _id: campaign._id },
        updateData,
        { new: true }
      ).populate('user');

      console.log(`Updated campaign ${campaign.name}:`, {
        taskId: tid,
        sent,
        delivered: deliveredMessages,
        failed,
        completed: completedMessages,
        cost: totalCost,
        status: updatedCampaign.status,
        progress: progress
      });

      // Emit real-time update to the user
      if (io && updatedCampaign.user) {
        console.log("socketio emit updatedCampaign.user._id",updatedCampaign.user._id)
        io.to(`user:${updatedCampaign.user._id}`).emit('campaign-update', {
          campaignId: updatedCampaign._id,
          updates: {
            sentMessages: updatedCampaign.sentMessages,
            deliveredMessages: updatedCampaign.deliveredMessages,
            failedMessages: updatedCampaign.failedMessages,
            progress: updatedCampaign.progress,
            status: updatedCampaign.status,
            cost: updatedCampaign.cost,
            updatedAt: updatedCampaign.updatedAt
          }
        });

        // Also emit to campaign-specific room
        // io.to(`campaign:${updatedCampaign._id}`).emit('campaign-detail-update', {
        //   campaign: updatedCampaign
        // });
      }

      return updatedCampaign;
    });

    const results = await Promise.all(updatePromises);
    const successfulUpdates = results.filter(r => r !== null);

    res.json({
      code: 200,
      message: `Successfully processed ${successfulUpdates.length} status updates`,
      data: {
        processed: successfulUpdates.length,
        failed: results.length - successfulUpdates.length
      }
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error processing webhook'
    });
  }
};

