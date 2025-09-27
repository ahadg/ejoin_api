const mongoose = require('mongoose');

const messageVariantSchema = new mongoose.Schema({
  message: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  tone: {
    type: String,
  },
  language: {
    type: String,
    default: 'English'
  },
  characterCount: {
    type: Number,
    required: true
  },
  spamScore: {
    type: Number,
    min: 0,
    max: 10
  },
  encoding: {
    type: String,
    enum: ['GSM-7', 'UCS-2'],
    default: 'GSM-7'
  },
  cost: {
    type: Number,
    default: 1
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for message reference
messageVariantSchema.index({ message: 1 });

module.exports = mongoose.model('MessageVariant', messageVariantSchema);