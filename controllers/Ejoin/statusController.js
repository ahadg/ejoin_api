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
    console.log("getStatus_data", data);
    
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
async function processDeviceStatus(statusData,the_device) {
  try {
    // Extract device information
    const { mac, ip, ver, 'max-ports': maxPorts, 'max-slot': maxSlots, status } = statusData;
    
    console.log(`Processing device status for MAC: ${mac}, IP: ${ip}`);
    
    // Update device status in database
    const activeSlots = status.filter(port => port.inserted === 1 && port.slot_active === 1).length;
    
    // Find device by IP or MAC and update its status
    const device = await Device.findOneAndUpdate(
      { $or: [{ _id: the_device?._id }, { password: the_device?.password }] },
      {
        macAddress: mac,
        //ipAddress: ip,
        firmwareVersion: ver,
        maxPorts: maxPorts,
        maxSlots: maxSlots,
        status: 'online',
        activeSlots: activeSlots,
        lastSeen: new Date(),
        updatedAt: new Date()
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true 
      }
    );
    
    if (!device) {
      console.error('Error updating device status: Device not found');
      return;
    }
    
    console.log(`Device status updated successfully for ${mac}`);
    
    // Process each port status
    for (const portStatus of status) {
      await processPortStatus({
        ...portStatus,
        type: 'port-status',
        mac: statusData.mac,
        ip: statusData.ip,
        deviceId: device._id
      });
    }
    
  } catch (error) {
    console.error('Error processing device status:', error);
  }
}

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
    
    //console.log(`Processing port status for port ${portId}, status: ${statusCode}`);
    
    // Parse port and slot from portId (format like "1.01", "2.01", etc.)
    const [portNumber, slotNumber] = portId.split('.').map(Number);
    
    // Get device ID if not provided
    let deviceObjectId = deviceId;
    if (!deviceObjectId) {
      const device = await Device.findOne({ $or: [{ ipAddress: ip }, { macAddress: mac }] });
      if (!device) {
        console.error(`Device not found for IP: ${ip}, MAC: ${mac}`);
        return;
      }
      deviceObjectId = device._id;
    }
    
    // Get SIM status from status code
    const simStatus = getSIMStatus(statusCode);
    
    // Only create/update SIM record if SIM is inserted and active
    if (inserted === 1 && slot_active === 1) {
      // Update or create SIM card record in database
      const simData = {
        device: deviceObjectId,
        portNumber: portId,
        port: portNumber,
        slot: slotNumber,
        status: simStatus,
        statusCode: statusCode,
        imei: imei,
        inserted: inserted === 1,
        slotActive: slot_active === 1,
        ledEnabled: led === 1,
        networkType: network,
        lastUpdated: new Date()
      };
      
      // Only add these fields if they exist (for active SIMs)
      if (imsi) simData.imsi = imsi;
      if (iccid) simData.iccid = iccid;
      if (sn) simData.phoneNumber = sn;
      if (opr) simData.operator = opr;
      if (bal) simData.balance = bal;
      if (sig) simData.signalStrength = sig;
      
      const simCard = await Sim.findOneAndUpdate(
        { device: deviceObjectId, port : portNumber, slot :slotNumber  },
        simData,
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true 
        }
      );
      
      console.log(`Port ${portId} status updated successfully`);
    } else {
      // SIM is not inserted or not active, remove it if it exists
      // await Sim.deleteOne({ 
      //   device: deviceObjectId, 
      //   port: portId 
      // });
      console.log(`Port ${portId} - SIM not inserted or inactive, removed from database`);
    }
    
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