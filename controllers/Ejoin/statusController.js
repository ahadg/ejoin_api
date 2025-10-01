// controllers/statusController.js
const DeviceClient = require('../../services/deviceClient');

exports.getStatus = async (req, res) => {
  try {
    console.log("getStatus called",req.device);
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
    if (all_sims) params.all_sims = parseInt(all_sims);
    if (all_slots) params.all_slots = parseInt(all_slots);
    
    const data = await client.getStatus(params);
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
async function processDeviceStatus(statusData) {
  try {
    // Extract device information
    const { mac, ip, 'max-ports': maxPorts, 'max-slots': maxSlots, status } = statusData;
    
    console.log(`Processing device status for MAC: ${mac}, IP: ${ip}`);
    
    // Update device status in database
    // This would typically update the device record with the new status information
    const activeSlots = status.filter(port => port.inserted === 1 && port.slot_active === 1).length;
    
    // Find device by IP or MAC and update its status
    const { data: device, error } = await supabase
      .from('devices')
      .update({
        status: 'online',
        active_slots: activeSlots,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .or(`ip_address.eq.${ip},mac.eq.${mac}`)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating device status:', error);
      return;
    }
    
    // Process each port status
    for (const portStatus of status) {
      await processPortStatus({
        ...portStatus,
        type: 'port-status',
        mac: statusData.mac,
        ip: statusData.ip
      });
    }
    
    console.log(`Device status updated successfully for ${mac}`);
  } catch (error) {
    console.error('Error processing device status:', error);
  }
}

async function processPortStatus(portData) {
  try {
    const { port: portId, status: statusCode, bal, opr, sn, imei, imsi, iccid, 
            inserted, slot_active, sig, led, mac, ip } = portData;
    
    console.log(`Processing port status for port ${portId}, status: ${statusCode}`);
    
    // Parse port and slot from portId (format like "1A", "2B", etc.)
    const portNumber = parseInt(portId.match(/\d+/)[0]);
    const slotLetter = portId.match(/[A-Z]/)[0];
    const slotNumber = slotLetter.charCodeAt(0) - 64; // Convert A=1, B=2, etc.
    
    // Get SIM status from status code
    const simStatus = getSIMStatus(statusCode);
    
    // Update or create SIM card record in database
    const { data: simCard, error } = await supabase
      .from('sim_cards')
      .upsert({
        device_mac: mac,
        device_ip: ip,
        port: portNumber,
        slot: slotNumber,
        status: simStatus,
        status_code: statusCode,
        balance: bal,
        operator: opr,
        phone_number: sn,
        imei: imei,
        imsi: imsi,
        iccid: iccid,
        inserted: inserted === 1,
        slot_active: slot_active === 1,
        signal_strength: sig,
        led_enabled: led === 1,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'device_mac,port,slot'
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error updating SIM card status:', error);
      return;
    }
    
    console.log(`Port ${portId} status updated successfully`);
  } catch (error) {
    console.error('Error processing port status:', error);
  }
}

// Helper function to determine SIM status from status code
function getSIMStatus(statusCode) {
  if (typeof statusCode === 'string') {
    const code = parseInt(statusCode.split(' ')[0]);
    
    if (code === 3 || code === 4 || code === 15) return "active";
    if (code === 0 || code === 1 || code === 11) return "inactive";
    return "error";
  }
  return "unknown";
}