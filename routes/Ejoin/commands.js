const express = require('express');
const router = express.Router();
const commandController = require('../controllers/Ejoin/commandController');

router.get('/', commandController.sendCommand);
router.post('/', commandController.sendCommand);

module.exports = router;