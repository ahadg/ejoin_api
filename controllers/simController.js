// controllers/simController.js
const Sim = require("../models/Sim");

// ================== Get USSD Commands by Device & Port ==================
exports.getUssdCommands = async (req, res) => {
  try {
    const { deviceId, port } = req.params;

    if (!deviceId || !port) {
      return res.status(400).json({ message: "deviceId and port are required" });
    }

    // Find SIM by deviceId + port
    const sim = await Sim.findOne({ device: deviceId, port: port })
      .populate("device", "name macAddress") // optional: populate device details
      .lean();

    if (!sim) {
      return res.status(404).json({ message: "SIM not found for given device and port" });
    }

    return res.status(200).json({
      simId: sim._id,
      device: sim.device,
      port: sim.port,
      phoneNumber: sim.phoneNumber,
      ussdCommands: sim.ussdCommands || []
    });
  } catch (err) {
    console.error("Error fetching USSD commands:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};
