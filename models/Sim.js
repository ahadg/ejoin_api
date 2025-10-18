// models/Sim.js
const mongoose = require("mongoose");

const ussdCommandSchema = new mongoose.Schema({
  command: { type: String, required: true },
  response: { type: String },
  status: { 
    type: String, 
    enum: ["pending", "success", "error", "timeout"], 
    default: "pending" 
  },
  timestamp: { type: Date, default: Date.now },
  error: { type: String }
});

const simSchema = new mongoose.Schema({
  device: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Device", 
    required: true 
  },
  portNumber: { 
    type: String, 
  },
  port: { 
    type: Number, 
    required: true 
  },
  slot: { 
    type: Number, 
    required: true 
  },
  phoneNumber: { 
    type: String 
  },
  status: { 
    type: String, 
    enum: ["active", "inactive", "error", "unknown"], 
    default: "inactive" 
  },
  statusCode: { 
    type: Number 
  },
  imei: { 
    type: String 
  },
  imsi: { 
    type: String 
  },
  iccid: { 
    type: String 
  },
  operator: { 
    type: String 
  },
  balance: { 
    type: String 
  },
  signalStrength: { 
    type: Number 
  },
  networkType: { 
    type: Number 
  },
  inserted: { 
    type: Boolean, 
    default: false 
  },
  slotActive: { 
    type: Boolean, 
    default: false 
  },
  ledEnabled: { 
    type: Boolean, 
    default: false 
  },
  // NEW FIELDS FOR DAILY LIMIT
  dailyLimit: { 
    type: Number, 
    default: 300 
  },
  dailySent: { 
    type: Number, 
    default: 0 
  },
  todaySent: { 
    type: Number, 
    default: 0 
  },
  lastResetDate: { 
    type: Date, 
    default: Date.now 
  },
  ussdCommands: [ussdCommandSchema],
  lastUpdated: { 
    type: Date, 
    default: Date.now 
  }
}, { 
  timestamps: true 
});

// Unique index for (device, port)
simSchema.index({ device: 1, port: 1 }, { unique: true });

module.exports = mongoose.model("Sim", simSchema);