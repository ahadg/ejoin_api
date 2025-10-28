// controllers/messageOptimizationController.js
const axios = require('axios');

class MessageOptimizationController {
  constructor() {
    this.grokApiKey = process.env.GROK_API_KEY;
    this.grokApiUrl = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';
  }

  // Optimize message to reduce spam score
  optimizeMessage = async (req, res) => {
    try {
      const {
        message,
        companyName,
        messageCategory = 'General',
        targetSpamScore = 3,
        preserveIntent = true,
        includeUnsubscribe = true
      } = req.body;

      // Validate required fields
      if (!message) {
        return res.status(400).json({ 
          code: 400, 
          reason: 'Message content is required' 
        });
      }

      if (!companyName) {
        return res.status(400).json({ 
          code: 400, 
          reason: 'Company name is required for context' 
        });
      }

      // Generate optimized message using Grok AI
      const optimizationResult = await this.optimizeWithGrok({
        message,
        companyName,
        messageCategory,
        targetSpamScore: parseInt(targetSpamScore),
        preserveIntent: Boolean(preserveIntent),
        includeUnsubscribe: Boolean(includeUnsubscribe)
      });

      res.json({
        code: 200,
        message: 'Message optimized successfully',
        data: { optimizationResult }
      });

    } catch (error) {
      console.error('Message optimization error:', error);
      res.status(500).json({ 
        code: 500, 
        reason: 'Error optimizing message: ' + error.message 
      });
    }
  };

