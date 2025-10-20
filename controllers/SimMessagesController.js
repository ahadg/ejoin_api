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

    // Aggregate messages by SIM and contact
    const conversations = await SimMessages.aggregate([
      {
        $match: {
          sim: { $in: sims.map((s) => s._id) },
        },
      },
      {
        $sort: { timestamp: -1 },
      },
      {
        $group: {
          _id: {
            contact: "$contact",
            sim: "$sim",
          },
          lastMessage: { $first: "$sms" },
          lastTimestamp: { $first: "$timestamp" },
          lastDirection: { $first: "$direction" }, // ✅ new field
          unreadCount: {
            $sum: {
              $cond: [{ $eq: ["$read", false] }, 1, 0],
            },
          },
          messageCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "sims",
          localField: "_id.sim",
          foreignField: "_id",
          as: "simInfo",
        },
      },
      { $unwind: "$simInfo" },
      {
        $lookup: {
          from: "contacts",
          localField: "_id.contact",
          foreignField: "_id",
          as: "contactInfo",
        },
      },
      {
        $unwind: {
          path: "$contactInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          simId: "$simInfo._id",
          port: "$simInfo.port",
          slot: "$simInfo.slot",
          lastMessage: 1,
          lastTimestamp: 1,
          lastDirection: 1, // ✅ include in result
          unreadCount: 1,
          messageCount: 1,
          // Prefer phone number from contact if exists
          phoneNumber: {
            $ifNull: ["$contactInfo.phoneNumber", "$simInfo.phoneNumber"],
          },
          contact: "$contactInfo",
        },
      },
      { $sort: { lastTimestamp: -1 } },
    ]);

    res.json({
      code: 200,
      data: { conversations },
    });
  } catch (err) {
    console.error("Fetch Conversations Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to fetch conversations" });
  }
};



// ================== Get Conversation Messages ==================
exports.getConversationMessages = async (req, res) => {
  try {
    const { simId, contactId, phoneNumber, port, slot, deviceId } = req.query;

    if ((!simId && (!port || !slot || !deviceId)) || (!contactId && !phoneNumber)) {
      return res.status(400).json({
        code: 400,
        reason: "Either (simId or deviceId+port+slot) and (contactId or phoneNumber) are required"
      });
    }

    let sim;
    let contact;

    // ✅ Use simId directly if provided
    if (simId) {
      sim = { _id: simId };
    } else {
      sim = await Sim.findOne({
        device: deviceId,
        port: parseInt(port),
        slot: parseInt(slot)
      }).select("_id port slot phoneNumber");
    }

    if (!sim) {
      return res.status(404).json({ code: 404, reason: "SIM not found" });
    }

    // ✅ Use contactId directly if provided
    if (contactId) {
      contact = { _id: contactId };
    } else {
      contact = await Contact.findOne({
        user: req.user._id,
        phoneNumber
      }).select("_id name phoneNumber");
    }

    if (!contact) {
      return res.status(404).json({ code: 404, reason: "Contact not found" });
    }

    // ✅ Fetch all messages for this SIM + Contact
    const messages = await SimMessages.find({
      sim: sim._id,
      contact: contact._id
    })
      .sort({ timestamp: 1 })
      .populate("sim")
      .populate("contact");

    // ✅ Mark unread messages as read
    await SimMessages.updateMany(
      {
        sim: sim._id,
        contact: contact._id,
        read: false
      },
      { read: true }
    );

    res.json({
      code: 200,
      data: { messages, sim, contact }
    });
  } catch (err) {
    console.error("Fetch Conversation Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to fetch conversation" });
  }
};


