const Sim = require("../models/Sim");
const SMSMessage = require("../models/SMSMessage");
const DeviceClient = require("../services/deviceClient");

// Helper function: sync SMS from device into DB
exports.syncDeviceSms = async (device) => {
  const client = new DeviceClient(device);

  // call device API to fetch SMS (your device returns { smses: [] })
  const result = await client.getSms();
  const smses = result?.smses || [];

  for (const msg of smses) {
    const { port, slot, timestamp, from, to, is_report, sms } = msg;

    // find/create SIM
    let sim = await Sim.findOne({ device: device._id, port, slot });
    if (!sim) {
      sim = await Sim.create({ device: device._id, port, slot });
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
    const exists = await SMSMessage.findOne({
      sim: sim._id,
      timestamp: new Date(timestamp * 1000),
      from: from,
    });

    if (!exists) {
      await SMSMessage.create({
        sim: sim._id,
        timestamp: new Date(timestamp * 1000),
        from: from,
        to: to,
        isReport: is_report,
        sms: decodedSMS,
        rawSms: sms || null,
      });
    }
  }

  return smses.length;
};
