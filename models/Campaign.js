const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  messageContent: {
    type: String,
    required: true
  },
  messagePreview: {
    type: String
  },
  contactList: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactList',
    required: true
  },
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'paused', 'completed', 'cancelled','pending'],
    default: 'scheduled'
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high'],
    default: 'normal'
  },
  taskSettings: {
    interval_min: { type: Number, default: 30000 },
    interval_max: { type: Number, default: 90000 },
    timeout: { type: Number, default: 30 },
    charset: { type: String, enum: ['UTF-8', 'Base64', 'PDU'], default: 'UTF-8' },
    coding: { type: Number, enum: [0, 1, 2], default: 0 },
    sdr: { type: Boolean, default: true },
    fdr: { type: Boolean, default: true },
    dr: { type: Boolean, default: true },
    to_all: { type: Boolean, default: false },
    sms_count: { type: Number, default: 100 },
    sms_period: { type: Number, default: 60 },
    dailyMessageLimit: { type: Number, default: 300 },
    selectedVariantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MessageVariant',
    },
    messageVariationType: { type: String, enum: ['single_variant','multiple_variants', 'ai_random'], default: 'single_variant' },
    useAiGeneration: { type: Boolean, default: false },
    aiPrompt: { type: String, default: '' },
    companyName: { type: String, default: '' }
  },
  // Statistics
  totalContacts: { type: Number, default: 0 },
  sentMessages: { type: Number, default: 0 },
  sentMessagesToday: { type: Number, default: 0 },
  deliveredMessages: { type: Number, default: 0 },
  failedMessages: { type: Number, default: 0 },
  deliveryRate: { type: Number, default: 0 },


sentCount: { type: Number, default: 0 },
pausedAt: Date,
resumedAt: Date,
  
  // Timestamps
  scheduledDate: { type: Date },
  processingStartedAt: { type: Date },
  completedAt: { type: Date },
  pauseReason: { type: String },
  
  // Task management
  taskId: [{ type: Number }],
  
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes
campaignSchema.index({ user: 1, status: 1 });
campaignSchema.index({ contactList: 1 });
campaignSchema.index({ device: 1 });
campaignSchema.index({ createdAt: -1 });

// Virtual for progress percentage
campaignSchema.virtual('progress').get(function() {
  if (this.totalContacts === 0) return 0;
  return Math.min(100, (this.sentMessages / this.totalContacts) * 100);
});

// Method to update delivery rate
campaignSchema.methods.updateDeliveryRate = function() {
  if (this.sentMessages > 0) {
    this.deliveryRate = (this.deliveredMessages / this.sentMessages) * 100;
  }
  return this.deliveryRate;
};

module.exports = mongoose.model('Campaign', campaignSchema);