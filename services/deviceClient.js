const axios = require('axios');

class DeviceClient {
  constructor(device) {
    this.baseUrl = `http://${device?.ipAddress}:${device?.port}`;
    this.auth = {
      username: device.username,
      password: device.password
    };
  }

  async request(endpoint, data = null, method = 'GET', isPOST = false) {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      let config = {
        method,
        url,
        timeout: 30000,
        responseType: 'json', // force JSON
        headers: {
          'Content-Type': 'application/json'
        },
        params: {
          username: this.auth.username,
          password: this.auth.password
        }
      };
    
      if (method === 'POST') {
        config.data = data; // don't spread
      } else if(isPOST) {
        config.data = data;
      }else {
        config.params = {
          ...config.params,
          ...(data || {})
        };
      }
      console.log("config__",config)
      const response = await axios(config);
      //console.log("raw response", response.data);
      return response.data;
      //return [ { id: -1155656598, code: 0, reason: 'OK' } ]
    } catch (error) {
      console.log(`Device request error for ${endpoint}:`, error.message);
      throw new Error(`Device communication error: ${error.message}`);
    }
  }
  

  // SMS methods - updated for new API structure
  async sendSms(tasks) {
    // The tasks array is sent as the request body
    console.log("sendSms called",tasks);
    //return this.request('/submit_sms_tasks', tasks, 'POST');
    return [ { id: 1086473958, code: 0, reason: 'OK' } ]
  }

  async pauseSms(ids) {
    return this.request('/pause_sms_tasks', { ids }, 'POST');
  }

  async resumeSms(ids) {
    return this.request('/resume_sms_tasks', { ids }, 'POST');
  }

  async removeSms(ids) {
    return this.request('/remove_sms_tasks', { ids }, 'POST');
  }

  async getTasks(port, index = 0, num = 10, need_content = false) {
    const data = { port, index, num, need_content };
    return this.request('/get_sms_tasks', data, 'POST');
  }

  async getSms(sms_id = 1, sms_num = 0, sms_del = 0) {
    const data = { id : sms_id, num : sms_num, sms_del };
    return this.request('/get_received_smses', data, 'GET', true);
  }

  // SMS config methods
  async getSmsConfig() {
    return this.request('/get_sms_config', {}, 'GET');
  }

  async setSmsConfig(config) {
    return this.request('/set_sms_config', config, 'POST');
  }
  async sendUSSD(body) {
    return this.request('/send_ussds', body, 'POST');
  }

  // Existing methods for device status and commands
  async getStatus(params = {}) {
    return this.request('/get_device_status', params, 'GET');
  }

  async sendCommand(op, ports, additionalParams = {}) {
    const params = { op, ...additionalParams };
    if (ports) {
      params.ports = ports;
    }
    return this.request('/goip_send_cmd.html', params, 'GET');
  }

  
}

module.exports = DeviceClient;