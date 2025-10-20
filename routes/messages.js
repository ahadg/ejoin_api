const express = require('express');
const { auth } = require('../middleware/auth');
const messageController = require('../controllers/messageController');
const AIGenerationController = require('../controllers/aiGenerationController');

const router = express.Router();

// Messages
router.get('/', auth, messageController.getMessages);
router.post('/', auth, messageController.createMessage);
router.get('/:id', auth, messageController.getMessageById);
router.put('/:id', auth, messageController.updateMessage);
router.delete('/:id', auth, messageController.deleteMessage);

// Variants
router.post('/:id/variants', auth, messageController.createVariant);
router.get('/:id/variants', auth, messageController.getVariants);

// New AI Generation routes
router.post('/ai/generate', auth, AIGenerationController.generateVariants);

module.exports = router;