// ================== Send SMS ==================
// ================== Send SMS ==================
exports.sendSMS = async (req, res) => {
  try {
    const { deviceId, port, slot, to, sms, userId,contactId } = req.body;

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
    let contact 
    if(!contactId) {
      contact  = await findOrCreateContact(to, userId || (device.user ? device.user.toString() : null));
    }else {
      contact = { _id : contactId }
    }

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
      read: true, // Outbound messages are marked as read by default
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

  console.log("createSms",req.body)
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


// Helper function to check if user is viewing conversation
const isUserViewingConversation = (userSockets, messageData) => {
  const { from, to, direction, port, slot } = messageData;
  
  return userSockets.some(socket => {
    if (!socket.currentConversation) return false;
    
    const conv = socket.currentConversation;
    const messagePhone = direction === 'inbound' ? from : to;
    
    // Check if conversation matches the message
    const phoneMatch = conv.phoneNumber === messagePhone;
    const portMatch = conv.port === port;
    const slotMatch = conv.slot === slot;
    
    return phoneMatch && portMatch && slotMatch;
  });
};

// Helper function to get user online status - FIXED VERSION
const getUserOnlineStatus = (io, userId, messageData) => {
  const { from, to, port, slot } = messageData;
  
  const userRooms = io.sockets.adapter.rooms.get(`user:${userId}`);
  const isUserOnline = userRooms && userRooms.size > 0;
  
  let isUserOnInbox = false;
  let isViewingThisConversation = false;
  let userSockets = [];

  if (isUserOnline) {
    // Get all user's sockets
    userSockets = Array.from(io.sockets.sockets.values()).filter(
      socket => socket.userId === userId.toString()
    );
    
    // Check if user is on inbox section
    isUserOnInbox = userSockets.some(socket => 
      socket.currentSection === 'inbox' || 
      socket.isViewingInbox === true
    );
    
    // Check if user is viewing this specific conversation
    if (isUserOnInbox) {
      isViewingThisConversation = isUserViewingConversation(userSockets, {
        from,
        to,
        direction: 'inbound',
        port,
        slot
      });
    }
  }

  return {
    isUserOnline,
    isUserOnInbox,
    isViewingThisConversation,
    userSockets
  };
};

// Main webhook handler - FIXED VERSION
exports.webhookSMS = async (req, res) => {
  try {
    const { type, mac, smses } = req.body;
    const io = req.app.get("io");

    if (type !== "received-sms" || !Array.isArray(smses)) {
      return res.status(400).json({ code: 400, reason: "Invalid SMS webhook payload" });
    }

    console.log(`📱 Webhook received from MAC: ${mac}, SMS count: ${smses.length}`);

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
      let device = await Device.findOne({ macAddress: mac }).populate('user');
      if (!device) {
        console.warn(`❌ Device not found for MAC: ${mac}`);
        continue;
      }

      if (!device.user) {
        console.warn(`❌ Device ${mac} has no associated user`);
        continue;
      }

      console.log(`📞 Processing SMS from ${from} to ${to} on port ${port}, slot ${slot}`);

      // 🔹 Find or create SIM
      let sim = await Sim.findOne({ device: device._id, port, slot });
      if (!sim) {
        sim = await Sim.create({ 
          device: device._id, 
          port, 
          slot, 
          iccid, 
          imsi, 
          imei 
        });
        console.log(`✅ Created new SIM: ${port}-${slot}`);
      }

      // 🔹 Find or create contact for sender
      let contact = null;
      if (from) {
        contact = await findOrCreateContact(from, device.user._id.toString());
      }

      // 🔹 Decode SMS
      let decodedSMS = null;
      if (sms) {
        try {
          decodedSMS = Buffer.from(sms, "base64").toString("utf-8");
        } catch (e) {
          decodedSMS = sms;
          console.warn('Could not decode SMS as base64, using raw value');
        }
      }

      // 🔹 Check user online status and viewing state - FIXED CALL
      const userStatus = getUserOnlineStatus(io, device.user._id.toString(), {
        from,
        to,
        port,
        slot
      });
      const { isUserOnline, isUserOnInbox, isViewingThisConversation } = userStatus;

      console.log(`👤 User ${device.user._id} status:`, {
        online: isUserOnline,
        onInbox: isUserOnInbox,
        viewingConversation: isViewingThisConversation
      });

      if (is_report) {
        console.log(`🚨 Processing spam report from ${from}`);

        // Update original message status
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

        const contactList = await ContactList.findOne({ _id: contact.contactList});
        if(contactList) {
          // 🔹 Recount opted-in/out totals after update
          const [counts] = await Contact.aggregate([
            { $match: { contactList: contactList._id } },
            {
              $group: {
                _id: null,
                totalContacts: { $sum: 1 },
                optedInCount: { $sum: { $cond: ['$optedIn', 1, 0] } },
                optedOutCount: { $sum: { $cond: ['$optedIn', 0, 1] } }
              }
            }
          ]);

          // 🔹 Update list counts
          await ContactList.findByIdAndUpdate(contactList._id, {
            totalContacts: counts?.totalContacts || 0,
            optedInCount: counts?.optedInCount || 0,
            optedOutCount: counts?.optedOutCount || 0
          });
        }
      
        // Create spam report message
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
        
        const populatedReport = await SimMessages.findById(reportMessage._id)
          .populate("sim")
          .populate("contact");

        // Emit real-time message if user is online
        if (isUserOnline) {
          io.to(`user:${device.user._id}`).emit("sms-received", {
            ...populatedReport.toObject(),
            id: populatedReport._id.toString()
          });
          
          console.log(`📤 Real-time spam report sent to user:${device.user._id}`);
        }

        // Only create notification if user is offline OR not viewing this conversation
        const shouldCreateNotification = !isUserOnline || !isUserOnInbox || !isViewingThisConversation;

        if (shouldCreateNotification) {
          const notificationData = {
            user: device.user._id,
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
          console.log(`📢 Spam report notification created for user:${device.user._id}`, {
            userOnline: isUserOnline,
            userOnInbox: isUserOnInbox,
            viewingConversation: isViewingThisConversation
          });
        } else {
          console.log(`🔇 Spam report notification skipped - user is viewing conversation`);
        }

        // Update contact as spam
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
          console.log(`📝 Marked contact ${from} as spam`);
        }
      
        continue;
      }

      // ==========================================================
      // 🔸 Handle Regular or STOP Messages
      // ==========================================================

      const lowerMsg = (decodedSMS || '').trim().toLowerCase();
      const isStopMessage = ['stop', 'unsubscribe', 'cancel', 'quit', 'end', 'unsub'].includes(lowerMsg);

      console.log(`📨 Processing ${isStopMessage ? 'STOP' : 'regular'} message from ${from}`);

      // 🔹 Save the message
      const savedMessage = await SimMessages.create({
        sim: sim._id,
        contact: contact ? contact._id : undefined,
        clientNumber: from,
        timestamp: new Date(ts * 1000),
        from,
        to,
        read: false,
        isReport: isStopMessage,
        sms: decodedSMS,
        rawSms: sms || null,
        direction: 'inbound',
        status: isStopMessage ? 'unsubscribed' : 'delivered',
        isSpamReport: isStopMessage
      });
      
      const populatedMessage = await SimMessages.findById(savedMessage._id)
        .populate("sim")
        .populate("contact");

      // 🔹 Handle STOP message
      if (isStopMessage && from) {
        await Contact.findOneAndUpdate(
          { phoneNumber: from },
          {
            $set: {
              isReport: true,
              isSpam: true,
              optedIn: false,
              lastReported: new Date(ts * 1000)
            }
          },
          { new: true }
        );

        console.log(`🛑 STOP message processed from ${from}`);
      }

      // 🔹 Emit real-time message if user is online
      if (isUserOnline) {
        io.to(`user:${device.user._id}`).emit("sms-received", {
          ...populatedMessage.toObject(),
          id: populatedMessage._id.toString()
        });

        console.log(`📤 Real-time SMS sent to user:${device.user._id}`, {
          from: from,
          message: decodedSMS ? decodedSMS.substring(0, 30) + '...' : 'No content',
          isStopMessage
        });
      }

      // 🔹 Determine if notification should be created
      // Only create notification if:
      // 1. User is offline, OR
      // 2. User is online but NOT on inbox, OR  
      // 3. User is on inbox but NOT viewing this specific conversation
      const shouldCreateNotification = !isUserOnline || !isUserOnInbox || !isViewingThisConversation;

      if (shouldCreateNotification) {
        const notificationTitle = isStopMessage ? 'Unsubscribe Message Received' : 'New SMS Received';
        const notificationMessage = isStopMessage
          ? `From: ${from} - Sent "STOP" to unsubscribe`
          : `From: ${from} - ${decodedSMS ? decodedSMS.substring(0, 50) + (decodedSMS.length > 50 ? '...' : '') : 'No content'}`;

        const notificationData = {
          user: device.user._id,
          title: notificationTitle,
          message: notificationMessage,
          type: isStopMessage ? 'warning' : 'info',
          data: {
            messageId: savedMessage._id.toString(),
            phoneNumber: from,
            port,
            slot,
            timestamp: new Date(ts * 1000),
            preview: decodedSMS ? decodedSMS.substring(0, 100) : '',
            isStopMessage,
            direction: 'inbound'
          }
        };

        await createAndEmitNotification(io, notificationData);
        
        console.log(`📢 Notification created for user:${device.user._id}`, {
          userOnline: isUserOnline,
          userOnInbox: isUserOnInbox,
          viewingConversation: isViewingThisConversation,
          type: isStopMessage ? 'STOP' : 'regular'
        });
      } else {
        console.log(`🔇 Notification skipped for user:${device.user._id}`, {
          userOnline: isUserOnline,
          userOnInbox: isUserOnInbox,
          viewingConversation: isViewingThisConversation,
          reason: 'User is online and viewing this conversation in inbox'
        });
      }
    }

    console.log(`✅ Webhook processing completed for MAC: ${mac}`);
    res.status(201).json({ code: 201, success: true, processed: smses.length });

  } catch (err) {
    console.error("❌ Webhook Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to save SMS", error: err.message });
  }
};

// Health check endpoint for webhook
exports.webhookHealth = async (req, res) => {
  try {
    const io = req.app.get("io");
    
    // Check socket.io connection status
    const socketCount = io.engine.clientsCount;
    const rooms = Array.from(io.sockets.adapter.rooms.keys());
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      sockets: {
        connected: socketCount,
        rooms: rooms.length
      },
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
};


