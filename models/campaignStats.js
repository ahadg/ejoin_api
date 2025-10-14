// models/CampaignStats.js
const mongoose = require('mongoose');

const campaignStatsSchema = new mongoose.Schema({
  campaign: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Campaign", 
    required: true,
    index: true 
  },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true,
    index: true 
  },
  date: { 
    type: Date, 
    required: true, 
    index: true 
  },
  
  // Summary counters
  sentMessages: { type: Number, default: 0 },
  deliveredMessages: { type: Number, default: 0 },
  failedMessages: { type: Number, default: 0 },
  readMessages: { type: Number, default: 0 },
  pendingMessages: { type: Number, default: 0 },
  
  // Performance metrics
  averageProcessingTime: { type: Number, default: 0 },
  averageDeliveryLatency: { type: Number, default: 0 },
  averageReadLatency: { type: Number, default: 0 },
  deliveryRate: { type: Number, default: 0 },
  readRate: { type: Number, default: 0 },
  
  // Cost tracking
  totalCost: { type: Number, default: 0 },
  estimatedCost: { type: Number, default: 0 },
  
  // Device performance
  devicesUsed: [{ 
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  }],
  
  // Variant performance
  variantsUsed: [{ 
    variant: { type: mongoose.Schema.Types.ObjectId, ref: 'MessageVariant' },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  }],
  
  // Hourly breakdown for detailed analytics
  hourlyStats: [{
    hour: { type: Number, min: 0, max: 23 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  }]
  
}, { 
  timestamps: true 
});

campaignStatsSchema.index({ campaign: 1, date: 1 }, { unique: true });
campaignStatsSchema.index({ user: 1, date: -1 });

// Virtual for total messages
campaignStatsSchema.virtual('totalMessages').get(function() {
  return this.sentMessages + this.deliveredMessages + this.failedMessages + this.pendingMessages;
});

// Update delivery rate when delivered messages change
campaignStatsSchema.pre('save', function(next) {
  if (this.sentMessages > 0) {
    this.deliveryRate = (this.deliveredMessages / this.sentMessages) * 100;
  }
  if (this.deliveredMessages > 0) {
    this.readRate = (this.readMessages / this.deliveredMessages) * 100;
  }
  next();
});

module.exports = mongoose.model('CampaignStats', campaignStatsSchema);