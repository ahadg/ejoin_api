// models/Device.js
const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  ipAddress: {
    type: String,
    required: true
  },
  macAddress: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  totalSlots: {
    type: Number,
    default: 512
  },
  activeSlots: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'warning'],
    default: 'offline'
  },
  temperature: {
    type: Number,
    default: 0
  },
  uptime: {
    type: String,
    default: '0 days, 0 hours'
  },
  dailySent: {
    type: Number,
    default: 0
  },
  dailyLimit: {
    type: Number,
    default: 15000
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  firmwareVersion: String,
  maxPorts: Number,
  maxSlots: Number,
  password: String,
  port: String,
  username: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Device', deviceSchema);