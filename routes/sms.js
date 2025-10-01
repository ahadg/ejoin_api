// routes/sms.js
const express = require("express");
const router = express.Router();
const Device = require("../models/Device");
const Sim = require("../models/Sim");
const SMSMessage = require("../models/SMSMessage");

// GET /api/sms
router.get("/", async (req, res) => {
    try {
      const { simId, deviceId, limit = 50 } = req.query;
      const query = {};
  
      if (simId) query.sim = simId;
      if (deviceId) query.device = deviceId; // we’d need to join via Sim.populate
  
      const messages = await SMSMessage.find(query)
        .populate("sim")
        .sort({ timestamp: -1 })
        .limit(Number(limit));
  
      res.json(messages);
    } catch (err) {
      console.error("Fetch SMS Error:", err);
      res.status(500).json({ error: "Failed to fetch SMS" });
    }
  });
  

// POST /api/sms/webhook
router.post("/webhook", async (req, res) => {
  try {
    const messages = Array.isArray(req.body) ? req.body : [req.body];

    for (const msg of messages) {
      const { port, slot, timestamp, from, to, is_report, sms } = msg;

      // TODO: determine device_id (maybe via auth token, IP, or req.header)
      const device = await Device.findOne(); // Placeholder, replace with actual logic

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
        sender: from,
        receiver: to,
        isReport: is_report,
        content: decodedSMS,
        rawContent: sms,
      });
    }

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).json({ error: "Failed to save SMS" });
  }
});

module.exports = router;
