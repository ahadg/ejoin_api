const express = require("express");
const router = express.Router();
const smsController = require("../controllers/smsController");

// GET /api/sms
router.get("/", smsController.getSMS);

// POST /api/sms/markAsRead
router.post("/markAsRead/:messageId", smsController.markAsRead);

// POST /api/sms/webhook
router.post("/webhook", smsController.webhookSMS);

router.post("/sync/:deviceId", smsController.syncSms);

module.exports = router;
