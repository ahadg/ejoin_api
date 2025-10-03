const express = require('express');
const router = express.Router();
const DeviceClient = require('../../services/deviceClient');
const Sim = require('../../models/Sim');

router.post('/sendUSSD', async (req, res) => {
    try {
      console.log("sendUSSD called", req.body);
  
      const client = new DeviceClient(req.device);
      const data = await client.sendUSSD(req.body);
      console.log("sendUSSD_data", data);
      
      // Save USSD commands and responses to database
      if (data && Array.isArray(data)) {
        try {
          await saveUSSDCommandsToDB(req.device.id, data, req.body?.[0]?.ussd);
        } catch (dbError) {
          console.error('Error saving USSD commands to database:', dbError);
          // Don't fail the request if DB save fails, just log it
        }
      }
      
      res.json(data);
    } catch (error) {
      console.error('USSD error:', error);
      
      // Save error to database as well
      try {
        await saveUSSDErrorToDB(req.device.id, req.body.ports, req.body.ussd, error.message);
      } catch (dbError) {
        console.error('Error saving USSD error to database:', dbError);
      }
      
      res.status(500).json({
        code: 500,
        reason: error.message
      });
    }
  });
  
  // Helper function to save successful USSD commands
  async function saveUSSDCommandsToDB(deviceId, ussdResults, originalCommand) {

    for (const result of ussdResults) {
      try {
        const { port, code, resp } = result;
        
        // Find the SIM by device and port
        const sim = await Sim.findOne({ 
          device: deviceId, 
          port: port 
        });
  
        if (!sim) {
          console.warn(`SIM not found for device ${deviceId}, port ${port}`);
          continue;
        }
  
        // Create USSD command object
        const ussdCommand = {
          command: originalCommand,
          response: resp || '',
          status: code === 0 ? 'success' : 'error',
          timestamp: new Date(),
          error: code !== 0 ? `Error code: ${code}` : undefined
        };
  
        // Initialize ussdCommands array if it doesn't exist
        if (!sim.ussdCommands) {
          sim.ussdCommands = [];
        }
  
        // Add new USSD command to history
        sim.ussdCommands.unshift(ussdCommand);
  
        // Keep only last 50 commands to prevent unbounded growth
        if (sim.ussdCommands.length > 50) {
          sim.ussdCommands = sim.ussdCommands.slice(0, 50);
        }
  
        // Update lastUpdated field
        sim.lastUpdated = new Date();
  
        await sim.save();
        console.log(`Saved USSD command for device ${deviceId}, port ${port}`);
        
      } catch (error) {
        console.error(`Error saving USSD command for port ${result.port}:`, error);
      }
    }
  }
  
  // Helper function to save USSD errors
  async function saveUSSDErrorToDB(deviceId, ports, command, errorMessage) {

    if (!ports || !Array.isArray(ports)) {
      console.warn('No ports provided for error saving');
      return;
    }
  
    for (const port of ports) {
      try {
        // Find the SIM by device and port
        const sim = await Sim.findOne({ 
          device: deviceId, 
          port: port 
        });
  
        if (!sim) {
          console.warn(`SIM not found for device ${deviceId}, port ${port}`);
          continue;
        }
  
        // Create USSD command object with error
        const ussdCommand = {
          command: command,
          response: '',
          status: 'error',
          timestamp: new Date(),
          error: errorMessage
        };
  
        // Initialize ussdCommands array if it doesn't exist
        if (!sim.ussdCommands) {
          sim.ussdCommands = [];
        }
  
        // Add error to history
        sim.ussdCommands.unshift(ussdCommand);
  
        // Keep only last 50 commands
        if (sim.ussdCommands.length > 50) {
          sim.ussdCommands = sim.ussdCommands.slice(0, 50);
        }
  
        // Update lastUpdated field
        sim.lastUpdated = new Date();
  
        await sim.save();
        console.log(`Saved USSD error for device ${deviceId}, port ${port}`);
        
      } catch (error) {
        console.error(`Error saving USSD error for port ${port}:`, error);
      }
    }
  }

module.exports = router;