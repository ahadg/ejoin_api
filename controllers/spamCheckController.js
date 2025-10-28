// controllers/spamCheckController.js
const axios = require('axios');

class SpamCheckController {
  constructor() {
    this.grokApiKey = process.env.GROK_API_KEY;
    this.grokApiUrl = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';
  }

  // Check spam score for a single message
  checkSpamScore = async (req, res) => {
    try {
      const {
        message,
        companyName,
        messageCategory = 'General'
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

      // Generate comprehensive spam analysis using Grok AI
      const spamAnalysis = await this.analyzeSpamWithGrok({
        message,
        companyName,
        messageCategory
      });

      res.json({
        code: 200,
        message: 'Spam analysis completed successfully',
        data: { spamAnalysis }
      });

    } catch (error) {
      console.error('Spam check error:', error);
      res.status(500).json({ 
        code: 500, 
        reason: 'Error analyzing spam score: ' + error.message 
      });
    }
  };

  // Private method to analyze spam using Grok AI
  analyzeSpamWithGrok = async (params) => {
    const {
      message,
      companyName,
      messageCategory
    } = params;

    const systemPrompt = this.buildSpamAnalysisPrompt({
      companyName,
      messageCategory
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
          content: `Analyze this SMS message for spam indicators:\n\n"${message}"`
        }
      ],
      temperature: 0.3,
      max_tokens: 1500,
      n: 1
    };

    try {
      const response = await axios.post(this.grokApiUrl, requestData, {
        headers: {
          'Authorization': `Bearer ${this.grokApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log("spam_check_grok_response", response.data);

      const aiResponse = response.data.choices[0].message.content;
      
      // Parse the AI response to extract spam analysis
      return this.parseSpamAnalysisResponse(aiResponse, message);

    } catch (error) {
      console.error('Grok API error for spam check:', error.response?.data || error.message);
      throw new Error('Failed to analyze spam score: ' + (error.response?.data?.error?.message || error.message));
    }
  };

  // Build system prompt for spam analysis
  // Build a robust CASL-focused spam analysis prompt for an LLM
// Backward-compatible: same signature; extra params are optional.
 buildSpamAnalysisPrompt = (params) => {
  const {
    companyName,
    messageCategory,
    // NEW optional params (all have sensible defaults):
    characterLimit = 320,          // for sanity checks
    languages = ["English"],       // influences STOP/ARRET expectations
    includeEmojis = false,         // hints for encoding checks
    allowedLinkDomain,             // e.g., "example.com" (force branded links)
    maxLinksPerMessage = 1,        // cap links
    strictBilingualStop = true     // require ARRET if French present
  } = params;

  // Short trigger banks and safe alternatives (Canadian carrier patterns)
  const forbiddenBanks = [
    // Financial / “too good to be true”
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
    // URL shorteners / risky redirects
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
    ["100% guaranteed", "Proven results"],
    ["Risk-free", "No obligation"],
    ["Best price", "Great value / Affordable"],
    ["Winner / You’ve won", "You’re selected / You may qualify"],
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
    ? `If French is used or the audience is bilingual, include ARRET alongside STOP.`
    : `Include ARRET only when French is explicitly used.`;

  const linkPolicy = allowedLinkDomain
    ? `Use at most ${maxLinksPerMessage} link and ONLY branded domain: ${allowedLinkDomain}. No URL shorteners.`
    : `Use at most ${maxLinksPerMessage} link. Avoid URL shorteners and suspicious redirects.`;

  return `You are an expert SMS spam analyst and CASL compliance specialist. Analyze the provided SMS message for spam indicators and provide a comprehensive, actionable assessment tailored to Canadian carrier filters (Rogers, Bell, Telus).

COMPANY CONTEXT: ${companyName || "(unspecified)"}
MESSAGE CATEGORY: ${messageCategory || "(unspecified)"}

SCOPE:
- Evaluate content, formatting, links, consent implications, sender identification, unsubscribe mechanism, and legal risk under CASL.
- Recommend precise, minimal edits that lower risk while preserving intent.

CANONICAL CHECKLIST (STRICT):
1) Character limit sanity: target ≤ ${characterLimit} chars.
2) Unsubscribe: Must include clear opt-out (e.g., "Reply STOP to unsubscribe."). ${bilingualNote}
3) Sender identification: Company name must be present or reasonably implied by context (do NOT assume). Presence of contact info is a plus but not required in SMS; penalize absence if message is promotional.
4) Consent: Assume outreach list is consented; DO NOT ask for consent in-message. Flag if content implies non-consented scraping or unsolicited contact.
5) Link policy: ${linkPolicy}
6) Tone: Value-forward; no exaggerated urgency, scare tactics, or superlatives.
7) Formatting: Avoid ALL CAPS, excessive punctuation, repeated emojis, non-branded links, or tracking parameters that look suspicious.
8) Sensitive topics: Financial windfalls, prizes, adult/health claims, and phishing patterns are high-risk and should be rewritten.

