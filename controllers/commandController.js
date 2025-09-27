const DeviceClient = require('../services/deviceClient');

exports.sendCommand = async (req, res) => {
  try {
    const { device_ip, device_port, op, version } = req.query;
    const body = req.body;
    
    if (!device_ip) {
      return res.status(400).json({
        code: 400,
        reason: 'Device IP is required'
      });
    }

    const client = new DeviceClient(device_ip, device_port || 80);
    
    // Handle different operation types
    switch (op) {
      case 'get':
        return handleGetCommand(req, res, client);
      case 'set':
        return handleSetCommand(req, res, client);
      case 'lock':
      case 'unlock':
      case 'switch':
      case 'reset':
      case 'save':
      case 'reboot':
      case 'ledon':
      case 'ledoff':
      case 'multiple':
        return handlePortCommand(req, res, client, op);
      default:
        return res.status(400).json({
          code: 400,
          reason: 'Invalid operation'
        });
    }
  } catch (error) {
    console.error('Command error:', error);
    res.status(500).json({
      code: 500,
      reason: error.message
    });
  }
};

async function handleGetCommand(req, res, client) {
  const { par_name } = req.query;
  
  if (!par_name) {
    return res.status(400).json({
      code: 400,
      reason: 'Parameter name is required for get operation'
    });
  }
  
  const result = await client.sendCommand('get', null, { par_name });
  res.json(result);
}

async function handleSetCommand(req, res, client) {
  // Handle setting parameters
  // This could be from query parameters or body
  
  let params = {};
  if (req.method === 'GET') {
    params = req.query;
  } else {
    // For POST requests, handle both URL-encoded and JSON
    if (req.is('application/x-www-form-urlencoded')) {
      params = req.body;
    } else {
      params = req.body;
    }
  }
  
  // Remove op and authentication parameters
  const { op, username, password, device_ip, device_port, ...parameters } = params;
  
  const result = await client.setParameters(parameters);
  res.json(result);
}

async function handlePortCommand(req, res, client, op) {
  const body = req.body;
  
  // Handle single command
  if (body.op && body.ports) {
    const result = await client.sendCommand(op, body.ports);
    return res.json(result);
  }
  
  // Handle multiple commands
  if (body.op === 'multiple' && body.ops && Array.isArray(body.ops)) {
    // For multiple commands, we need to execute them sequentially
    const results = [];
    for (const cmd of body.ops) {
      try {
        const result = await client.sendCommand(cmd.op, cmd.ports);
        results.push({
          op: cmd.op,
          ports: cmd.ports,
          result
        });
      } catch (error) {
        results.push({
          op: cmd.op,
          ports: cmd.ports,
          error: error.message
        });
      }
    }
    
    return res.json({
      code: 200,
      reason: 'OK',
      results
    });
  }
  
  res.status(400).json({
    code: 400,
    reason: 'Invalid command format'
  });
}
