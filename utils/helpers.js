const Contact = require("../models/Contact");
const Sim = require("../models/Sim");
const SimMessages = require("../models/SimMessages");
const DeviceClient = require("../services/deviceClient");


exports.findOrCreateContact = async (phoneNumber, userId = null,is_report) => {
  try {
    if (!phoneNumber) return null;

    // First, try to find existing contact by phone number (across all contact lists)
    let contact = await Contact.findOne({ 
      phoneNumber: phoneNumber,
      user : userId 
    }).populate('contactList');
    console.log("contact", contact);
    if (contact) {
      console.log(`Found existing contact for ${phoneNumber}`);
      return contact;
    }

    // If contact doesn't exist, create a new one
    console.log(`Creating new contact for ${phoneNumber}`);

    // Create the contact (contactList is optional)
    contact = await Contact.create({
      user: userId,
      contactList:  undefined,
      phoneNumber: phoneNumber,
      firstName: "Unknown",
      lastName: "",
      optedIn: true,
      isReport: is_report ? true : false,
      status: 'active',
      source: 'auto-sms'
    });

    return contact;
  } catch (error) {
    console.error("Error in findOrCreateContact:", error);
    return null;
  }
};

// ================== Sync Device SMS ==================
exports.syncDeviceSms = async (device) => {
  const client = new DeviceClient(device);

  // call device API to fetch SMS (your device returns { smses: [] })
  const result = await client.getSms();
  const smses = result?.smses || [];
  console.log("smses", smses);
  for (const msg of smses) {
    const { port, slot, timestamp, from, to, is_report, sms } = msg;

    // find/create SIM
    let sim = await Sim.findOne({ device: device._id, port, slot });
    if (!sim) {
      sim = await Sim.create({ device: device._id, port, slot });
    }

    // Find or create contact for sender
    let contact = null;
    if (from
      // && !is_report
      ) {
      contact = await this.findOrCreateContact(from, device.user ? device.user.toString() : null,is_report);
    }

    // decode base64 message safely
    let decodedSMS = "";
    if (sms) {
      try {
        decodedSMS = Buffer.from(sms, "base64").toString("utf-8");
      } catch (e) {
        console.error("Failed to decode SMS for device:", device._id, "raw:", sms, e);
      }
    } else {
      console.warn("SMS field missing for message:", msg);
    }

    // avoid duplicates
    const exists = await SimMessages.findOne({
      sim: sim._id,
      timestamp: new Date(timestamp * 1000),
      from: from,
    });

    if (!exists) {
      await SimMessages.create({
        sim: sim._id,
        contact: contact ? contact._id : undefined,
        timestamp: new Date(timestamp * 1000),
        from: from,
        to: to,
        isReport: is_report,
        sms: decodedSMS,
        rawSms: sms || null,
        direction: 'inbound'
      });
    }
  }

  return smses.length;
};
