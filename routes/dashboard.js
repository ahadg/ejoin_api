const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const {  auth } = require('../middleware/auth');

// All routes are protected
router.use(auth);

// Get dashboard statistics
router.get('/stats', dashboardController.getDashboardStats);

// In routes/dashboard.js
router.get('/analytics', dashboardController.getCampaignAnalytics);

// Get recent campaigns for dashboard
router.get('/recent-campaigns', dashboardController.getRecentCampaigns);

// Get devices for dashboard
router.get('/devices', dashboardController.getDashboardDevices);

module.exports = router;