CANADIAN CARRIER SPAM TRIGGERS (BLOCK/REDUCE):
- Forbidden/high-risk phrases to detect: ${forbiddenBanks.join(", ")}.
- Flag ALL CAPS, multiple exclamation marks, repeated emojis, or emoji-only lines.
- Flag URL shorteners and non-branded redirects.

SAFE WORD SUBSTITUTIONS (GUIDE):
${safeWordPairs.map(([bad, good]) => `- "${bad}" → "${good}"`).join("\n")}

ENCODING & SEGMENTS (FOR YOUR CALCULATION FIELDS):
- Encoding: GSM-7 unless any emoji or non-GSM char → UCS-2.
- Segment rules:
  * GSM-7: 160 chars = 1 segment; concatenated segments are 153 chars each.
  * UCS-2: 70 chars = 1 segment; concatenated segments are 67 chars each.

WHAT TO RETURN (STRICT JSON ONLY):
{
  "spamScore": number (0-10),
  "riskLevel": "Low" | "Medium" | "High" | "Critical",
  "characterCount": number,
  "encoding": "GSM-7" | "UCS-2",
  "segments": number,
  "spamIndicators": string[],         // concrete issues found (e.g., "contains 'Click here'", "uses bit.ly", "all caps word", "no STOP")
  "complianceIssues": string[],       // CASL-specific gaps (e.g., "missing sender name", "unsubscribe missing", "misleading claim")
  "carrierFilterRisk": "Low" | "Medium" | "High",
  "improvementSuggestions": string[], // actionable, minimal edits; prefer safe substitutions and phrasing
  "overallAssessment": string         // concise 1–2 sentence summary
}

EVALUATION NOTES:
- Consider ${languages.join(", ")} language context when checking STOP/ARRET.
- If emojis are present or non-GSM characters are detected${includeEmojis ? " (emojis likely)" : ""}, set encoding=UCS-2 and compute segments accordingly.
- Penalize: URL shorteners, more than ${maxLinksPerMessage} link(s), missing unsubscribe, missing/unclear sender, hype/urgency, financial windfalls, prize language, phishing cues.
- Prefer suggestions that swap only the risky words/structures with the provided safe alternatives.

Return ONLY the JSON object, no other text.`;
};


  // Parse AI response for spam analysis
  parseSpamAnalysisResponse = (aiResponse, originalMessage) => {
    try {
      // Clean the response - remove any markdown code blocks
      let cleanResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Parse JSON response
      const analysis = JSON.parse(cleanResponse);

      // Add message stats
      analysis.characterCount = originalMessage.length;
      
      // Determine encoding
      const hasNonGSM = /[^A-Za-z0-9 \r\n@£$¥èéùìòÇ\fØø\nÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#$%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\[~\]|\\]/.test(originalMessage);
      const hasEmojis = /[\u{1F600}-\u{1F64F}]/u.test(originalMessage);
      
      analysis.encoding = hasNonGSM || hasEmojis ? 'UCS-2' : 'GSM-7';
      
      // Calculate segments
      if (analysis.encoding === 'UCS-2') {
        analysis.segments = analysis.characterCount <= 70 ? 1 : 2;
      } else {
        analysis.segments = analysis.characterCount <= 160 ? 1 : 2;
      }

      return analysis;

    } catch (parseError) {
      console.error('Error parsing spam analysis response:', parseError);
      throw new Error('Failed to parse spam analysis. Please try again.');
    }
  };
}

module.exports = new SpamCheckController();