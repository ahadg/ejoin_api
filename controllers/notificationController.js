// controllers/notificationController.js
const Notification = require('../models/Notification');

class NotificationController {
  // Get all notifications for user
  async getNotifications(req, res) {
    try {
      const userId = req.user._id;
      const { page = 1, limit = 20, unread } = req.query;
      
      const query = { user: userId };
      if (unread !== undefined) {
        query.unread = unread === 'true';
      }
      
      const notifications = await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);
      
      const total = await Notification.countDocuments(query);
      
      res.json({
        code: 200,
        data: {
          notifications,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          total
        }
      });
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({ code: 500, reason: 'Failed to fetch notifications' });
    }
  }

  // Mark notification as read
  async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;
      const userId = req.user._id;
      
      const notification = await Notification.findOne({
        _id: notificationId,
        user: userId
      });
      
      if (!notification) {
        return res.status(404).json({ code: 404, reason: 'Notification not found' });
      }
      
      notification.unread = false;
      await notification.save();
      
      res.json({ code: 200, message: 'Notification marked as read', data: notification });
    } catch (error) {
      console.error('Mark as read error:', error);
      res.status(500).json({ code: 500, reason: 'Failed to mark notification as read' });
    }
  }

  // Mark all notifications as read
  async markAllAsRead(req, res) {
    try {
      const userId = req.user._id;
      
      await Notification.updateMany(
        { user: userId, unread: true },
        { $set: { unread: false } }
      );
      
      res.json({ code: 200, message: 'All notifications marked as read' });
    } catch (error) {
      console.error('Mark all as read error:', error);
      res.status(500).json({ code: 500, reason: 'Failed to mark all notifications as read' });
    }
  }

  // Get unread count
  async getUnreadCount(req, res) {
    try {
      const userId = req.user._id;
      
      const count = await Notification.countDocuments({
        user: userId,
        unread: true
      });
      
      res.json({ code: 200, data: { count } });
    } catch (error) {
      console.error('Get unread count error:', error);
      res.status(500).json({ code: 500, reason: 'Failed to get unread count' });
    }
  }

  // Delete notification
  async deleteNotification(req, res) {
    try {
      const { notificationId } = req.params;
      const userId = req.user._id;
      
      const result = await Notification.deleteOne({
        _id: notificationId,
        user: userId
      });
      
      if (result.deletedCount === 0) {
        return res.status(404).json({ code: 404, reason: 'Notification not found' });
      }
      
      res.json({ code: 200, message: 'Notification deleted successfully' });
    } catch (error) {
      console.error('Delete notification error:', error);
      res.status(500).json({ code: 500, reason: 'Failed to delete notification' });
    }
  }

  // Clear all notifications
  async clearAll(req, res) {
    try {
      const userId = req.user._id;
      
      await Notification.deleteMany({ user: userId });
      
      res.json({ code: 200, message: 'All notifications cleared' });
    } catch (error) {
      console.error('Clear all notifications error:', error);
      res.status(500).json({ code: 500, reason: 'Failed to clear notifications' });
    }
  }
}

// Utility function to create and emit notification
const createAndEmitNotification = async (io, notificationData) => {
  try {
    // Save notification to database
    const notification = await Notification.createNotification(notificationData);
    
    // Emit real-time notification to user
    if (io && notificationData.user) {
      io.to(`user:${notificationData.user}`).emit('new-notification', {
        id: notification._id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        time: notification.createdAt,
        unread: notification.unread,
        data: notification.data
      });
    }
    
    return notification;
  } catch (error) {
    console.error('Create and emit notification error:', error);
    throw error;
  }
};

module.exports = {
  NotificationController: new NotificationController(),
  createAndEmitNotification
};