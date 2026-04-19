const axios = require('axios');

const LEMON_API_BASE_URL = 'https://api.lemonsqueezy.com/v1';

function getRequiredConfig() {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = process.env.LEMONSQUEEZY_ADMIN_MONTHLY_VARIANT_ID;

  if (!apiKey || !storeId || !variantId) {
    throw new Error('Lemon Squeezy is not fully configured. Please set LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, and LEMONSQUEEZY_ADMIN_MONTHLY_VARIANT_ID.');
  }

  return { apiKey, storeId, variantId };
}

function getHeaders() {
  const { apiKey } = getRequiredConfig();

  return {
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/$/, '');
}

async function createAdminCheckout({ user }) {
  const { storeId, variantId } = getRequiredConfig();
  const frontendUrl = getFrontendUrl();

  const payload = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: user.email,
          name: user.name,
          custom: {
            user_id: String(user._id),
            role: user.role,
          },
        },
        checkout_options: {
          embed: false,
          media: false,
          logo: true,
        },
        product_options: {
          redirect_url: `${frontendUrl}`,
          receipt_button_text: 'Return to dashboard',
          receipt_link_url: `${frontendUrl}`,
        },
      },
      relationships: {
        store: {
          data: {
            type: 'stores',
            id: String(storeId),
          },
        },
        variant: {
          data: {
            type: 'variants',
            id: String(variantId),
          },
        },
      },
    },
  };

  const response = await axios.post(
    `${LEMON_API_BASE_URL}/checkouts`,
    payload,
    { headers: getHeaders() }
  );

  return response.data;
}

module.exports = {
  createAdminCheckout,
  getRequiredConfig,
};
