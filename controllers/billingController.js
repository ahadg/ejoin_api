const crypto = require('crypto');
const User = require('../models/User');
const LemonSqueezyService = require('../services/lemonSqueezyService');

function billingStatusLabel(status = 'inactive') {
  return String(status || 'inactive').toLowerCase();
}

function serializeBilling(user) {
  const billing = user?.billing || {};
  const status = billingStatusLabel(billing.status);

  return {
    provider: billing.provider || 'lemonsqueezy',
    status,
    isSubscribed: ['active', 'on_trial', 'paused', 'past_due', 'unpaid'].includes(status),
    customerId: billing.customerId || null,
    subscriptionId: billing.subscriptionId || null,
    productId: billing.productId || null,
    productName: billing.productName || null,
    variantId: billing.variantId || null,
    variantName: billing.variantName || null,
    subscribedAt: billing.subscribedAt || null,
    renewsAt: billing.renewsAt || null,
    endsAt: billing.endsAt || null,
    trialEndsAt: billing.trialEndsAt || null,
    customerPortalUrl: billing.customerPortalUrl || null,
    updatePaymentMethodUrl: billing.updatePaymentMethodUrl || null,
    lastEventName: billing.lastEventName || null,
    lastWebhookAt: billing.lastWebhookAt || null,
  };
}

function getWebhookSecret() {
  return process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '';
}

function verifyWebhookSignature(req) {
  const secret = getWebhookSecret();
  const rawBody = req.rawBody;
  const signatureHeader = req.get('X-Signature') || '';

  if (!secret) {
    throw new Error('Missing Lemon Squeezy webhook secret.');
  }

  if (!rawBody || !signatureHeader) {
    throw new Error('Missing webhook signature data.');
  }

  const digest = Buffer.from(
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
    'utf8'
  );
  const signature = Buffer.from(signatureHeader, 'utf8');

  if (digest.length !== signature.length || !crypto.timingSafeEqual(digest, signature)) {
    throw new Error('Invalid webhook signature.');
  }
}

async function resolveAdminUserFromWebhook(payload) {
  const customData = payload?.meta?.custom_data || {};
  const attributes = payload?.data?.attributes || {};
  const subscriptionId = payload?.data?.id ? String(payload.data.id) : null;
  const customerId = attributes.customer_id ? String(attributes.customer_id) : null;
  const userId = customData.user_id ? String(customData.user_id) : null;
  const email = attributes.user_email || attributes.customer_email || null;

  if (userId) {
    const directUser = await User.findOne({ _id: userId, role: 'admin' });
    if (directUser) return directUser;
  }

  if (subscriptionId) {
    const bySubscription = await User.findOne({ role: 'admin', 'billing.subscriptionId': subscriptionId });
    if (bySubscription) return bySubscription;
  }

  if (customerId) {
    const byCustomer = await User.findOne({ role: 'admin', 'billing.customerId': customerId });
    if (byCustomer) return byCustomer;
  }

  if (email) {
    return User.findOne({ role: 'admin', email: String(email).toLowerCase() });
  }

  return null;
}

function applySubscriptionAttributes(user, payload) {
  const attributes = payload?.data?.attributes || {};
  const urls = attributes.urls || {};

  user.billing = {
    ...(user.billing || {}),
    provider: 'lemonsqueezy',
    customerId: attributes.customer_id ? String(attributes.customer_id) : user.billing?.customerId,
    orderId: attributes.order_id ? String(attributes.order_id) : user.billing?.orderId,
    subscriptionId: payload?.data?.id ? String(payload.data.id) : user.billing?.subscriptionId,
    productId: attributes.product_id ? String(attributes.product_id) : user.billing?.productId,
    productName: attributes.product_name || user.billing?.productName,
    variantId: attributes.variant_id ? String(attributes.variant_id) : user.billing?.variantId,
    variantName: attributes.variant_name || user.billing?.variantName,
    status: billingStatusLabel(attributes.status || user.billing?.status),
    subscribedAt: attributes.created_at ? new Date(attributes.created_at) : (user.billing?.subscribedAt || new Date()),
    renewsAt: attributes.renews_at ? new Date(attributes.renews_at) : null,
    endsAt: attributes.ends_at ? new Date(attributes.ends_at) : null,
    trialEndsAt: attributes.trial_ends_at ? new Date(attributes.trial_ends_at) : null,
    customerPortalUrl: urls.customer_portal || user.billing?.customerPortalUrl,
    updatePaymentMethodUrl: urls.update_payment_method || user.billing?.updatePaymentMethodUrl,
    lastEventName: payload?.meta?.event_name || null,
    lastWebhookAt: new Date(),
  };
}

