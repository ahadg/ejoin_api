const express = require('express');
const BillingController = require('../controllers/billingController');
const { auth, isAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/webhook', BillingController.handleWebhook);
router.get('/subscription', auth, isAdmin, BillingController.getSubscription);
router.post('/checkout', auth, isAdmin, BillingController.createCheckout);

module.exports = router;
