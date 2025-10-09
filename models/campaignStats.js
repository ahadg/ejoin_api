const mongoose = require('mongoose');

const campaignStatsSchema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  date: { type: Date, required: true, index: true },
  sentMessages: { type: Number, default: 0 },
  deliveredMessages: { type: Number, default: 0 },
  failedMessages: { type: Number, default: 0 },
  averageProcessingTime: { type: Number, default: 0 }  
}, { timestamps: true });

campaignStatsSchema.index({ date: -1 });
campaignStatsSchema.index({ user: 1 });

module.exports = mongoose.model('campaignStats', campaignStatsSchema);