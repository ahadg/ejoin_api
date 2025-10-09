const Device = require("../models/Device");
const Sim = require("../models/Sim");
const SimMessages = require("../models/SimMessages");
const { syncDeviceSms, findOrCreateContact } = require("../utils/helpers");
const Contact = require("../models/Contact");
const ContactList = require("../models/ContactList");
const { createAndEmitNotification } = require("./notificationController");



// ================== Get SMS ==================
exports.getSMS = async (req, res) => {
  try {
    const { simId, deviceId, limit = 50 } = req.query;
    const query = {};

    if (simId) query.sim = simId;

    if (deviceId) {
      // Find all sims for the device
      const sims = await Sim.find({ device: deviceId }).select("_id");
      query.sim = { $in: sims.map(s => s._id) };
    }

    const messages = await SimMessages.find(query)
      .populate("sim")
      .populate("contact")
      .sort({ timestamp: -1 })
      .limit(Number(limit));

    res.json({
      code: 200,
      data: { messages }
    });
  } catch (err) {
    console.error("Fetch SMS Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to fetch SMS" });
  }
};

// ================== Get Conversations ==================
exports.getConversations = async (req, res) => {
  try {
    const { deviceId } = req.query;
    
    if (!deviceId) {
      return res.status(400).json({ code: 400, reason: "deviceId is required" });
    }

    // Get all SIMs for the device
    const sims = await Sim.find({ device: deviceId }).select("_id port slot phoneNumber");
    
    // Get conversations grouped by phone number for each SIM
    const conversations = await SimMessages.aggregate([
      {
        $match: {
          sim: { $in: sims.map(s => s._id) }
        }
      },
      {
        $sort: { timestamp: -1 }
      },
      {
        $group: {
          _id: {
            phoneNumber: "$from",
            sim: "$sim",
            port: "$port",
            slot: "$slot"
          },
          lastMessage: { $first: "$sms" },
          lastTimestamp: { $first: "$timestamp" },
          unreadCount: {
            $sum: {
              $cond: [{ $eq: ["$read", false] }, 1, 0]
            }
          },
          messageCount: { $sum: 1 },
          contactId: { $first: "$contact" }
        }
      },
      {
        $lookup: {
          from: "sims",
          localField: "_id.sim",
          foreignField: "_id",
          as: "simInfo"
        }
      },
      {
        $unwind: "$simInfo"
      },
      {
        $lookup: {
          from: "contacts",
          localField: "contactId",
          foreignField: "_id",
          as: "contactInfo"
        }
      },
      {
        $unwind: {
          path: "$contactInfo",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          phoneNumber: "$_id.phoneNumber",
          port: "$simInfo.port",
          slot: "$simInfo.slot",
          lastMessage: 1,
          lastTimestamp: 1,
          unreadCount: 1,
          messageCount: 1,
          simId: "$simInfo._id",
          contact: "$contactInfo"
        }
      },
      {
        $sort: { lastTimestamp: -1 }
      }
    ]);

    res.json({
      code: 200,
      data: { conversations }
    });
  } catch (err) {
    console.error("Fetch Conversations Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to fetch conversations" });
  }
};

// ================== Get Conversation Messages ==================
exports.getConversationMessages = async (req, res) => {
  try {
    const { phoneNumber, port, slot, deviceId } = req.query;
    
    if (!phoneNumber || !port || !slot || !deviceId) {
      return res.status(400).json({ 
        code: 400, 
        reason: "phoneNumber, port, slot, and deviceId are required" 
      });
    }

    // Find the SIM
    const sim = await Sim.findOne({ 
      device: deviceId, 
      port: parseInt(port), 
      slot: parseInt(slot) 
    });
    
    if (!sim) {
      return res.status(404).json({ code: 404, reason: "SIM not found" });
    }

    // Get messages for this conversation
    const messages = await SimMessages.find({
      sim: sim._id,
      from: phoneNumber
    })
    .sort({ timestamp: 1 })
    .populate("sim")
    .populate("contact");

    // Mark all messages as read
    await SimMessages.updateMany(
      { 
        sim: sim._id, 
        from: phoneNumber,
        read: false 
      },
      { read: true }
    );

    res.json({
      code: 200,
      data: { messages }
    });
  } catch (err) {
    console.error("Fetch Conversation Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to fetch conversation" });
  }
};

