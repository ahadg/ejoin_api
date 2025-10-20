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
  
  // DAILY LIMIT FIELDS
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

// Compound index for unique device + port combination
simSchema.index({ device: 1, port: 1 }, { unique: true });

// Index for efficient querying
simSchema.index({ status: 1 });
simSchema.index({ inserted: 1 });
simSchema.index({ device: 1 });
simSchema.index({ operator: 1 });

// Virtual for usage percentage
simSchema.virtual('usagePercentage').get(function() {
  return this.dailyLimit > 0 ? (this.todaySent / this.dailyLimit) * 100 : 0;
});

// Method to check if daily limit is exceeded
simSchema.methods.isLimitExceeded = function() {
  return this.todaySent >= this.dailyLimit;
};

// Method to increment today's sent count
simSchema.methods.incrementSentCount = function() {
  this.todaySent += 1;
  this.lastUpdated = new Date();
  return this.save();
};

// Static method to reset all daily usage
simSchema.statics.resetAllDailyUsage = function() {
  return this.updateMany(
    {},
    { 
      $set: { 
        todaySent: 0,
        lastResetDate: new Date() 
      } 
    }
  );
};

module.exports = mongoose.model("Sim", simSchema);