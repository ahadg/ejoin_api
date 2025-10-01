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
      name, contactList, device, status, taskIds,
      messageContent, scheduledDate, priority, taskSettings
    } = req.body;

    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      {
        name, contactList, device, status, taskIds,
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