// ================== Send SMS ==================
exports.sendSMS = async (req, res) => {
  try {
    const { deviceId, port, slot, to, sms, userId } = req.body;

    if (!deviceId || !port || !slot || !to || !sms) {
      return res.status(400).json({ 
        code: 400, 
        reason: "deviceId, port, slot, to, and sms are required" 
      });
    }

    // Find the device
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ code: 404, reason: "Device not found" });
    }

    // Find the SIM for the specified port and slot
    const sim = await Sim.findOne({ 
      device: deviceId, 
      port: parseInt(port), 
      slot: parseInt(slot) 
    });
    
    if (!sim) {
      return res.status(404).json({ code: 404, reason: "SIM not found for specified port and slot" });
    }

    // Find or create contact for recipient
    const contact = await findOrCreateContact(to, userId || (device.user ? device.user.toString() : null));

    // Save the outgoing message to database with contact reference
    const message = await SimMessages.create({
      sim: sim._id,
      contact: contact ? contact._id : undefined,
      timestamp: new Date(),
      from: sim.phoneNumber || 'Unknown',
      to: to,
      sms: sms,
      rawSms: Buffer.from(sms).toString('base64'),
      isReport: false,
      read: true,
      direction: 'outbound',
      status: 'sent' // Set initial status as 'sent'
    });

    // Populate for response
    const populatedMessage = await SimMessages.findById(message._id)
      .populate("sim")
      .populate("contact");

    res.status(201).json({ 
      code: 201, 
      success: true, 
      data: { message: populatedMessage } 
    });

  } catch (err) {
    console.error("Send SMS Error:", err);
    res.status(500).json({ 
      code: 500, 
      reason: "Failed to save SMS to database: " + err.message 
    });
  }
};

// ================== Create SMS ==================
exports.createSms = async (req, res) => {
  try {
    const { simId, from, to, sms, isReport = false, rawSms, userId } = req.body;

    if (!simId || !sms) {
      return res.status(400).json({ code: 400, reason: "simId and sms are required" });
    }

    const sim = await Sim.findById(simId);
    if (!sim) {
      return res.status(404).json({ code: 404, reason: "SIM not found" });
    }

    // Determine contact phone number and find/create contact
    const contactPhoneNumber = from || to;
    let contact = null;
    if (contactPhoneNumber) {
      contact = await findOrCreateContact(contactPhoneNumber, userId);
    }

    let message = await SimMessages.create({
      sim: sim._id,
      contact: contact ? contact._id : undefined,
      timestamp: new Date(),
      from,
      to,
      sms,
      rawSms,
      isReport,
      read: false,
      direction: from ? 'inbound' : 'outbound'
    });

    // Populate sim + device for output
    message = await message.populate("sim").populate("contact");

    res.status(201).json({ code: 201, success: true, data: { message } });
  } catch (err) {
    console.error("CreateMessage Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to create SMS" });
  }
};

// ================== Mark as Read ==================
exports.markAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await SimMessages.findByIdAndUpdate(
      messageId,
      { read: true },
      { new: true }
    )
    .populate("sim")
    .populate("contact");

    if (!message) {
      return res.status(404).json({ code: 404, reason: "Message not found" });
    }

    res.json({ code: 200, success: true, data: { message } });
  } catch (err) {
    console.error("MarkAsRead Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to mark message as read" });
  }
};

// ================== Sync SMS ==================
exports.syncSms = async (req, res) => {
  try {
    const device = await Device.findById(req.params.deviceId);
    if (!device) return res.status(404).json({ error: "Device not found" });

    await syncDeviceSms(device);
    res.json({ success: true });
  } catch (err) {
    console.error("Sync Error:", err);
    res.status(500).json({ error: "Failed to sync SMS" });
  }
};

