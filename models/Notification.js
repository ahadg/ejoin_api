// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['success', 'warning', 'error', 'info', 'system'],
    default: 'info'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  unread: {
    type: Boolean,
    default: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  relatedEntity: {
    type: {
      type: String,
      enum: ['campaign', 'device', 'message', 'system', 'user']
    },
    entityId: mongoose.Schema.Types.ObjectId
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Notifications expire after 30 days by default
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
  }
}, {
  timestamps: true
});

// Index for efficient querying
notificationSchema.index({ user: 1, unread: 1 });
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static method to create notification
notificationSchema.statics.createNotification = async function(notificationData) {
  try {
    const notification = new this(notificationData);
    await notification.save();
    return notification;
  } catch (error) {
    throw new Error(`Failed to create notification: ${error.message}`);
  }
};

// Instance method to mark as read
notificationSchema.methods.markAsRead = async function() {
  this.unread = false;
  return await this.save();
};

module.exports = mongoose.model('Notification', notificationSchema);