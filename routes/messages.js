const express = require('express');
const { auth } = require('../middleware/auth');
const messageController = require('../controllers/messageController');

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

// Templates
router.get('/templates', auth, messageController.getTemplates);
router.post('/templates', auth, messageController.createTemplate);
router.put('/templates/:id', auth, messageController.updateTemplate);
router.delete('/templates/:id', auth, messageController.deleteTemplate);

module.exports = router;
