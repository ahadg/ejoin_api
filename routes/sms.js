const express = require("express");
const router = express.Router();
const smsController = require("../controllers/smsController");
const { auth } = require('../middleware/auth');
// GET /api/sms
router.get("/", auth, smsController.getSMS);

// POST /api/sms/markAsRead
router.post("/markAsRead/:messageId", auth, smsController.markAsRead);

// POST /api/sms/webhook
router.post("/webhook", smsController.webhookSMS);

router.post("/sync/:deviceId", auth, smsController.syncSms);

module.exports = router;
