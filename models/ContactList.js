const mongoose = require('mongoose');

const contactListSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: String,
  totalContacts: { type: Number, default: 0 },
  optedInCount: { type: Number, default: 0 },
  optedOutCount: { type: Number, default: 0 }
}, { timestamps: true });

// ✅ Static method defined here (not in Contact.js)
contactListSchema.statics.updateCounts = async function (contactListId) {
  const counts = await this.model('Contact').aggregate([
    { $match: { contactList: contactListId } },
    {
      $group: {
        _id: null,
        totalContacts: { $sum: 1 },
        optedInCount: { $sum: { $cond: ['$optedIn', 1, 0] } },
        optedOutCount: { $sum: { $cond: ['$optedIn', 0, 1] } }
      }
    }
  ]);

  if (counts.length > 0) {
    await this.findByIdAndUpdate(contactListId, {
      totalContacts: counts[0].totalContacts,
      optedInCount: counts[0].optedInCount,
      optedOutCount: counts[0].optedOutCount
    });
  } else {
    // No contacts left → reset counts
    await this.findByIdAndUpdate(contactListId, {
      totalContacts: 0,
      optedInCount: 0,
      optedOutCount: 0
    });
  }
};

module.exports = mongoose.model('ContactList', contactListSchema);
