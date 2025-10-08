// routes/notifications.js
const express = require('express');
const router = express.Router();
const { NotificationController } = require('../controllers/notificationController');
const { auth } = require('../middleware/auth');
// All routes are protected
router.use(auth);

// GET /api/notifications - Get user notifications
router.get('/', NotificationController.getNotifications);

// GET /api/notifications/unread/count - Get unread count
router.get('/unread/count', NotificationController.getUnreadCount);

// PUT /api/notifications/:notificationId/read - Mark as read
router.put('/:notificationId/read', NotificationController.markAsRead);

// PUT /api/notifications/read-all - Mark all as read
router.put('/read-all', NotificationController.markAllAsRead);

// DELETE /api/notifications/:notificationId - Delete notification
router.delete('/:notificationId', NotificationController.deleteNotification);

// DELETE /api/notifications - Clear all notifications
router.delete('/', NotificationController.clearAll);

module.exports = router;