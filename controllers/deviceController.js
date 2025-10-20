const deviceModel = require('../models/Device');
const DeviceClient = require('../services/deviceClient');
const { syncDeviceSms } = require('../utils/helpers');
const { processDeviceStatus } = require('./Ejoin/statusController');

// Get all devices for user
exports.getDevices = async (req, res) => {
  try {
    const devices = await deviceModel.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ code: 200, data: { devices } });
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching devices' });
  }
};

// Get device by ID
exports.getDeviceById = async (req, res) => {
  try {
    const device = await deviceModel.findOne({ _id: req.params.id, user: req.user._id });
    if (!device) {
      return res.status(404).json({ code: 404, reason: 'Device not found' });
    }
    res.json({ code: 200, data: { device } });
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching device' });
  }
};

// Create new device
exports.createDevice = async (req, res) => {
  try {
    const { name, ipAddress, location, totalSlots, dailyLimit, password, port, username } = req.body;
    console.log("/devices/create", req.body);

    const client = new DeviceClient({ipAddress: ipAddress, port: port, username: username, password: password});
  
    // Get current status with additional parameters
    const params = {username: username, password: password};
    
    const data = await client.getStatus(params);
    console.log("getStatus_data", data);
    let device = null;
    // Process device and SIM data in database
    if(data?.reason != 'invalid username or password!') {
      device = new deviceModel({
        name,
        ipAddress,
        location,
        totalSlots : data['max-ports'],
        dailyLimit,
        password,
        port,
        username,
        user: req.user._id,
        macAddress: data.mac,
        maxPorts: data['max-ports'],
        maxSlots: data['max-slot'],
        firmwareVersion: data.ver,
        status: "online",
        activeSlots: data.status.filter(port => port.inserted === 1 && port.slot_active === 1).length,
        lastSeen: new Date(),
        updatedAt: new Date()
        //...data
      });
  
      // Fire and forget sync
      //syncDeviceSms(device);
  
      await device.save();
      processDeviceStatus(data,device);
    } else {
      return res.status(500).json({ code: 500, reason: 'invalid username or password!' });
    }

    res.status(201).json({ code: 201, message: 'Device created successfully', device });
  } catch (error) {
    console.error('Create device error:', error);
    res.status(500).json({ code: 500, reason: 'Error creating device' });
  }
};

// Update device
exports.updateDevice = async (req, res) => {
  try {
    const device = await deviceModel.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!device) {
      return res.status(404).json({ code: 404, reason: 'Device not found' });
    }

    res.json({ code: 200, message: 'Device updated successfully', data: { device } });
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ code: 500, reason: 'Error updating device' });
  }
};

// Delete device
exports.deleteDevice = async (req, res) => {
  try {
    const device = await deviceModel.findOneAndDelete({ _id: req.params.id, user: req.user._id });

    if (!device) {
      return res.status(404).json({ code: 404, reason: 'Device not found' });
    }

    res.json({ code: 200, message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ code: 500, reason: 'Error deleting device' });
  }
};

// Update device status
exports.updateDeviceStatus = async (req, res) => {
  try {
    const { status, temperature, uptime, lastSeen } = req.body;

    if (status && !['online', 'offline', 'warning'].includes(status)) {
      return res.status(400).json({ code: 400, reason: 'Invalid status. Must be online, offline, or warning' });
    }

    const updateData = { updatedAt: new Date() };
    if (status) updateData.status = status;
    if (temperature !== undefined) updateData.temperature = temperature;
    if (uptime) updateData.uptime = uptime;
    if (lastSeen) updateData.lastSeen = lastSeen;

    const device = await deviceModel.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      updateData,
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ code: 404, reason: 'Device not found' });
    }

    res.json({ code: 200, message: 'Device status updated successfully', data: { device } });
  } catch (error) {
    console.error('Update device status error:', error);
    res.status(500).json({ code: 500, reason: 'Error updating device status' });
  }
};

// Update device statistics
exports.updateDeviceStats = async (req, res) => {
  try {
    const { activeSlots, dailySent } = req.body;

    const updateData = { updatedAt: new Date() };
    if (activeSlots !== undefined) updateData.activeSlots = activeSlots;
    if (dailySent !== undefined) updateData.dailySent = dailySent;

    const device = await deviceModel.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      updateData,
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ code: 404, reason: 'Device not found' });
    }

    res.json({ code: 200, message: 'Device stats updated successfully', data: { device } });
  } catch (error) {
    console.error('Update device stats error:', error);
    res.status(500).json({ code: 500, reason: 'Error updating device stats' });
  }
};

// Reset daily sent count
exports.resetDailyCount = async (req, res) => {
  try {
    const device = await deviceModel.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { dailySent: 0, updatedAt: new Date() },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ code: 404, reason: 'Device not found' });
    }

    res.json({ code: 200, message: 'Daily count reset successfully', data: { device } });
  } catch (error) {
    console.error('Reset daily count error:', error);
    res.status(500).json({ code: 500, reason: 'Error resetting daily count' });
  }
};
