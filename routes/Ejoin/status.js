// routes/status.js
const express = require('express');
const router = express.Router();
const statusController = require('../../controllers/Ejoin/statusController');

// GET /goip_get_status.html - Get device status or configure status reporting
router.get('/', statusController.getStatus);

// POST /goip_get_status.html - Handle status notifications from devices
router.post('/webhook', statusController.statusNotification);
router.post('/set_status_report_server', statusController.setStatusReportServer);
router.get('/get_status_report_server', statusController.getStatusReportServer);

module.exports = router;