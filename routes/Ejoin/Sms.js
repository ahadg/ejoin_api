const express = require('express');
const router = express.Router();
const smsController = require('../../controllers/Ejoin/ejoinSmsController');

router.post('/submit_sms_tasks', smsController.sendSms);
router.post('/pause_sms_tasks', smsController.pauseSms);
router.post('/resume_sms_tasks', smsController.resumeSms);
router.post('/remove_sms_tasks', smsController.removeSms);
router.get('/get_sms_tasks', smsController.getTasks);
router.post('/get_received_smses', smsController.getSms);
router.get('/get_sms_config', smsController.getSmsConfig);
router.post('/set_sms_config', smsController.setSmsConfig);

module.exports = router;