function markBillingInactive(user, payload) {
  user.billing = {
    ...(user.billing || {}),
    provider: 'lemonsqueezy',
    status: billingStatusLabel(payload?.data?.attributes?.status || 'inactive'),
    endsAt: payload?.data?.attributes?.ends_at ? new Date(payload.data.attributes.ends_at) : new Date(),
    lastEventName: payload?.meta?.event_name || null,
    lastWebhookAt: new Date(),
  };
}

exports.getSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    const configured = Boolean(
      process.env.LEMONSQUEEZY_API_KEY &&
      process.env.LEMONSQUEEZY_STORE_ID &&
      process.env.LEMONSQUEEZY_ADMIN_MONTHLY_VARIANT_ID &&
      process.env.LEMONSQUEEZY_WEBHOOK_SECRET
    );

    res.json({
      code: 200,
      data: {
        configured,
        subscription: serializeBilling(user),
      },
    });
  } catch (error) {
    console.error('Get billing subscription error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Failed to load billing subscription.',
    });
  }
};

exports.createCheckout = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        code: 403,
        reason: 'Only admins can create subscriptions.',
      });
    }

    const freshUser = await User.findById(req.user._id);
    const checkout = await LemonSqueezyService.createAdminCheckout({ user: freshUser });
    const checkoutUrl = checkout?.data?.attributes?.url || null;

    if (!checkoutUrl) {
      throw new Error('Checkout URL was not returned by Lemon Squeezy.');
    }

    res.json({
      code: 200,
      data: {
        checkoutUrl,
      },
    });
  } catch (error) {
    console.error('Create billing checkout error:', error.response?.data || error.message || error);
    res.status(500).json({
      code: 500,
      reason: error.message || 'Failed to create checkout.',
    });
  }
};

exports.handleWebhook = async (req, res) => {
  try {
    verifyWebhookSignature(req);

    const payload = req.body || {};
    const eventName = payload?.meta?.event_name || '';
    const user = await resolveAdminUserFromWebhook(payload);

    if (!user) {
      return res.status(200).json({
        code: 200,
        message: 'Webhook received but no matching admin user was found.',
      });
    }

    if (payload?.data?.type === 'subscriptions') {
      if (['subscription_created', 'subscription_updated', 'subscription_resumed', 'subscription_unpaused'].includes(eventName)) {
        applySubscriptionAttributes(user, payload);
      } else if (['subscription_cancelled', 'subscription_expired', 'subscription_paused'].includes(eventName)) {
        applySubscriptionAttributes(user, payload);
      }
    }

    if (payload?.data?.type === 'orders' && ['order_created', 'order_refunded'].includes(eventName)) {
      const attributes = payload?.data?.attributes || {};
      user.billing = {
        ...(user.billing || {}),
        provider: 'lemonsqueezy',
        customerId: attributes.customer_id ? String(attributes.customer_id) : user.billing?.customerId,
        orderId: payload?.data?.id ? String(payload.data.id) : user.billing?.orderId,
        productId: attributes.first_order_item?.product_id ? String(attributes.first_order_item.product_id) : user.billing?.productId,
        variantId: attributes.first_order_item?.variant_id ? String(attributes.first_order_item.variant_id) : user.billing?.variantId,
        status: eventName === 'order_refunded' ? 'refunded' : (user.billing?.status || 'pending'),
        lastEventName: eventName,
        lastWebhookAt: new Date(),
      };
    }

    if (['subscription_cancelled', 'subscription_expired'].includes(eventName)) {
      markBillingInactive(user, payload);
    }

    await user.save();

    res.json({
      code: 200,
      message: 'Webhook processed successfully.',
    });
  } catch (error) {
    console.error('Lemon Squeezy webhook error:', error.message || error);
    res.status(400).json({
      code: 400,
      reason: error.message || 'Invalid webhook payload.',
    });
  }
};

exports.serializeBilling = serializeBilling;
