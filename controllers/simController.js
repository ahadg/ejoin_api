const Sim = require("../models/Sim");
const Device = require("../models/Device");

// ================== Get All SIMs ==================
exports.getAllSims = async (req, res) => {
  try {
    const { 
      status, 
      deviceId, 
      carrier, 
      page = 1, 
      limit = 100,
      activeOnly = false 
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    if (deviceId) {
      filter.device = deviceId;
    }
    
    if (carrier) {
      filter.operator = new RegExp(carrier, 'i');
    }
    
    if (activeOnly === 'true') {
      filter.inserted = true;
      filter.status = 'active';
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { device: 1, port: 1 },
      populate: {
        path: 'device',
        select: 'name ipAddress location status'
      }
    };

    // Using pagination
    const sims = await Sim.find(filter)
      .populate('device', 'name ipAddress location status')
      .sort({ device: 1, port: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Sim.countDocuments(filter);

    return res.status(200).json({
      sims,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (err) {
    console.error("Error fetching SIMs:", err);
    return res.status(500).json({ 
      message: "Server error", 
      error: err.message 
    });
  }
};

// ================== Get SIMs by Device ==================
exports.getSimsByDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { status } = req.query;

    if (!deviceId) {
      return res.status(400).json({ message: "deviceId is required" });
    }

    const filter = { device: deviceId };
    
    if (status && status !== 'all') {
      filter.status = status;
    }

    const sims = await Sim.find(filter)
      .populate('device', 'name ipAddress location status')
      .sort({ port: 1 })
      .lean();

    return res.status(200).json({
      sims,
      total: sims.length
    });
  } catch (err) {
    console.error("Error fetching device SIMs:", err);
    return res.status(500).json({ 
      message: "Server error", 
      error: err.message 
    });
  }
};

// ================== Get SIM by ID ==================
exports.getSimById = async (req, res) => {
  try {
    const { simId } = req.params;

    const sim = await Sim.findById(simId)
      .populate('device', 'name ipAddress location status macAddress')
      .lean();

    if (!sim) {
      return res.status(404).json({ message: "SIM not found" });
    }

    return res.status(200).json(sim);
  } catch (err) {
    console.error("Error fetching SIM:", err);
    return res.status(500).json({ 
      message: "Server error", 
      error: err.message 
    });
  }
};

// ================== Update SIM Daily Limit ==================
exports.updateSimLimit = async (req, res) => {
  try {
    const { simId } = req.params;
    const { dailyLimit } = req.body;

    if (!dailyLimit || dailyLimit < 0) {
      return res.status(400).json({ 
        message: "Valid dailyLimit is required" 
      });
    }

    const sim = await Sim.findById(simId);
    
    if (!sim) {
      return res.status(404).json({ message: "SIM not found" });
    }

    // Update daily limit
    sim.dailyLimit = parseInt(dailyLimit);
    sim.lastUpdated = new Date();

    await sim.save();

    // Populate device info for response
    await sim.populate('device', 'name ipAddress location');

    return res.status(200).json({
      message: "SIM limit updated successfully",
      sim: {
        _id: sim._id,
        port: sim.port,
        phoneNumber: sim.phoneNumber,
        carrier: sim.operator,
        status: sim.status,
        inserted: sim.inserted,
        dailyLimit: sim.dailyLimit,
        todaySent: sim.todaySent,
        device: sim.device
      }
    });
  } catch (err) {
    console.error("Error updating SIM limit:", err);
    return res.status(500).json({ 
      message: "Server error", 
      error: err.message 
    });
  }
};

// ================== Bulk Update SIM Limits ==================
exports.bulkUpdateSimLimits = async (req, res) => {
  try {
    const { simIds, dailyLimit, filter } = req.body;
    console.log(req.body)
    if (!dailyLimit || dailyLimit < 0) {
      return res.status(400).json({ 
        message: "Valid dailyLimit is required" 
      });
    }
    if (simIds.length < 1) {
      return res.status(400).json({ 
        message: "Sim are not available" 
      });
    }

    let updateFilter = {};
    
    if (simIds && simIds.length > 0) {
      // Update specific SIMs by IDs
      updateFilter = { _id: { $in: simIds } };
    } else if (filter) {
      // Update SIMs based on filter criteria
      updateFilter = filter;
      
      if (filter.activeOnly) {
        updateFilter.inserted = true;
        updateFilter.status = 'active';
        delete updateFilter.activeOnly;
      }
    } else {
      return res.status(400).json({ 
        message: "Either simIds or filter is required" 
      });
    }

    const result = await Sim.updateMany(
      updateFilter,
      { 
        $set: { 
          dailyLimit: parseInt(dailyLimit),
          lastUpdated: new Date()
        } 
      }
    );

    // Get updated SIMs for response
    const updatedSims = await Sim.find(updateFilter)
      .populate('device', 'name ipAddress location')
      .lean();

    return res.status(200).json({
      message: `Updated ${result.modifiedCount} SIM cards`,
      modifiedCount: result.modifiedCount,
      sims: updatedSims
    });
  } catch (err) {
    console.error("Error bulk updating SIM limits:", err);
    return res.status(500).json({ 
      message: "Server error", 
      error: err.message 
    });
  }
};

// ================== Reset Daily Usage ==================
exports.resetDailyUsage = async (req, res) => {
  try {
    const { simIds, resetAll = false } = req.body;

    let updateFilter = {};
    
    if (!resetAll && simIds && simIds.length > 0) {
      updateFilter = { _id: { $in: simIds } };
    } else if (resetAll) {
      updateFilter = {}; // Reset all SIMs
    } else {
      return res.status(400).json({ 
        message: "Either simIds or resetAll is required" 
      });
    }

    const result = await Sim.updateMany(
      updateFilter,
      { 
        $set: { 
          todaySent: 0,
          lastResetDate: new Date(),
          lastUpdated: new Date()
        } 
      }
    );

    return res.status(200).json({
      message: `Reset daily usage for ${result.modifiedCount} SIM cards`,
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    console.error("Error resetting daily usage:", err);
    return res.status(500).json({ 
      message: "Server error", 
      error: err.message 
    });
  }
};

// ================== Get USSD Commands by Device & Port ==================
exports.getUssdCommands = async (req, res) => {
  try {
    const { deviceId, port } = req.params;

    if (!deviceId || !port) {
      return res.status(400).json({ 
        message: "deviceId and port are required" 
      });
    }

    const sim = await Sim.findOne({ 
      device: deviceId, 
      port: parseInt(port) 
    })
    .populate("device", "name macAddress")
    .lean();

    if (!sim) {
      return res.status(404).json({ 
        message: "SIM not found for given device and port" 
      });
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
    return res.status(500).json({ 
      message: "Server error", 
      error: err.message 
    });
  }
};