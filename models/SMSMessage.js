// models/SMSMessage.js
const mongoose = require("mongoose");

const smsMessageSchema = new mongoose.Schema({
  sim: { type: mongoose.Schema.Types.ObjectId, ref: "Sim", required: true },
  timestamp: { type: Date, required: true },
  from: { type: String },
  to: { type: String },
  isReport: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  sms: { type: String, default: "" },      // decoded SMS
  rawSms: { type: String },                   // Base64/raw
}, { timestamps: true });

module.exports = mongoose.model("SMSMessage", smsMessageSchema);
