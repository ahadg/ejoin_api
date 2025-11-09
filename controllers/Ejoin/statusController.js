// controllers/statusController.js
const Device = require('../../models/Device');
const Sim = require('../../models/Sim');
const DeviceClient = require('../../services/deviceClient');

exports.getStatus = async (req, res) => {
  try {
    console.log("getStatus called", req.device);
    const { ipAddress, port, period, all_sims, all_slots, username, password } = req.device;
    
    if (!ipAddress) {
      return res.status(400).json({
        code: 400,
        reason: 'Device IP is required'
      });
    }

    const client = new DeviceClient(req.device);
  
    // Get current status with additional parameters
    const params = {username, password};
    
    const data = await client.getStatus(params);
    //console.log("getStatus_data", data);
    
    // Process device and SIM data in database
    if(data) {
      processDeviceStatus(data,req.device);
    }
    res.json(data);
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

exports.statusNotification = async (req, res) => {
  try {
    // Handle status notifications from the device
    const notificationData = req.body;
    console.log('Status notification received:', notificationData);
    
    // Process the notification based on type
    if (notificationData.type === 'dev-status') {
      // Handle periodic device status update
      await processDeviceStatus(notificationData);
    } else if (notificationData.type === 'port-status') {
      // Handle port status change notification
      await processPortStatus(notificationData);
    }
    
    res.json({
      code: 200,
      reason: 'OK'
    });
  } catch (error) {
    console.error('Status notification error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

// Helper functions to process status notifications
// ==================== Process Device Status ====================
async function processDeviceStatus(statusData, the_device) {
  try {
    const { mac, ip, ver, 'max-ports': maxPorts, 'max-slot': maxSlots, status } = statusData;
    console.log(`Processing device status for MAC: ${mac}, IP: ${ip}`);

    // Count active slots
    const activeSlots = status.filter(port => port.inserted === 1 && port.slot_active === 1).length;

    // Update device info
    const device = await Device.findOneAndUpdate(
      { $or: [{ macAddress: mac }, { password: the_device?.password }] },
      {
        macAddress: mac,
        firmwareVersion: ver,
        maxPorts,
        maxSlots,
        status: 'online',
        activeSlots,
        lastSeen: new Date(),
        updatedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!device) {
      console.error('Error updating device status: Device not found');
      return;
    }

    console.log(`Device status updated successfully for ${mac}`);

    // Process all ports (not just active)
    for (const portStatus of status) {
      await processPortStatus({
        ...portStatus,
        type: 'port-status',
        mac,
        ip,
        deviceId: device._id
      });
    }
  } catch (error) {
    console.error('Error processing device status:', error);
  }
}

// ==================== Process Port Status ====================
async function processPortStatus(portData) {
  try {
    const {
      port: portId,
      st: statusCode,
      bal,
      opr,
      sn,
      imei,
      imsi,
      iccid,
      inserted,
      slot_active,
      sig,
      led,
      network,
      mac,
      ip,
      deviceId
    } = portData;

    const [portNumber, slotNumber] = portId.split('.').map(Number);

    // Get device ID if not passed
    let deviceObjectId = deviceId;
    if (!deviceObjectId) {
      const device = await Device.findOne({ $or: [{ ipAddress: ip }, { macAddress: mac }] });
      if (!device) {
        console.error(`Device not found for IP: ${ip}, MAC: ${mac}`);
        return;
      }
      deviceObjectId = device._id;
    }

    const simStatus = getSIMStatus(statusCode);

    // Build update data (always update existing SIMs)
    const simData = {
      device: deviceObjectId,
      portNumber: portId,
      port: portNumber,
      slot: slotNumber,
      status: simStatus,
      statusCode,
      imei,
      inserted: inserted === 1,
      slotActive: slot_active === 1,
      ledEnabled: led === 1,
      networkType: network,
      lastUpdated: new Date(),
    };

    // Optional fields
    if (imsi) simData.imsi = imsi;
    if (iccid) simData.iccid = iccid;
    if (sn) simData.phoneNumber = sn;
    if (opr) simData.operator = opr;
    if (bal) simData.balance = bal;
    if (sig) simData.signalStrength = sig;

    // Update existing SIM or create new one
    const simCard = await Sim.findOneAndUpdate(
      { device: deviceObjectId,
        port: portNumber, 
      //  slot: slotNumber 
      },
      {
        $set: simData,
        $setOnInsert: {
          dailyLimit: 300,
          dailySent: 0,
          todaySent: 0,
          lastResetDate: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`Port ${portId} status updated: ${simCard.inserted ? 'Active' : 'Inactive'}`);
  } catch (error) {
    console.error('Error processing port status:', error);
  }
}


// Helper function to determine SIM status from status code
function getSIMStatus(statusCode) {
  if (typeof statusCode === 'number') {
    if (statusCode === 3 || statusCode === 4 || statusCode === 15) return "active";
    if (statusCode === 0 || statusCode === 1 || statusCode === 11) return "inactive";
    return "error";
  }
  return "unknown";
}

const setStatusReportServer = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const { enable, url, period } = req.body;
    
    if (!url) {
      return res.status(400).json({
        code: 400,
        reason: 'URL is required'
      });
    }

    const client = new DeviceClient(device);
    const result = await client.setStatusReportServer({
      enable: enable !== undefined ? enable : true,
      url: url,
      period: period || 60
    });
    console.log("result",result)
    res.json(result);
  } catch (error) {
    console.error('Set status report server error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

const getStatusReportServer = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }


    const client = new DeviceClient(device);
    const result = await client.getStatusReportServer();
    
    res.json(result);
  } catch (error) {
    console.error('Set status report server error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

module.exports = {
  getStatus: exports.getStatus,
  statusNotification: exports.statusNotification,
  processDeviceStatus,
  processPortStatus,
  setStatusReportServer,
  getStatusReportServer
};