  // Private method to optimize message using Grok AI
  optimizeWithGrok = async (params) => {
    const {
      message,
      companyName,
      messageCategory,
      targetSpamScore,
      preserveIntent,
      includeUnsubscribe
    } = params;

    const systemPrompt = this.buildOptimizationPrompt({
      companyName,
      messageCategory,
      targetSpamScore,
      preserveIntent,
      includeUnsubscribe
    });

    const requestData = {
      model: "grok-3",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Optimize this SMS message to reduce spam score while preserving its core intent:\n\n"${message}"`
        }
      ],
      temperature: 0.5,
      max_tokens: 1000,
      n: 1
    };

    try {
      const response = await axios.post(this.grokApiUrl, requestData, {
        headers: {
          'Authorization': `Bearer ${this.grokApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log("optimization_grok_response", response.data);

      const aiResponse = response.data.choices[0].message.content;
      
      // Parse the AI response to extract optimized message
      return this.parseOptimizationResponse(aiResponse, message);

    } catch (error) {
      console.error('Grok API error for optimization:', error.response?.data || error.message);
      throw new Error('Failed to optimize message: ' + (error.response?.data?.error?.message || error.message));
    }
  };

  // Build system prompt for message optimization
  // Build a CASL-safe optimization prompt for an LLM
// Backward-compatible signature; extra params have defaults.
 buildOptimizationPrompt = (params) => {
  const {
    companyName,
    messageCategory,
    targetSpamScore,
    preserveIntent,
    includeUnsubscribe,
    // NEW optional params:
    characterLimit = 320,            // overall sanity cap (not forcing 1 segment)
    singleSegmentTarget = true,      // encourage ≤160 GSM-7 or ≤70 UCS-2
    languages = ["English"],         // affects STOP/ARRET expectation
    allowedLinkDomain,               // e.g., "example.com"
    maxLinksPerMessage = 1,          // cap links
    strictBilingualStop = true,      // add ARRET if French present
    includeEmojis = false            // hints for UCS-2 expectations
  } = params;

  const forbiddenBanks = [
    // Financial / too-good-to-be-true
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
    // URL shorteners
    "bit.ly","tinyurl","goo.gl","t.co","ow.ly","is.gd"
  ];

  const safeWordPairs = [
    ["Free", "Complimentary / On us"],
    ["Buy now", "Shop today / Explore"],
    ["Limited time offer", "Special offer / Seasonal deal"],
    ["Click here", "Learn more / Visit our site"],
    ["Act now", "Join today / Get started"],
    ["Earn money fast", "Grow your income"],
    ["Get paid today", "Payment available"],
    ["100% guaranteed", "Proven results / Trusted by many"],
    ["Risk-free", "No obligation"],
    ["Best price", "Great value / Affordable"],
    ["Winner / You’ve won", "You may qualify / You’re selected"],
    ["Claim your prize", "Redeem your reward"],
    ["Verify your account", "Confirm your details securely"],
    ["Update your information", "Manage your profile / Review details"],
    ["Urgent", "Quick response appreciated"],
    ["Password / Login now", "Sign in securely"],
    ["Cash", "Credit / Benefit"],
    ["Instant", "Begin now / Start instantly"],
    ["Cheap", "Low-cost / Affordable"],
    ["Discount code", "Promo code / Offer code"],
    ["Refund", "Request assistance / Support available"],
    ["Investment opportunity", "Partnership / Business opportunity"],
    ["Trial / Free trial", "Demo / Preview"]
  ];

  const bilingualNote = strictBilingualStop
    ? `If French is used or audience is bilingual, include ARRET alongside STOP.`
    : `Include ARRET only when French is explicitly used.`;

  const linkPolicy = allowedLinkDomain
    ? `Use ≤ ${maxLinksPerMessage} link and ONLY branded domain: ${allowedLinkDomain}. No URL shorteners.`
    : `Use ≤ ${maxLinksPerMessage} link. Avoid URL shorteners and suspicious redirects.`;

  return `You are an expert SMS copywriter, spam optimization specialist, and CASL (Canada) compliance specialist. Optimize the provided SMS to reduce spam score while preserving effectiveness and legality.

COMPANY: ${companyName || "(unspecified)"}
CATEGORY: ${messageCategory || "(unspecified)"}
TARGET SPAM SCORE: ${targetSpamScore}/10 or lower
PRESERVE INTENT: ${preserveIntent ? "Yes" : "No"}
INCLUDE UNSUBSCRIBE: ${includeUnsubscribe ? "Yes" : "No"}

OBJECTIVE:
- Minimize carrier spam risk (Rogers, Bell, Telus) and ensure CASL compliance.
- Preserve original intent and value proposition (if PRESERVE INTENT is Yes).
- Maintain clarity, credibility, and user trust.

CASL & POLICY CONSTRAINTS (STRICT):
1) Unsubscribe: Include "Reply STOP to unsubscribe." in every marketing message. ${bilingualNote}
2) Identification: Clearly indicate company/sender name (do NOT fabricate missing info).
3) Consent: Assume list is consented; do not ask for consent in-message.
4) Links: ${linkPolicy}
5) Formatting: Avoid ALL CAPS, multiple exclamation points, repeated emojis, and spammy typography.
6) Language & tone: Value-forward, plain, and honest. No scare tactics, false guarantees, or overhype.
7) Character budget: Keep under ${characterLimit} chars total. ${
    singleSegmentTarget
      ? "Prefer single segment where possible: GSM-7 ≤160 chars, UCS-2 ≤70 chars."
      : "Multiple segments allowed if necessary, but be concise."
  }

OPTIMIZATION STRATEGIES:
- Replace risky words with safe alternatives (see SAFE SUBSTITUTIONS).
- Reduce punctuation/emojis (≤2 emojis if any). ${
    includeEmojis ? "Emojis allowed sparingly." : "Avoid emojis; prefer GSM-7."
  }
- Keep 1–2 concise sentences; make the value obvious without hype.
- Prefer branded links; remove tracking params that look suspicious.
- If INCLUDE UNSUBSCRIBE is Yes and it's missing, add the STOP line (and ARRET where applicable).

CANADIAN CARRIER SPAM TRIGGERS TO ELIMINATE:
- ${forbiddenBanks.join(", ")}
- ALL CAPS words, !!!, excessive emojis, more than ${maxLinksPerMessage} link(s), URL shorteners.

SAFE SUBSTITUTIONS GUIDE:
${safeWordPairs.map(([bad, good]) => `- "${bad}" → "${good}"`).join("\n")}

ENCODING & SEGMENTS (FOR YOUR CALC FIELDS):
- Encoding: GSM-7 unless any emoji or non-GSM char → UCS-2.
- Segments:
  * GSM-7: 160 chars = 1 segment; concatenated segments: 153 chars.
  * UCS-2: 70 chars = 1 segment; concatenated segments: 67 chars.

WHAT TO RETURN (STRICT JSON ONLY):
{
  "optimizedMessage": "The improved SMS message text",
  "originalSpamScore": number (estimated),
  "optimizedSpamScore": number (estimated),
  "improvement": number (percentage improvement),
  "changesMade": string[],
  "characterCount": number,
  "segments": number,
  "encoding": "GSM-7" | "UCS-2",
  "complianceStatus": "Compliant" | "Needs Review",
  "beforeAfterAnalysis": {
    "originalIssues": string[],
    "optimizedFeatures": string[]
  }
}

GUIDELINES FOR OPTIMIZATION:
- Keep edits minimal; prioritize safe-word swaps and formatting fixes.
- Ensure STOP (and ARRET if French/bilingual).
- Respect ${languages.join(", ")} language context.
- Penalize spammy constructs: hype, urgency, windfalls, prizes, phishing cues, shorteners, unbranded links.
- Prefer transparent, benefit-led phrasing with a clear next step ("Learn more", "Get started", "Contact us for details").

Return ONLY the JSON object, no other text.`;
};


  // Parse AI response for optimization
  parseOptimizationResponse = (aiResponse, originalMessage) => {
    try {
      // Clean the response - remove any markdown code blocks
      let cleanResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Parse JSON response
      const optimization = JSON.parse(cleanResponse);

      // Calculate actual character count
      optimization.characterCount = optimization.optimizedMessage.length;
      
      // Determine encoding
      const hasNonGSM = /[^A-Za-z0-9 \r\n@£$¥èéùìòÇ\fØø\nÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#$%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\[~\]|\\]/.test(optimization.optimizedMessage);
      const hasEmojis = /[\u{1F600}-\u{1F64F}]/u.test(optimization.optimizedMessage);
      
      optimization.encoding = hasNonGSM || hasEmojis ? 'UCS-2' : 'GSM-7';
      
      // Calculate segments
      if (optimization.encoding === 'UCS-2') {
        optimization.segments = optimization.characterCount <= 70 ? 1 : 2;
      } else {
        optimization.segments = optimization.characterCount <= 160 ? 1 : 2;
      }

      // Calculate improvement percentage if not provided
      if (!optimization.improvement && optimization.originalSpamScore && optimization.optimizedSpamScore) {
        optimization.improvement = Math.round(
          ((optimization.originalSpamScore - optimization.optimizedSpamScore) / optimization.originalSpamScore) * 100
        );
      }

      return optimization;

    } catch (parseError) {
      console.error('Error parsing optimization response:', parseError);
      throw new Error('Failed to parse optimization result. Please try again.');
    }
  };

  // Batch optimize multiple messages
  batchOptimize = async (req, res) => {
    try {
      const { messages, companyName, messageCategory } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ 
          code: 400, 
          reason: 'Messages array is required' 
        });
      }

      const optimizedMessages = [];
      
      for (const message of messages) {
        try {
          const result = await this.optimizeWithGrok({
            message,
            companyName,
            messageCategory
          });
          optimizedMessages.push(result);
        } catch (error) {
          console.error(`Failed to optimize message: ${message}`, error);
          optimizedMessages.push({
            optimizedMessage: message,
            error: 'Optimization failed'
          });
        }
      }

      res.json({
        code: 200,
        message: 'Batch optimization completed',
        data: { optimizedMessages }
      });

    } catch (error) {
      console.error('Batch optimization error:', error);
      res.status(500).json({ 
        code: 500, 
        reason: 'Error in batch optimization: ' + error.message 
      });
    }
  };
}

module.exports = new MessageOptimizationController();