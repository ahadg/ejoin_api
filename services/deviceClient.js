const axios = require('axios');

class DeviceClient {
  constructor(device) {
    this.baseUrl = `http://${device?.ipAddress}:${device?.port}`;
    this.auth = {
      username: device.username,
      password: device.password
    };
  }

  async request(endpoint, data = null, method = 'GET') {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      
      // For GET requests, add auth as query parameters
      // For POST requests, include auth in the request body if needed
      let config = {
        method,
        url,
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json;charset=utf-8'
        }
      };

      if (method === 'GET') {
        config.params = {
          username: this.auth.username,
          password: this.auth.password,
          ...(data || {})
        };
      } else {
        config.data = {
          ...data,
          username: this.auth.username,
          password: this.auth.password
        };
        config.params = {
          username: this.auth.username,
          password: this.auth.password,
          ...(data || {})
        };
      }
      console.log("config",config);
      const response = await axios(config);
      console.log("response.data",response.data);
      return response.data;
    } catch (error) {
      console.log(`Device request error for ${endpoint}:`, error.message);
      throw new Error(`Device communication error: ${error.message}`);
    }
  }

  // SMS methods - updated for new API structure
  async sendSms(tasks) {
    // The tasks array is sent as the request body
    console.log("sendSms called",tasks);
    //return this.request('/submit_sms_task', tasks, 'POST');
    return { res : "ok", code : 200}
  }

  async pauseSms(ids) {
    return this.request('/pause_sms_task', { ids }, 'POST');
  }

  async resumeSms(ids) {
    return this.request('/resume_sms_task', { ids }, 'POST');
  }

  async removeSms(ids) {
    return this.request('/remove_sms_task', { ids }, 'POST');
  }

  async getTasks(port, index = 0, num = 10, need_content = false) {
    const data = { port, index, num, need_content };
    return this.request('/get_sms_task', data, 'POST');
  }

  async getSms(sms_id = 1, sms_num = 0, sms_del = 0) {
    const params = { sms_id, sms_num, sms_del };
    return this.request('/get_received_smses', params, 'GET');
  }

  // SMS config methods
  async getSmsConfig() {
    return this.request('/get_sms_config', {}, 'GET');
  }

  async setSmsConfig(config) {
    return this.request('/set_sms_config', config, 'POST');
  }

  // Existing methods for device status and commands
  async getStatus(params = {}) {
    return this.request('/goip_get_status.html', params, 'GET');
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