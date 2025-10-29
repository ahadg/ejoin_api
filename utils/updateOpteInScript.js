const mongoose = require("mongoose");
const dotenv = require("dotenv");
const SimMessages = require("../models/SimMessages");
const Contact = require("../models/Contact");
const ContactList = require("../models/ContactList");

dotenv.config();

async function updateContactListCounts(contactListId) {
  if (!contactListId) return;

  try {
    const [counts] = await Contact.aggregate([
      { $match: { contactList: contactListId } },
      {
        $group: {
          _id: null,
          totalContacts: { $sum: 1 },
          optedInCount: { $sum: { $cond: ["$optedIn", 1, 0] } },
          optedOutCount: { $sum: { $cond: ["$optedIn", 0, 1] } },
        },
      },
    ]);

    await ContactList.findByIdAndUpdate(contactListId, {
      totalContacts: counts?.totalContacts || 0,
      optedInCount: counts?.optedInCount || 0,
      optedOutCount: counts?.optedOutCount || 0,
    });

    console.log(`📊 ContactList counts updated for list: ${contactListId}`);
  } catch (err) {
    console.error(`⚠️ Failed to update contact list counts: ${contactListId}`, err.message);
  }
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    const stopKeywords = ["stop", "unsubscribe", "cancel", "quit", "end", "unsub"];
    const stopMessages = await SimMessages.find({
      sms: { $regex: stopKeywords.join("|"), $options: "i" },
      direction: "inbound",
    });

    console.log(`Found ${stopMessages.length} messages with STOP keywords`);

    for (const msg of stopMessages) {
      if (!msg.from) continue;

      // Normalize phone number variations
      const original = msg.from.replace(/\D/g, ""); // only digits
      const noCountryCode = original.startsWith("1") ? original.slice(1) : original;
      const withCountryCode = original.startsWith("1") ? original : `1${original}`;

      // Match both patterns
      const phoneMatches = [original, noCountryCode, withCountryCode];

      const updatedContacts = await Contact.updateMany(
        { phoneNumber: { $in: phoneMatches } },
        {
          $set: {
            optedIn: false,
            isSpam: true,
            isReport: true,
            unsubscribedAt: msg.timestamp || new Date(),
            lastReported: msg.timestamp || new Date(),
          },
        }
      );

      console.log(`Updated ${updatedContacts.modifiedCount} contacts for ${msg.from}`);

      // Find ALL contacts matching either version
      const contacts = await Contact.find({ phoneNumber: { $in: phoneMatches } });

      const contactListIds = [
        ...new Set(contacts.map((c) => c.contactList).filter(Boolean)),
      ];

      for (const listId of contactListIds) {
        await updateContactListCounts(listId);
      }
    }

    console.log("✅ All STOP messages processed.");
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})();