// ================== Delete SMS ==================
exports.deleteSMS = async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await SimMessages.findByIdAndDelete(messageId);

    if (!message) {
      return res.status(404).json({ code: 404, reason: "Message not found" });
    }

    res.json({ 
      code: 200, 
      success: true, 
      message: "SMS deleted successfully" 
    });
  } catch (err) {
    console.error("Delete SMS Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to delete SMS" });
  }
};

// ================== Delete Conversation ==================
exports.deleteConversation = async (req, res) => {
  try {
    const { phoneNumber, port, slot, deviceId } = req.body;

    if (!phoneNumber || !port || !slot || !deviceId) {
      return res.status(400).json({ 
        code: 400, 
        reason: "phoneNumber, port, slot, and deviceId are required" 
      });
    }

    // Find the SIM
    const sim = await Sim.findOne({ 
      device: deviceId, 
      port: parseInt(port), 
      slot: parseInt(slot) 
    });
    
    if (!sim) {
      return res.status(404).json({ code: 404, reason: "SIM not found" });
    }

    // Delete all messages in the conversation
    const result = await SimMessages.deleteMany({
      sim: sim._id,
      from: phoneNumber
    });

    res.json({ 
      code: 200, 
      success: true, 
      data: { 
        deletedCount: result.deletedCount,
        message: `Deleted ${result.deletedCount} messages` 
      }
    });
  } catch (err) {
    console.error("Delete Conversation Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to delete conversation" });
  }
};

// ================== Get Unread Count ==================
exports.getUnreadCount = async (req, res) => {
  try {
    const { deviceId } = req.query;

    let query = { read: false };
    
    if (deviceId) {
      const sims = await Sim.find({ device: deviceId }).select("_id");
      query.sim = { $in: sims.map(s => s._id) };
    }

    const unreadCount = await SimMessages.countDocuments(query);

    res.json({
      code: 200,
      data: { unreadCount }
    });
  } catch (err) {
    console.error("Get Unread Count Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to get unread count" });
  }
};


