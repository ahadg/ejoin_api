// models/MessageSentDetails.js
const mongoose = require('mongoose');

const messageSentdetailschema = new mongoose.Schema({
  // References
  campaign: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Campaign", 
    //required: true,
    index: true 
  },
  campaignStats: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "CampaignStats", 
    index: true 
  },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true,
    index: true 
  },
  contact: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Contact" 
  },
  device: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Device" 
  },
//   messageVariant: { 
//     type: mongoose.Schema.Types.ObjectId, 
//     ref: "MessageVariant" 
//   },
  
  // Message Content
  messageId: { 
    type: String, 
    //required: true,
    //unique: true,
    index: true 
  },
  phoneNumber: { 
    type: String, 
    //required: true,
    //index: true 
  },
  content: { 
    type: String, 
    //required: true 
  },
  contentHash: { 
    type: String, 
    //index: true 
  },
  
  // Message Properties
  characterCount: { type: Number },
  encoding: { 
    type: String, 
    enum: ['GSM-7', 'UCS-2'], 
    default: 'GSM-7' 
  },
  segments: { type: Number, default: 1 },
  cost: { type: Number, default: 1 },
  
  // Variant Information
  tone: { type: String },
  language: { type: String, default: 'English' },
  variantType: { 
    type: String, 
    enum: ['single_variant', 'multiple_variants', 'ai_random'],
    default: 'single_variant'
  },
  
  // Delivery Information
  status: { 
    type: String, 
    enum: ['pending', 'sent', 'delivered', 'failed', 'read', 'undelivered'], 
    default: 'pending',
    //index: true 
  },
  statusHistory: [{
    status: { type: String, 
    //    required: true 
    },
    timestamp: { type: Date, default: Date.now },
    reason: { type: String },
    data: { type: mongoose.Schema.Types.Mixed }
  }],
  
  // Technical Details
  taskId: { type: String },
  processingTime: { type: Number }, // in milliseconds
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },
  simId : {type : String},
  simId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Sim" 
  },
  
  // API Responses
  sendResponse: { type: mongoose.Schema.Types.Mixed },
  deliveryResponse: { type: mongoose.Schema.Types.Mixed },
  errorDetails: {
    code: { type: String },
    message: { type: String },
    stackTrace: { type: String },
    recoverable: { type: Boolean, default: false }
  },
  
  // Device Information
  deviceName: { type: String },
  deviceSignal: { type: Number },
  deviceBattery: { type: Number },
  
  // Timestamps
  sentAt: { type: Date },
  deliveredAt: { type: Date },
  readAt: { type: Date },
  failedAt: { type: Date },
  
  // Analytics
  deliveryLatency: { type: Number }, // Time from sent to delivered in ms
  readLatency: { type: Number }, // Time from delivered to read in ms
  
}, { 
  timestamps: true 
});

// Indexes for common queries
messageSentdetailschema.index({ campaign: 1, status: 1 });
messageSentdetailschema.index({ user: 1, createdAt: -1 });
messageSentdetailschema.index({ phoneNumber: 1, createdAt: -1 });
messageSentdetailschema.index({ createdAt: -1 });
//messageSentdetailschema.index({ sentAt: -1 });
messageSentdetailschema.index({ 'statusHistory.timestamp': -1 });

// Pre-save middleware to generate content hash
messageSentdetailschema.pre('save', function(next) {
  if (this.isModified('content')) {
    const crypto = require('crypto');
    this.contentHash = crypto.createHash('md5').update(this.content).digest('hex');
  }
  next();
});

// Method to update status with history
messageSentdetailschema.methods.updateStatus = function(newStatus, reason = '', data = null) {
  this.status = newStatus;
  this.statusHistory.push({
    status: newStatus,
    timestamp: new Date(),
    reason: reason,
    data: data
  });
  
  // Set specific timestamps based on status
  switch (newStatus) {
    case 'sent':
      this.sentAt = new Date();
      break;
    case 'delivered':
      this.deliveredAt = new Date();
      if (this.sentAt) {
        this.deliveryLatency = this.deliveredAt - this.sentAt;
      }
      break;
    case 'read':
      this.readAt = new Date();
      if (this.deliveredAt) {
        this.readLatency = this.readAt - this.deliveredAt;
      }
      break;
    case 'failed':
      this.failedAt = new Date();
      break;
  }
};

// Static method for bulk status updates
messageSentdetailschema.statics.bulkUpdateStatus = async function(messageIds, newStatus, reason = '') {
  const updates = messageIds.map(messageId => ({
    updateOne: {
      filter: { messageId },
      update: {
        $set: { status: newStatus },
        $push: {
          statusHistory: {
            status: newStatus,
            timestamp: new Date(),
            reason: reason
          }
        }
      }
    }
  }));
  
  return this.bulkWrite(updates);
};

module.exports = mongoose.model('MessageSentDetail', messageSentdetailschema);