const mongoose = require('mongoose');
// models/Contact.js
const contactSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contactList: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactList',
  },
  phoneNumber: {
    type: String,
    required: true
  },
  firstName: String,
  lastName: String,
  middleName: String,
  email: String,
  company: String,
  tags: [String],
  customFields: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  optedIn: {
    type: Boolean,
    default: true
  },
  isReport: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'bounced'],
    default: 'active'
  },
  source: {
    type: String,
    default: 'manual'
  },
  importBatchId: String,
  
  // NEW: SIM affinity tracking
  assignedSim: {
    simId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sim'
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device'
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    lastUsedAt: Date
  }
}, {
  timestamps: true
});

// Compound index for unique phone number per contact list
contactSchema.index({ contactList: 1, phoneNumber: 1 }, 
  { unique: true }
);

// Index for SIM affinity queries
contactSchema.index({ 'assignedSim.simId': 1 });
//contactSchema.index({ 'assignedSim.deviceId': 1 });

// Update contact list counts when contacts change
contactSchema.post('save', async function() {
  await this.model('ContactList').updateCounts(this.contactList);
});

contactSchema.post('remove', async function() {
  await this.model('ContactList').updateCounts(this.contactList);
});

module.exports = mongoose.model('Contact', contactSchema);