// ================== Webhook (Receive SMS / Delivery Report) ==================
exports.webhookSMS = async (req, res) => {
  try {
    const { type, mac, smses } = req.body;
    const io = req.app.get("io"); // Socket.IO instance

    if (type !== "received-sms" || !Array.isArray(smses)) {
      return res.status(400).json({ code: 400, reason: "Invalid SMS webhook payload" });
    }

    for (const msg of smses) {
      const {
        is_report,
        port,
        slot,
        ts,
        from,
        to,
        iccid,
        imsi,
        imei,
        sms,
        status
      } = msg;

      // 🔹 Identify Device by MAC
      let device = await Device.findOne({ macAddress: mac });
      if (!device) {
        console.warn(`Device not found for MAC: ${mac}`);
        continue;
      }

      // 🔹 Find or create SIM
      let sim = await Sim.findOne({ device: device._id, port, slot });
      if (!sim) {
        sim = await Sim.create({ device: device._id, port, slot, iccid, imsi, imei });
      }

      // 🔹 Find or create contact for sender
      let contact = null;
      if (from) {
        contact = await findOrCreateContact(from, device.user ? device.user.toString() : null);
      }

      // 🔹 Decode SMS (reports may not have sms)
      let decodedSMS = null;
      if (sms) {
        try {
          decodedSMS = Buffer.from(sms, "base64").toString("utf-8");
        } catch (e) {
          decodedSMS = sms;
        }
      }

      // 🔹 Check if user is online (moved this up to use in both cases)
      const userRooms = io.sockets.adapter.rooms.get(`user:${device.user}`);
      const isUserOnline = userRooms && userRooms.size > 0;

      // 🔹 Handle Delivery Reports
      if (is_report) {
        // Update the original message status to mark it as reported
        await SimMessages.findOneAndUpdate(
          { 
            to: from, // In reports, 'from' is the original recipient
            from: to, // In reports, 'to' is the original sender
            port,
            slot,
            direction: 'outbound'
          },
          { 
            $set: { 
              status: 'reported',
              isReport: true,
              reportTimestamp: new Date(ts * 1000)
            } 
          }
        );
      
        // 🔹 Save the report as a regular message in database (so it appears in conversations)
        const reportMessage = await SimMessages.create({
          sim: sim._id,
          contact: contact ? contact._id : undefined,
          clientNumber: from,
          timestamp: new Date(ts * 1000),
          from,
          to,
          read: false,
          isReport: true,
          sms: 'User reported this number as spam',
          rawSms: null,
          direction: 'inbound',
          status: 'delivered',
          isSpamReport: true
        });
        
        // 🔹 Re-fetch with populate
        const populatedReport = await SimMessages.findById(reportMessage._id)
          .populate("sim")
          .populate("contact");

        if (isUserOnline) {
          // User is online - emit real-time report as message
          io.to(`user:${device.user}`).emit("sms-received", {
            ...populatedReport.toObject(),
            id: populatedReport._id.toString()
          });
          
          console.log(`Real-time spam report sent to user:${device.user}`, {
            from: from,
            type: 'spam_report'
          });
        } 
        //else {
          // User is offline - create notification for spam report
          const notificationData = {
            user: device.user,
            title: 'Spam Report Received',
            message: `Your number was reported as spam by ${from}`,
            type: 'warning',
            data: {
              messageId: populatedReport._id.toString(),
              phoneNumber: from,
              port,
              slot,
              timestamp: new Date(ts * 1000),
              isSpamReport: true
            }
          };
      
          await createAndEmitNotification(io, notificationData);
          console.log(`User offline, spam report notification created for user:${device.user}`);
        //}
      
        // Update contact to mark as reported/spam
        if (from) {
          await Contact.findOneAndUpdate(
            { phoneNumber: from },
            { 
              $set: { 
                isReport: true, 
                optedIn: false,
                isSpam: true,
                lastReported: new Date(ts * 1000)
              } 
            }
          );
        }
      
        continue; // Skip the rest of the loop for this report
      }

      // 🔹 Save regular incoming message
      let savedMessage = await SimMessages.create({
        sim: sim._id,
        contact: contact ? contact._id : undefined,
        clientNumber: from,
        timestamp: new Date(ts * 1000),
        from,
        to,
        read: false,
        isReport: false,
        sms: decodedSMS,
        rawSms: sms || null,
        direction: 'inbound',
        status: 'delivered'
      });

      // 🔹 Populate for output
      savedMessage = await savedMessage.populate("sim").populate("contact");

      if (isUserOnline) {
        // User is online - emit real-time message to user room
        io.to(`user:${device.user}`).emit("sms-received", {
          ...savedMessage.toObject(),
          id: savedMessage._id.toString()
        });
        
        console.log(`Real-time SMS sent to user:${device.user}`, {
          from: from,
          message: decodedSMS ? decodedSMS.substring(0, 50) + '...' : 'No content'
        });
      } else {
        // User is offline - create notification
        const notificationData = {
          user: device.user,
          title: 'New SMS Received',
          message: `From: ${from} - ${decodedSMS ? decodedSMS.substring(0, 50) + (decodedSMS.length > 50 ? '...' : '') : 'No content'}`,
          type: 'info',
          data: {
            messageId: savedMessage._id.toString(),
            phoneNumber: from,
            port,
            slot,
            timestamp: new Date(ts * 1000),
            preview: decodedSMS ? decodedSMS.substring(0, 100) : ''
          }
        };

        await createAndEmitNotification(io, notificationData);
        console.log(`User offline, notification created for user:${device.user}`);
      }
    }

    res.status(201).json({ code: 201, success: true });
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to save SMS" });
  }
};