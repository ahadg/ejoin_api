const DeviceClient = require('../services/deviceClient');

exports.sendSms = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const body = req.body;
    
    // Validate required fields based on new documentation
    if (!body || !Array.isArray(body)) {
      return res.status(400).json({
        code: 400,
        reason: 'Request body must be an array of tasks'
      });
    }
    console.log("v1")
    // Validate each task
    for (const task of body) {
      if (!task.id) {
        return res.status(400).json({
          code: 400,
          reason: 'Task ID is required for each task'
        });
      }
      if (!task.recipients || !Array.isArray(task.recipients) || task.recipients.length === 0) {
        return res.status(400).json({
          code: 400,
          reason: 'Recipients array is required for each task'
        });
      }
      if (!task.sms) {
        return res.status(400).json({
          code: 400,
          reason: 'SMS content is required for each task'
        });
      }
    }
    console.log("v2")
    const client = new DeviceClient(device);
    const result = await client.sendSms(body);
    res.json(result);
  } catch (error) {
    console.error('SMS send error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

exports.pauseSms = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid IDs format - must be an array'
      });
    }
    
    const client = new DeviceClient(device);
    const result = await client.pauseSms(ids);
    res.json(result);
  } catch (error) {
    console.error('SMS pause error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

exports.resumeSms = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid IDs format - must be an array'
      });
    }
    
    const client = new DeviceClient(device);
    const result = await client.resumeSms(ids);
    res.json(result);
  } catch (error) {
    console.error('SMS resume error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

exports.removeSms = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid IDs format - must be an array'
      });
    }
    
    const client = new DeviceClient(device);
    const result = await client.removeSms(ids);
    res.json(result);
  } catch (error) {
    console.error('SMS remove error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

exports.getTasks = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const { port, index, num, need_content } = req.body;
    
    if (!port) {
      return res.status(400).json({
        code: 400,
        reason: 'Port number is required'
      });
    }

    const client = new DeviceClient(device);
    const result = await client.getTasks(port, index, num, need_content);
    res.json(result);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

exports.getSms = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const { sms_id, sms_num, sms_del } = req.query;

    const client = new DeviceClient(device);
    const result = await client.getSms(sms_id, sms_num, sms_del);
    res.json(result);
  } catch (error) {
    console.error('Get SMS error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

exports.getSmsConfig = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const client = new DeviceClient(device);
    const result = await client.getSmsConfig();
    res.json(result);
  } catch (error) {
    console.error('Get SMS config error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

exports.setSmsConfig = async (req, res) => {
  try {
    const device = req.device;
    if (!device) {
      return res.status(400).json({
        code: 400,
        reason: 'Device Id is required'
      });
    }

    const config = req.body;
    
    if (!config) {
      return res.status(400).json({
        code: 400,
        reason: 'Configuration object is required'
      });
    }

    const client = new DeviceClient(device);
    const result = await client.setSmsConfig(config);
    res.json(result);
  } catch (error) {
    console.error('Set SMS config error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};