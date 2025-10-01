// routes/status.js
const express = require('express');
const router = express.Router();
const statusController = require('../../controllers/Ejoin/statusController');

// GET /goip_get_status.html - Get device status or configure status reporting
router.get('/', statusController.getStatus);

// POST /goip_get_status.html - Handle status notifications from devices
router.post('/status_notification', statusController.statusNotification);

module.exports = router;