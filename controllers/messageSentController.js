const MessageSentDetail = require('../models/MessageSentDetails');
const Campaign = require('../models/Campaign');
const { default: mongoose } = require('mongoose');

const messageController = {
  /**
   * Get all message sent details by campaign ID
   * GET /api/messages?campaignId=:campaignId
   */
  getMessages: async (req, res) => {
    try {
      const { campaignId } = req.query;
      
      if (!campaignId) {
        return res.status(400).json({
          success: false,
          message: 'Campaign ID is required'
        });
      }

      // Verify campaign exists and belongs to user
      const campaign = await Campaign.findOne({
        _id: campaignId,
        user: req.user._id
      });

      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }

      // Parse query parameters for pagination and filtering
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const skip = (page - 1) * limit;
      const status = req.query.status;
      const sortBy = req.query.sortBy || 'createdAt';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

      // Build filter object
      const filter = { campaign: campaignId };
      
      if (status) {
        filter.status = status;
      }

      // Get messages with pagination
      const messages = await MessageSentDetail.find(filter)
        .populate('contact', 'firstName lastName email phoneNumber')
        .populate('device', 'name model status')
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();

      // Get total count for pagination
      const total = await MessageSentDetail.countDocuments(filter);
      const totalPages = Math.ceil(total / limit);

      // Get status counts for summary
      const statusCounts = await MessageSentDetail.aggregate([
        { $match: { campaign: (campaignId) } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Format status counts
      const statusSummary = statusCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {});

      res.json({
        success: true,
        data: {
          messages,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
          },
          summary: {
            total,
            ...statusSummary
          }
        }
      });

    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  /**
   * Get message statistics by campaign ID
   * GET /api/messages/stats?campaignId=:campaignId
   */
  getMessageStats: async (req, res) => {
    try {
      const { campaignId } = req.query;
      
      if (!campaignId) {
        return res.status(400).json({
          success: false,
          message: 'Campaign ID is required'
        });
      }

      // Verify campaign exists and belongs to user
      const campaign = await Campaign.findOne({
        _id: campaignId,
        user: req.user._id
      });

      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }

      const stats = await MessageSentDetail.aggregate([
        { $match: { campaign: (campaignId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            sent: {
              $sum: {
                $cond: [{ $eq: ['$status', 'sent'] }, 1, 0]
              }
            },
            delivered: {
              $sum: {
                $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0]
              }
            },
            failed: {
              $sum: {
                $cond: [{ $eq: ['$status', 'failed'] }, 1, 0]
              }
            },
            pending: {
              $sum: {
                $cond: [{ $eq: ['$status', 'pending'] }, 1, 0]
              }
            },
            read: {
              $sum: {
                $cond: [{ $eq: ['$status', 'read'] }, 1, 0]
              }
            },
            totalCost: { $sum: '$cost' },
            avgDeliveryLatency: { $avg: '$deliveryLatency' },
            avgReadLatency: { $avg: '$readLatency' }
          }
        }
      ]);

      // Get daily message count for the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const dailyStats = await MessageSentDetail.aggregate([
        {
          $match: {
            campaign: (campaignId),
            createdAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt'
              }
            },
            count: { $sum: 1 },
            delivered: {
              $sum: {
                $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0]
              }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      const result = stats[0] || {
        total: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
        pending: 0,
        read: 0,
        totalCost: 0,
        avgDeliveryLatency: 0,
        avgReadLatency: 0
      };

      result.deliveryRate = result.total > 0 ? (result.delivered / result.total) * 100 : 0;
      result.readRate = result.delivered > 0 ? (result.read / result.delivered) * 100 : 0;

      res.json({
        success: true,
        data: {
          overview: result,
          dailyStats,
          timeline: dailyStats
        }
      });

    } catch (error) {
      console.error('Error fetching message stats:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  /**
   * Get a single message detail by ID
   * GET /api/messages/:id
   */
  getMessageById: async (req, res) => {
    try {
      const { id } = req.params;

      const message = await MessageSentDetail.findById(id)
        .populate('contact')
        .populate('device')
        .populate('campaign', 'name status')
        .populate('user', 'name email');

      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      // Verify the message belongs to the user's campaign
      if (message.campaign.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      res.json({
        success: true,
        data: message
      });

    } catch (error) {
      console.error('Error fetching message:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
};

module.exports = messageController;