// routes/dashboard.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const {  auth } = require('../middleware/auth');

// All routes are protected
router.use(auth);

router.get('/stats', dashboardController.getDashboardStats);
router.get('/devices', dashboardController.getDashboardDevices);
router.get('/recent-campaigns', dashboardController.getRecentCampaigns);
router.get('/analytics', dashboardController.getCampaignAnalytics);
router.get('/active-sims', dashboardController.getActiveSIMs); // New route

module.exports = router;