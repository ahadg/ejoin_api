const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'scheduled'],
    default: 'scheduled'
  },
  totalContacts: {
    type: Number,
    default: 0
  },
  sentMessages: {
    type: Number,
    default: 0
  },
  deliveredMessages: {
    type: Number,
    default: 0
  },
  completedMessages: {   // ✅ add this field
    type: Number,
    default: 0
  },
  failedMessages: {
    type: Number,
    default: 0
  },
  scheduledDate: {
    type: Date
  },
  messageContent: {
    type: String,
    required: true
  },
  cost : {
    type : Number,
    default : 0
  },
  messagePreview: String,
  priority: {
    type: String,
    enum: ['low', 'normal', 'high'],
    default: 'normal'
  },
  contactList: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactList'
  },
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device'
  },
  taskSettings: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  taskId : {
    type : Number,
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Campaign', campaignSchema);