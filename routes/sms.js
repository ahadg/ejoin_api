const express = require("express");
const router = express.Router();
const SimMessagesController = require("../controllers/SimMessagesController");
const { auth } = require('../middleware/auth');
// GET /api/sms
router.get("/", auth, SimMessagesController.getSMS);

// POST /api/sms
router.post("/", auth, SimMessagesController.createSms);

router.post("/send", SimMessagesController.sendSMS);

// POST /api/sms/markAsRead
router.post("/markAsRead/:messageId", auth, SimMessagesController.markAsRead);

// POST /api/sms/webhook
router.post("/webhook", SimMessagesController.webhookSMS);

router.post("/sync/:deviceId", auth, SimMessagesController.syncSms);

router.get('/conversations', SimMessagesController.getConversations);
router.get('/conversation', SimMessagesController.getConversationMessages);

module.exports = router;
