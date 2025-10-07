const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contactList: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactList',
    //required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  countryCode: {
    type: String,
    default: '+1'
  },
  firstName: String,
  lastName: String,
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
  importBatchId: String
}, {
  timestamps: true
});

// Compound index for unique phone number per contact list
contactSchema.index({ contactList: 1, phoneNumber: 1 }, { unique: true });

// Update contact list counts when contacts change
contactSchema.post('save', async function() {
  await this.model('ContactList').updateCounts(this.contactList);
});

contactSchema.post('remove', async function() {
  await this.model('ContactList').updateCounts(this.contactList);
});

module.exports = mongoose.model('Contact', contactSchema);