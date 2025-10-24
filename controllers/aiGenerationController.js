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
  buildSystemPrompt = (params) => {
    const {
      prompt = "",
      variantCount,
      characterLimit,
      tones,
      languages,
      creativityLevel,
      includeEmojis,
      companyName,
      companyAddress,
      companyEmail,
      companyPhone,
      companyWebsite,
      unsubscribeText,
      customInstructions,
      category = 'General',
      previousMessages = []
    } = params;
  
    const categoryGuidance = this.getCategoryGuidance(category);
  
    // 🧠 Smart: Tell the AI to also infer company info from user prompt if missing
    let systemPrompt = `You are an expert SMS copywriter creating ${variantCount} CASL-compliant SMS variants for Canadian recipients.
  
  MESSAGE CATEGORY: ${category}
  ${categoryGuidance}
  
  REQUIREMENTS:
  - Max ${characterLimit} characters per message
  - Include legal sender name: "${companyName || 'Use the company name mentioned in the user prompt if available'}"
  - Include unsubscribe text: "${unsubscribeText}"
  - Tones: ${tones.join(', ')}
  - Languages: ${languages.join(', ')}
  - Creativity level: ${creativityLevel}
  - Emojis: ${includeEmojis ? 'Allowed' : 'Not allowed'}
  ${customInstructions ? `- Custom instructions: ${customInstructions}` : ''}
  
  CANADA’S ANTI-SPAM LEGISLATION (CASL) REQUIREMENTS:
  1. Only message recipients with **valid consent** (express or implied). Never invent or imply consent.
  2. **Sender identification**:
     - Must clearly identify the sender. ${
       companyName
         ? `Use "${companyName}".`
         : `If no company name provided in parameters, infer it from the user's prompt if it’s mentioned.`
     }
     - ${
       companyAddress
         ? `Include mailing address: "${companyAddress}".`
         : `If no mailing address parameter provided, check if the prompt includes one.`
     }
     - ${
       companyEmail || companyPhone || companyWebsite
         ? `Contact method(s): ${[
             companyEmail && `Email: ${companyEmail}`,
             companyPhone && `Phone: ${companyPhone}`,
             companyWebsite && `Website: ${companyWebsite}`,
           ]
             .filter(Boolean)
             .join(', ')}.`
         : `If no contact info parameters provided, use any contact info found in the prompt.`
     }
  3. **Unsubscribe mechanism**:
     - Include a simple opt-out (e.g., "Reply STOP").
  4. **Transparency**: No false or misleading claims.
  5. **Transactional messages**: Must still identify sender and include unsubscribe text.
  6. If bilingual context, may include French equivalent for STOP ("ARRET").

  COMMON SPAM TRIGGERS:
    - Excessive use of capital letters
    - Too many emojis or special characters
    - Urgency language (ACT NOW!, LIMITED TIME!)
    - Financial incentives (FREE, WIN, PRIZE, CASH)
    - Suspicious links or URL shorteners
    - Missing unsubscribe mechanism
    - Misleading or deceptive content
    - Overly promotional language without value
  
  OUTPUT FORMAT:
  Return ONLY JSON array of variants:
  [
    {
      "content": "...",
      "tone": "...",
      "language": "...",
      "characterCount": ...,
      "spamScore": ...,
      "encoding": "...",
      "cost": ...
    }
  ]
  
  RULES:
  1. Must include unsubscribe text in every variant.
  2. Never exceed ${characterLimit} characters.
  3. Calculate character count accurately.
  4. Apply correct encoding (UCS-2 for emojis, else GSM-7).
  5. Assign realistic spam scores (0–5).
  6. Respect CASL legal rules described above.
  7. Be compelling, clear, and compliant.
  
  USER PROMPT CONTEXT:
  "${prompt}"
  
  If any company details (name, address, contact info) are missing from parameters,
  you may safely use or reference those that appear naturally in the user's prompt text.`;
  
    if (previousMessages?.length) {
      systemPrompt += `
  PREVIOUS MESSAGES CONTEXT:
  ${previousMessages.map((msg, i) => `${i + 1}. "${msg}"`).join('\n')}
  Use them as inspiration to maintain campaign consistency.`;
    }
  
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