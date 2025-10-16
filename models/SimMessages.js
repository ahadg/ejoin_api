// models/SimMessages.js - Updated schema
const mongoose = require("mongoose");

const simMessagesSchema = new mongoose.Schema({
  sim: { type: mongoose.Schema.Types.ObjectId, ref: "Sim", required: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" }, // New field
  timestamp: { type: Date, required: true },
  from: { type: String },
  to: { type: String },
  isReport: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  sms: { type: String, default: "" },
  rawSms: { type: String },
  clientNumber: { type: String }, // Easier reporting and filtering
  direction: { 
    type: String, 
    enum: ["inbound", "outbound"], 
    default: "inbound" 
  },
  status: { 
    type: String, 
    //enum: ["sent", "delivered", "read", "replied", "failed"], 
    default: "sent" 
  }
}, { timestamps: true });

module.exports = mongoose.model("SimMessages", simMessagesSchema);