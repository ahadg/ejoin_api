const express = require('express');
const router = express.Router();
const commandController = require('../controllers/commandController');

router.get('/', commandController.sendCommand);
router.post('/', commandController.sendCommand);

module.exports = router;