const Device = require("../models/Device");
const Sim = require("../models/Sim");
const SMSMessage = require("../models/SMSMessage");
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
      let savedMessage = await SMSMessage.create({
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

