// controllers/aiGenerationController.js
const axios = require('axios');
const Message = require('../models/Message');
const MessageVariant = require('../models/MessageVariant');

// Category options with descriptions for AI guidance
const CATEGORY_OPTIONS = {
  "Notification": "Informational messages about updates, status changes, or important information",
  "Alert": "Urgent or time-sensitive messages requiring immediate attention",
  "Promotional": "Marketing messages about offers, discounts, or promotions",
  "Transactional": "Order confirmations, receipts, shipping updates, or account-related messages",
  "Reminder": "Appointment reminders, payment due notices, or event reminders",
  "Welcome": "Onboarding messages for new users or customers",
  "Survey": "Feedback requests, reviews, or survey invitations",
  "Update": "General updates about services, features, or account changes"
};

class AIGenerationController {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.openaiApiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';
    this.openaiModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    this.categoryOptions = CATEGORY_OPTIONS;
  }

  // Get available categories
  getCategories = async (req, res) => {
    try {
      res.json({
        code: 200,
        message: 'Categories retrieved successfully',
        data: { 
          categories: CATEGORY_OPTIONS 
        }
      });
    } catch (error) {
      console.error('Get categories error:', error);
      res.status(500).json({ 
        code: 500, 
        reason: 'Error retrieving categories: ' + error.message 
      });
    }
  };

  // Generate message variants using OpenAI (updated with category)
  generateVariants = async (req, res) => {
    try {
      const {
        prompt,
        variantCount = 5,
        characterLimit = 160,
        tones = ['Professional'],
        languages = ['English'],
        creativityLevel = 0.7,
        includeEmojis = false,
        companyName,
        companyAddress,
        companyEmail,
        companyPhone,
        companyWebsite,
        unsubscribeText,
        customInstructions = '',
        category = 'General' // Add category with default
      } = req.body;
      console.log("generateVariants",req.body)
      // Validate required fields
      if (!prompt) {
        return res.status(400).json({ 
          code: 400, 
          reason: 'Prompt is required' 
        });
      }

      if (!companyName) {
        return res.status(400).json({ 
          code: 400, 
          reason: 'Company name is required' 
        });
      }

      if (!companyAddress || !String(companyAddress).trim()) {
        return res.status(400).json({
          code: 400,
          reason: 'Company address is required'
        });
      }


      const hasContactMethod = Boolean(
        String(companyEmail || '').trim() ||
        String(companyPhone || '').trim() ||
        String(companyWebsite || '').trim()
      );

      if (!hasContactMethod) {
        return res.status(400).json({
          code: 400,
          reason: 'At least one contact method is required: company email, phone, or website'
        });
      }

      // Generate variants using OpenAI
      const variants = await this.generateWithOpenAI({
        prompt,
        variantCount: parseInt(variantCount),
        characterLimit: parseInt(characterLimit),
        tones: Array.isArray(tones) ? tones : [tones],
        languages: Array.isArray(languages) ? languages : [languages],
        creativityLevel: parseFloat(creativityLevel),
        includeEmojis: Boolean(includeEmojis),
        companyName,
        unsubscribeText: unsubscribeText || 'Reply STOP to unsubscribe',
        customInstructions,
        category,
        previousMessages: [],
        companyAddress,
        companyEmail,
        companyPhone,
        companyWebsite,
      });

      res.json({
        code: 200,
        message: 'Variants generated successfully',
        data: { variants }
      });

    } catch (error) {
      console.error('Generate variants error:', error);
      res.status(500).json({ 
        code: 500, 
        reason: 'Error generating variants: ' + error.message 
      });
    }
  };

  getVariantSchema = () => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      variants: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string' },
            tone: { type: 'string' },
            language: { type: 'string' },
            characterCount: { type: 'integer' },
            spamScore: { type: 'number' },
            encoding: { type: 'string' },
            cost: { type: 'integer' }
          },
          required: ['content', 'tone', 'language', 'characterCount', 'spamScore', 'encoding', 'cost']
        }
      }
    },
    required: ['variants']
  });

  extractOpenAIText = (responseData) => {
    if (typeof responseData?.output_text === 'string' && responseData.output_text.trim()) {
      return responseData.output_text.trim();
    }

    const messageOutput = Array.isArray(responseData?.output)
      ? responseData.output.find(item => item.type === 'message')
      : null;

    const textParts = Array.isArray(messageOutput?.content)
      ? messageOutput.content
          .filter(item => item.type === 'output_text' && typeof item.text === 'string')
          .map(item => item.text)
      : [];

    return textParts.join('\n').trim();
  };

  // Private method to generate variants using OpenAI
  generateWithOpenAI = async (params) => {
    const {
      prompt,
      variantCount,
      characterLimit,
      tones,
      languages,
      creativityLevel,
      includeEmojis,
      companyName,
      unsubscribeText,
      customInstructions,
      category = 'General',
      previousMessages = [],
      companyAddress,
      companyEmail,
      companyPhone,
      companyWebsite,
    } = params;
    
    console.log("generateWithOpenAI_params", {
      ...params,
      previousMessagesCount: previousMessages.length
    });
  
    // Construct the system prompt for OpenAI with category guidance
    const systemPrompt = this.buildSystemPrompt({
      prompt,
      variantCount,
      characterLimit,
      tones,
      languages,
      creativityLevel,
      includeEmojis,
      companyName,
      unsubscribeText,
      customInstructions,
      category,
      companyAddress,
      companyEmail,
      companyPhone,
      companyWebsite,
      previousMessages
    });
  
    // Prepare the request to OpenAI Responses API with structured outputs
    const requestData = {
      model: this.openaiModel,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "sms_variants",
          strict: true,
          schema: this.getVariantSchema()
        }
      }
    };
  
    try {
      const response = await axios.post(this.openaiApiUrl, requestData, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log("openai_response", response.data);
  
      const aiResponse = this.extractOpenAIText(response.data);
      if (!aiResponse) {
        throw new Error('OpenAI returned an empty response');
      }
      
      // Parse the AI response to extract variants
      return this.parseAIResponse(aiResponse, {
        characterLimit,
        includeEmojis
      });
  
    } catch (error) {
      console.error('OpenAI API error:', error.response?.data || error.message);
      throw new Error('Failed to generate variants with AI: ' + (error.response?.data?.error?.message || error.message));
    }
  };

  generateWithGrok = async (params) => {
    return this.generateWithOpenAI(params);
  };

  // Build a comprehensive, CASL-safe system prompt for OpenAI (or any LLM)
  // Drop-in compatible with your current function signature.
