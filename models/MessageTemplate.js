const mongoose = require('mongoose');

const messageTemplateSchema = new mongoose.Schema({
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

messageTemplateSchema.index({ user: 1 });
messageTemplateSchema.index({ createdAt: -1 });

messageTemplateSchema.virtual('variants', {
  ref: 'MessageVariant',
  localField: '_id',
  foreignField: 'message'
});

messageTemplateSchema.set('toObject', { virtuals: true });
messageTemplateSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema, 'messages');
