const express = require('express');
const router = express.Router();
const smsController = require('../controllers/smsController');

router.post('/submit_sms_task', smsController.sendSms);
router.get('/pause_sms_task', smsController.pauseSms);
router.get('/resume_sms_task', smsController.resumeSms);
router.get('/remove_sms_task', smsController.removeSms);
router.get('/get_sms_task', smsController.getTasks);
router.get('/get_received_smses', smsController.getSms);
// router.get('/get_sms_config', 
//     //    
//     );
// router.get('/set_sms_config', 
// //   
// );

module.exports = router;