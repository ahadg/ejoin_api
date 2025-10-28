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
    this.grokApiKey = process.env.GROK_API_KEY;
    this.grokApiUrl = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';
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

  // Generate message variants using Grok AI (updated with category)
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


      // Generate variants using Grok AI
      const variants = await this.generateWithGrok({
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

  // Private method to generate variants using Grok AI (updated with category)
  generateWithGrok = async (params) => {
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
    
    console.log("generateWithGrok_params", {
      ...params,
      previousMessagesCount: previousMessages.length
    });
  
    // Construct the system prompt for Grok with category guidance
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
  
    // Prepare the request to Grok API
    const requestData = {
      model: "grok-3",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: creativityLevel,
      max_tokens: 2000,
      n: 1
    };
  
    try {
      const response = await axios.post(this.grokApiUrl, requestData, {
        headers: {
          'Authorization': `Bearer ${this.grokApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log("grok_response", response.data);
  
      const aiResponse = response.data.choices[0].message.content;
      
      // Parse the AI response to extract variants
      return this.parseAIResponse(aiResponse, {
        characterLimit,
        includeEmojis
      });
  
    } catch (error) {
      console.error('Grok API error:', error.response?.data || error.message);
      throw new Error('Failed to generate variants with AI: ' + (error.response?.data?.error?.message || error.message));
    }
  };

  // Build comprehensive system prompt for Grok (updated with category guidance)
 // Build a comprehensive, CASL-safe system prompt for Grok (or any LLM)
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
  let systemPrompt = `You are an expert SMS copywriter creating ${variantCount} CASL-compliant SMS variants for Canadian recipients.

GOALS:
- Produce compelling, clear, and compliant SMS that pass Canadian carrier spam filters (Rogers, Bell, Telus).
- Respect user consent, sender identification, and opt-out rules at all times.

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
3) Unsubscribe: Include a simple opt-out in EVERY message (e.g., "Reply STOP to unsubscribe"). ${stopLine}
4) Transparency: No false, misleading, or deceptive claims. No unrealistic guarantees or scare tactics.
5) Transactional: Still include sender identification and unsubscribe.
6) Record-keeping: Messages must stand alone as compliant without external references.

LINK POLICY & FORMATTING:
${linkPolicy}
- Avoid ALL CAPS, excessive punctuation, repeated emojis, and spammy typography.
- Keep messages concise (≤${characterLimit} chars), 1–2 short sentences maximum.

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
9) If the USER PROMPT includes sender info (name/address/contact), you may use it. Do NOT fabricate missing details.

USER PROMPT CONTEXT:
"${prompt}"

CONSENT & DATA HANDLING:
- Assume the list is consented. Do NOT mention consent in the message body. Do NOT ask for personal data.

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
      const variants = JSON.parse(cleanResponse);

      // Validate and process each variant
      return variants.map(variant => {
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