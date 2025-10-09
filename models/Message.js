const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: 'General'
  },
  originalPrompt: {
    type: String,
    required: true
  },
  baseMessage: {
    type: String
  },
  settings: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isTemplate: {
    type: Boolean,
    default: false
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
messageSchema.index({ user: 1 });
messageSchema.index({ createdAt: -1 });

messageSchema.virtual('variants', {
  ref: 'MessageVariant',
  localField: '_id',
  foreignField: 'message'
});

messageSchema.set('toObject', { virtuals: true });
messageSchema.set('toJSON', { virtuals: true });


module.exports = mongoose.model('Message', messageSchema);