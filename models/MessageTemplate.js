const mongoose = require('mongoose');

const messageTemplateSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: 'general'
  }
}, {
  timestamps: true
});

// Index for user reference
messageTemplateSchema.index({ user: 1 });

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema);