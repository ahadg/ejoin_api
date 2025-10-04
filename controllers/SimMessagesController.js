const Device = require("../models/Device");
const Sim = require("../models/Sim");
const SimMessages = require("../models/SimMessages");
const { syncDeviceSms } = require("../utils/helpers");
const Contact = require("../models/Contact");

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

// Add to your SMS controller
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
          messageCount: { $sum: 1 }
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
        $project: {
          phoneNumber: "$_id.phoneNumber",
          port: "$simInfo.port",
          slot: "$simInfo.slot",
          lastMessage: 1,
          lastTimestamp: 1,
          unreadCount: 1,
          messageCount: 1,
          simId: "$simInfo._id"
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
    .populate({
      path: "sim",
      populate: { path: "device" }
    });

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

// Add to your SMS controller
exports.sendSMS = async (req, res) => {
  try {
    const { deviceId, port, slot, to, sms } = req.body;

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

    // Send SMS via device API
    const response = await fetch(`http://${device.ip}:${device.port}/api/sms/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        port: parseInt(port),
        slot: parseInt(slot),
        to: to,
        sms: Buffer.from(sms).toString('base64')
      })
    });

    if (!response.ok) {
      throw new Error(`Device responded with status: ${response.status}`);
    }

    const result = await response.json();

    // Save the outgoing message to database
    const message = await SimMessages.create({
      sim: sim._id,
      timestamp: new Date(),
      from: sim.phoneNumber || 'Unknown',
      to: to,
      sms: sms,
      rawSms: Buffer.from(sms).toString('base64'),
      isReport: false,
      read: true,
      direction: 'outbound',
      status: 'sent'
    });

    // Populate for response
    const populatedMessage = await SimMessages.findById(message._id)
      .populate({
        path: "sim",
        populate: { path: "device" }
      });

    res.status(201).json({ 
      code: 201, 
      success: true, 
      data: { message: populatedMessage } 
    });

  } catch (err) {
    console.error("Send SMS Error:", err);
    res.status(500).json({ 
      code: 500, 
      reason: "Failed to send SMS: " + err.message 
    });
  }
};

// ================== Create SMS ==================
exports.createSms = async (req, res) => {
  try {
    const { simId, from, to, sms, isReport = false, rawSms } = req.body;

    if (!simId || !sms) {
      return res.status(400).json({ code: 400, reason: "simId and sms are required" });
    }

    const sim = await Sim.findById(simId);
    if (!sim) {
      return res.status(404).json({ code: 404, reason: "SIM not found" });
    }

    let message = await SimMessages.create({
      sim: sim._id,
      timestamp: new Date(),
      from,
      to,
      sms,
      rawSms,
      isReport,
      read: false
    });

    // Populate sim + device for output
    message = await message.populate({
      path: "sim",
      populate: { path: "device" }
    });

    res.status(201).json({ code: 201, success: true, data: { message } });
  } catch (err) {
    console.error("CreateMessage Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to create SMS" });
  }
};



exports.markAsRead = async (req, res) => {
    try {
      const { messageId } = req.params;
  
      const message = await SimMessages.findByIdAndUpdate(
        messageId,
        { read: true },
        { new: true }
      );
  
      if (!message) {
        return res.status(404).json({ code: 404, reason: "Message not found" });
      }
  
      res.json({ code: 200, success: true, data: { message } });
    } catch (err) {
      console.error("MarkAsRead Error:", err);
      res.status(500).json({ code: 500, reason: "Failed to mark message as read" });
    }
  };
  

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
  

// Webhook (receive SMS / delivery report)
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
        sms
      } = msg;

      // 🔹 Identify Device by MAC
      let device = await Device.findOne({ mac });
      if (!device) {
        console.warn(`Device not found for MAC: ${mac}`);
        continue;
      }

      // 🔹 Find or create SIM
      let sim = await Sim.findOne({ device: device._id, port, slot });
      if (!sim) {
        sim = await Sim.create({ device: device._id, port, slot, iccid, imsi, imei });
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

      // 🔹 Save message
      let savedMessage = await SimMessages.create({
        sim: sim._id,
        timestamp: new Date(ts * 1000),
        from,
        to,
        read: false,
        isReport: is_report,
        sms: decodedSMS,
        rawSms: sms || null,
      });

      // 🔹 Populate sim + device for output
      savedMessage = await savedMessage.populate({
        path: "sim",
        populate: { path: "device" }
      });

      // 🔹 If report → update Contact
      if (is_report && from) {
        await Contact.findOneAndUpdate(
          { phoneNumber: from },
          { $set: { isReport: true, optedIn: false } }
        );
      }

      // 🔹 Emit populated message
      if (io) {
        io.to(`device:${device._id}`).emit("sms-received", savedMessage);
      }
    }

    res.status(201).json({ code: 201, success: true });
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to save SMS" });
  }
};

