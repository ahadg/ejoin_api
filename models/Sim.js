// models/Sim.js
const mongoose = require("mongoose");

const simSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: "Device", required: true },
  port: { type: Number, required: true },
  slot: { type: Number, required: true },
  phoneNumber: { type: String },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
}, { timestamps: true });

// Unique index for (device, port, slot)
simSchema.index({ device: 1, port: 1, slot: 1 }, { unique: true });

module.exports = mongoose.model("Sim", simSchema);
