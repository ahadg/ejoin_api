// models/SMSMessage.js
const mongoose = require("mongoose");

const smsMessageSchema = new mongoose.Schema({
  sim: { type: mongoose.Schema.Types.ObjectId, ref: "Sim", required: true },
  timestamp: { type: Date, required: true },
  sender: { type: String },
  receiver: { type: String },
  isReport: { type: Boolean, default: false },
  content: { type: String, required: true },      // decoded SMS
  rawContent: { type: String },                   // Base64/raw
}, { timestamps: true });

module.exports = mongoose.model("SMSMessage", smsMessageSchema);
