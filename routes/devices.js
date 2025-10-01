const express = require('express');
const { auth } = require('../middleware/auth');
const deviceController = require('../controllers/deviceController');

const router = express.Router();

router.get('/', auth, deviceController.getDevices);
router.get('/:id', auth, deviceController.getDeviceById);
router.post('/', auth, deviceController.createDevice);
router.put('/:id', auth, deviceController.updateDevice);
router.delete('/:id', auth, deviceController.deleteDevice);
router.patch('/:id/status', auth, deviceController.updateDeviceStatus);
router.patch('/:id/stats', auth, deviceController.updateDeviceStats);
router.post('/:id/reset-daily-count', auth, deviceController.resetDailyCount);

module.exports = router;
