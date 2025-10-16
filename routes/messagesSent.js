const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageSentController');
const { auth } = require('../middleware/auth');

// All routes are protected
router.use(auth);

/**
 * @route   GET /api/messages
 * @desc    Get all message sent details by campaign ID
 * @access  Private
 * @query   campaignId - Campaign ID (required)
 * @query   page - Page number (optional, default: 1)
 * @query   limit - Items per page (optional, default: 50)
 * @query   status - Filter by status (optional)
 * @query   sortBy - Sort field (optional, default: createdAt)
 * @query   sortOrder - Sort order (optional, default: desc)
 */
router.get('/', messageController.getMessages);

/**
 * @route   GET /api/messages/stats
 * @desc    Get message statistics by campaign ID
 * @access  Private
 * @query   campaignId - Campaign ID (required)
 */
router.get('/stats', messageController.getMessageStats);

/**
 * @route   GET /api/messages/:id
 * @desc    Get a single message detail by ID
 * @access  Private
 * @param   id - Message ID
 */
router.get('/:id', messageController.getMessageById);

module.exports = router;