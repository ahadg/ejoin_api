const express = require('express');
const { auth } = require('../middleware/auth');
const campaignController = require('../controllers/campaignController');

const router = express.Router();

router.get('/', auth, campaignController.getCampaigns);
router.get('/:id', auth, campaignController.getCampaignById);
router.post('/', auth, campaignController.createCampaign);
router.put('/:id', auth, campaignController.updateCampaign);
router.delete('/:id', auth, campaignController.deleteCampaign);
router.patch('/:id/stats', auth, campaignController.updateCampaignStats);
router.post('/:id/status', auth, campaignController.updateCampaignStatus);
router.post('/smsstatus', campaignController.smsStatusWebhook);

module.exports = router;