// New optional params: allowedLinkDomain, maxLinksPerMessage (default 1), strictBilingualStop (default true)

buildSystemPrompt = (params) => {
  const {
    prompt = "",
    variantCount,
    characterLimit,
    tones = [],
    languages = ["English"],
    creativityLevel = "medium",
    includeEmojis = false,
    companyName,
    companyAddress,
    companyEmail,
    companyPhone,
    companyWebsite,
    unsubscribeText = 'Reply STOP to unsubscribe.',
    customInstructions,
    category = "General",
    previousMessages = [],
    // NEW optional constraints:
    allowedLinkDomain,            // e.g., "example.com" (forces branded links only)
    maxLinksPerMessage = 1,       // default: 1 link max
    strictBilingualStop = true    // adds French ARRET when French is detected/requested
  } = params;

  // Helper: safe-word substitutions to avoid spam triggers (Canadian carrier patterns)
  const safeWordPairs = [
    ["Free", "Complimentary"],
    ["FREE", "Complimentary"],
    ["Buy now", "Shop today"],
    ["Limited time offer", "Special offer"],
    ["Click here", "Learn more"],
    ["Act now", "Join today"],
    ["Earn money fast", "Grow your income"],
    ["Get paid today", "Payment available"],
    ["100% guaranteed", "Proven results"],
    ["Risk-free", "No obligation"],
    ["Best price", "Great value"],
    ["Winner", "You qualify"],
    ["You’ve won", "You’re selected"],
    ["Claim your prize", "Redeem your reward"],
    ["Verify your account", "Confirm your details securely"],
    ["Update your information", "Manage your profile"],
    ["Urgent", "Quick response appreciated"],
    ["Password", "Access"],
    ["Login now", "Sign in securely"],
    ["Cash", "Credit"],
    ["Instant", "Begin now"],
    ["Cheap", "Affordable"],
    ["Discount code", "Promo code"],
    ["Refund", "Request assistance"],
    ["Investment opportunity", "Partnership"],
    ["Trial", "Demo"],
  ];

  const forbiddenBanks = [
    // Financial / money-hype
    "Free money","Earn cash fast","Make money now","Instant profit","Get paid today",
    "Double your income","Risk-free investment","100% guaranteed","Increase sales instantly","Financial freedom",
    // Aggressive promo/hype
    "Free!!!","Act now!","Limited time offer","Click here","Buy now","Order today","Don’t miss out",
    "Call now","Exclusive deal","Best price","Lowest rate","Offer expires soon","Save big",
    // Prizes/rewards
    "Congratulations","You’ve won","Claim your prize","Get your gift card","Reward points","Winner",
    "Instant reward","Special bonus",
    // Tech/phishing
    "Verify your account","Update your information","Confirm your password","Login now",
    "Security alert","Suspicious activity","Urgent: account suspended",
    // Health/adult
    "Lose weight fast","Viagra","Cialis","ED","Detox","miracle cure","Enhance performance","Adult content","18+",
    // Link + formatting signals
    "bit.ly","tinyurl","goo.gl" // shortened URLs to avoid
  ];

  // Category guidance (assume you have this.getCategoryGuidance)
  const categoryGuidance = this.getCategoryGuidance
    ? this.getCategoryGuidance(category)
    : "(No category guidance provided)";

  // Build a human-readable substitution table for the prompt
  const substitutionTable = safeWordPairs
    .map(([bad, good]) => `- "${bad}" → "${good}"`)
    .join("\n");

  // Compose sender identification lines
  const senderIdGuidance = `
- Legal sender name: "${companyName || 'Use the company name mentioned in the user prompt if available'}"
- Mailing address: ${
    companyAddress
      ? `"${companyAddress}"`
      : "Use address from the prompt if provided; otherwise omit (do NOT invent)."
  }
- Contact method(s): ${
    [companyEmail && `Email: ${companyEmail}`, companyPhone && `Phone: ${companyPhone}`, companyWebsite && `Website: ${companyWebsite}`]
      .filter(Boolean)
      .join(", ") || "Use only if present in the prompt; otherwise omit (do NOT invent)."
  }`.trim();

  // Link policy line
  const linkPolicy = allowedLinkDomain
    ? `- Max ${maxLinksPerMessage} link per message, use ONLY branded domain: ${allowedLinkDomain} (no URL shorteners).`
    : `- Max ${maxLinksPerMessage} link per message, avoid URL shorteners and suspicious redirects.`

  // Languages & bilingual STOP/ARRET
  const langLine = languages.join(", ");
  const stopLine = strictBilingualStop
    ? `Include unsubscribe in the message language. If French is used or requested, add "Répondez ARRET pour vous désabonner" (alongside STOP if bilingual).`
    : `Include unsubscribe in the message language; add French ARRET only when French is used.`

  // Emojis/encoding guardrails
  const emojiPolicy = includeEmojis
    ? `Emojis allowed sparingly (≤2 per message). If ANY emoji is present, encoding is UCS-2; otherwise GSM-7.`
    : `No emojis. Use GSM-7 encoding.`

  // Build the final system prompt
  let systemPrompt = `You are an expert compliance-first SMS copywriter creating ${variantCount} CASL-compliant SMS variants for Canadian recipients.

GOALS:
- Produce compelling, clear, and compliant SMS that pass Canadian carrier spam filters (Rogers, Bell, Telus).
- Respect CASL consent, sender identification, contact information, and opt-out rules at all times.

MESSAGE CATEGORY: ${category}
${categoryGuidance}

REQUIREMENTS:
- Max ${characterLimit} characters per message (hard cap).
- Tones: ${tones.join(", ") || "neutral, friendly"}.
- Languages: ${langLine}.
- Creativity level: ${creativityLevel}.
- Emojis: ${includeEmojis ? "Allowed (light use)" : "Not allowed"}.
${customInstructions ? `- Custom instructions: ${customInstructions}` : ""}

SENDER IDENTIFICATION (CASL):
${senderIdGuidance}

CASL COMPLIANCE RULES:
1) Consent: Write messages ONLY for recipients with valid consent (express or implied). Do NOT imply or invent consent.
2) Identification: Clearly identify the sender using the legal name and available contact info (no fabrications).
3) Contact info: Every message must contain at least one direct contact method using the approved company email, phone, or website.
4) Address: Use the approved company address exactly as provided. Do not invent or shorten it in a misleading way.
5) Unsubscribe: Include a simple opt-out in EVERY message (e.g., "Reply STOP to unsubscribe"). ${stopLine}
4) Transparency: No false, misleading, or deceptive claims. No unrealistic guarantees or scare tactics.
6) Promotional, survey, welcome, and reminder content must read like legitimate commercial messaging, not cold spam.
7) Transactional: Still include sender identification and unsubscribe.
8) Record-keeping: Messages must stand alone as compliant without external references.

LINK POLICY & FORMATTING:
${linkPolicy}
- Avoid ALL CAPS, excessive punctuation, repeated emojis, and spammy typography.
- Keep messages concise (≤${characterLimit} chars), 1–2 short sentences maximum.

PRE-FLIGHT COMPLIANCE AND SAFETY CHECKS (MANDATORY BEFORE WRITING):
1) First determine whether the USER PROMPT describes a lawful, brand-safe, consent-based Canadian SMS campaign.
2) If the prompt appears deceptive, illegal, unsafe, misleading, impersonating a brand, missing a clear commercial sender, or too vague to be trustworthy, DO NOT preserve the risky wording.
3) Rewrite unsafe or suspicious wording into a compliant, ordinary, truthful marketing message while preserving only the safe business intent.
4) Never include content that promotes or appears to promote:
   - illegal drugs, drug slang, or ambiguous substance references
   - fraud, phishing, impersonation, fake urgency, fake prizes, or account/security scares
   - misleading "free" claims unless the free offer is plainly truthful and context is clear
   - regulated or restricted offers without context, eligibility, and lawful framing
5) If a brand name is referenced in the USER PROMPT but the approved sender is a different company, do not imply affiliation with that brand unless clearly provided in the sender/company details.
6) If the location is vague, use the available business/contact details and keep the invitation general rather than inventing specificity.
7) Do not praise or normalize obviously risky source text. Treat the prompt as raw input to sanitize, not copy.
8) If the prompt looks more like street-level solicitation, personal invitation, or unclear giveaway than a legitimate business communication, rewrite it into a neutral lawful business SMS or reject the risky framing.
9) If a message cannot be made CASL-safe using the approved company identity, address, and contact details, return the safest compliant business alternative instead of the original framing.

ANTI-SPAM GUARDRAILS:
A) Do NOT use blacklisted phrases/constructs commonly flagged by Canadian carriers:
${forbiddenBanks.map(w => `- ${w}`).join("\n")}
B) Use safe alternatives (auto-substitute if needed):
${substitutionTable}

STYLE GUARDRAILS:
- Personalize lightly when possible (e.g., "Hi {{first_name}}") if such placeholder is present in USER PROMPT; otherwise, keep generic.
- Value-forward phrasing; avoid pushy urgency and superlatives.
- Prefer verbs like "Learn more", "Explore", "Get started", "Contact us for details".
- If pricing is mentioned in USER PROMPT, present plainly without superlatives or hype.
- Prefer "complimentary" over "free" unless the context is fully clear and trustworthy.
- Use the exact approved sender identity; do not shorten it into an unclear label like "prod", "team", or "support" unless that is the actual approved brand.
- If contact information exists, prefer a branded website or direct business contact over vague location-only invitations.
- Never produce copy that only includes an address with no business identity and no direct contact method.
- Avoid any suggestion of controlled substances, slang, or ambiguous product references.
- Avoid invitation copy that sounds like public solicitation in an unverified location.
- ${emojiPolicy}

ENCODING, SEGMENTS & COST (for your own calculation fields):
- Encoding: GSM-7 unless any emoji or non-GSM characters are present → then UCS-2.
- Segment rules (typical industry reference):
  * GSM-7: up to 160 chars = 1 segment; concatenated segments: 153 chars each.
  * UCS-2: up to 70 chars = 1 segment; concatenated segments: 67 chars each.
- Cost: Estimate based on segments (you may return a per-variant rough estimate as "cost" using segment count; do NOT guess carrier prices).

OUTPUT FORMAT (STRICT):
Return ONLY a JSON array with exactly ${variantCount} items. Each item object MUST have:
{
  "content": "string",
  "tone": "one-of-requested-tones",
  "language": "one-of-requested-languages",
  "characterCount": number,
  "spamScore": number,        // 0 (safest) to 5 (riskier). Most should be 0–2 if compliant.
  "encoding": "GSM-7|UCS-2",
  "cost": number              // segments as integer (1, 2, 3, ...). If unknown, estimate by rules above.
}

VALIDATION RULES:
1) Include unsubscribe text in EVERY variant (English STOP; add French ARRET if French is used or bilingual context requested).
2) NEVER exceed ${characterLimit} characters.
3) Calculate characterCount precisely (count actual characters in "content").
4) Determine encoding correctly; if ANY emoji or non-GSM char → UCS-2.
5) Assign realistic spamScore (consider risky words, urgency, hype, links).
6) Do NOT use URL shorteners or unbranded links${allowedLinkDomain ? `; only ${allowedLinkDomain}` : ""}.
7) Max ${maxLinksPerMessage} link per message.
8) Respect CASL rules and anti-spam guardrails above.
9) Include approved sender identity and at least one approved contact method in every message.
10) Use the approved address only when it improves trust and clarity; never invent more detail.
11) If the USER PROMPT includes sender info (name/address/contact), you may use it. Do NOT fabricate missing details.
10) Every output must read like a real, legitimate business message that could survive legal/compliance review, not just a low-filter-spam rewrite.
11) Never mirror unsafe source wording if it would create legal, brand, trust, or deliverability risk.

USER PROMPT CONTEXT:
"${prompt}"

CONSENT & DATA HANDLING:
- Assume the list is consented. Do NOT mention consent in the message body. Do NOT ask for personal data.

FINAL WRITING PRIORITY:
- Compliance and legitimacy first.
- Trust and clarity second.
- Conversion third.
- If forced to choose, prefer safer and clearer over more aggressive and promotional.

PREVIOUS MESSAGES CONTEXT (use only for stylistic consistency, not as claims):
${previousMessages.length ? previousMessages.map((m,i)=>`${i+1}. "${m}"`).join("\n") : "(none)"} 
`;

  return systemPrompt;
};

  
  

  // Get category-specific guidance for AI
  getCategoryGuidance = (category) => {
    const guidanceMap = {
      "Notification": "Focus on clear, concise information delivery. Keep it factual and helpful.",
      "Alert": "Create urgency and importance. Use attention-grabbing language for time-sensitive information.",
      "Promotional": "Highlight benefits, offers, and calls-to-action. Create excitement and value proposition.",
      "Transactional": "Be clear, accurate, and professional. Include necessary details like order numbers or amounts.",
      "Reminder": "Be helpful and timely. Include key details like dates, times, or actions required.",
      "Welcome": "Be warm, inviting, and set positive expectations. Include next steps if applicable.",
      "Survey": "Be polite and value-oriented. Explain the benefit of providing feedback.",
      "Update": "Be informative and transparent. Focus on what's changing and why it matters.",
      "General": "Create balanced, effective messaging suitable for various purposes."
    };

    return guidanceMap[category] || guidanceMap["General"];
  };

  // Parse AI response and extract variants (unchanged)
  parseAIResponse = (aiResponse, params) => {
    try {
      // Clean the response - remove any markdown code blocks
      let cleanResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Parse JSON response
      const parsedResponse = JSON.parse(cleanResponse);
      const variants = Array.isArray(parsedResponse)
        ? parsedResponse
        : Array.isArray(parsedResponse?.variants)
          ? parsedResponse.variants
          : null;

      if (!variants) {
        console.error('Unexpected AI response shape:', parsedResponse);
        throw new Error('AI returned an unexpected response shape');
      }

      // Validate and process each variant
      return variants.map(variant => {
        if (!variant?.content || typeof variant.content !== 'string') {
          throw new Error('AI variant is missing valid content');
        }

        // Ensure character count is calculated correctly
        const actualCharCount = variant.content.length;
        
        // Determine encoding based on content
        let encoding = 'GSM-7';
        let cost = 1;
        
        // Check if message contains emojis or non-GSM characters
        const hasNonGSM = /[^A-Za-z0-9 \r\n@£$¥èéùìòÇ\fØø\nÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#$%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\[~\]|\\]/.test(variant.content);
        
        if (hasNonGSM || /[\u{1F600}-\u{1F64F}]/u.test(variant.content)) {
          encoding = 'UCS-2';
          // UCS-2: 70 chars per segment
          cost = actualCharCount <= 70 ? 1 : 2;
        } else {
          // GSM-7: 160 chars per segment
          cost = actualCharCount <= 160 ? 1 : 2;
        }

        return {
          content: variant.content,
          tone: variant.tone,
          language: variant.language,
          characterCount: actualCharCount,
          spamScore: Math.min(5, Math.max(0, variant.spamScore || 0)),
          encoding,
          cost
        };
      });

    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      throw new Error('Failed to parse AI response. Please try again.');
    }
  };
}

module.exports = new AIGenerationController();
