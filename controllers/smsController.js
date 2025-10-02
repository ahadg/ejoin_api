const Device = require("../models/Device");
const Sim = require("../models/Sim");
const SMSMessage = require("../models/SMSMessage");
const { syncDeviceSms } = require("../utils/helpers");

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

    const messages = await SMSMessage.find(query)
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


exports.markAsRead = async (req, res) => {
    try {
      const { messageId } = req.params;
  
      const message = await SMSMessage.findByIdAndUpdate(
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
  

// ================== Webhook ==================
exports.webhookSMS = async (req, res) => {
  try {
    const messages = Array.isArray(req.body) ? req.body : [req.body];

    for (const msg of messages) {
      const { port, slot, timestamp, from, to, is_report, sms } = msg;

      // TODO: identify device (via auth, token, IP, or headers)
      const device = await Device.findOne(); // placeholder

      if (!device) {
        console.warn("Device not found for webhook message");
        continue;
      }

      // Find or create SIM
      let sim = await Sim.findOne({ device: device._id, port, slot });
      if (!sim) {
        sim = await Sim.create({ device: device._id, port, slot });
      }

      // Decode Base64
      const decodedSMS = Buffer.from(sms, "base64").toString("utf-8");

      // Save message
      await SMSMessage.create({
        sim: sim._id,
        timestamp: new Date(timestamp * 1000), // epoch → Date
        from: from,
        to: to,
        read : false,
        isReport: is_report,
        sms: decodedSMS,
        rawSms: sms,
      });
    }

    res.status(201).json({ code: 201, success: true });
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).json({ code: 500, reason: "Failed to save SMS" });
  }
};
