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
        previousMessages: []
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
      previousMessages = []
    } = params;
    
    console.log("generateWithGrok_params", {
      ...params,
      previousMessagesCount: previousMessages.length
    });
  
    // Construct the system prompt for Grok with category guidance
    const systemPrompt = this.buildSystemPrompt({
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
      previousMessages = []
    } = params;
  
    // Get category-specific guidance
    const categoryGuidance = this.getCategoryGuidance(category);
  
    let systemPrompt = `You are an expert SMS copywriter. Generate ${variantCount} compelling SMS message variants based on the user's prompt.
  
  MESSAGE CATEGORY: ${category}
  ${categoryGuidance}
  
  REQUIREMENTS:
  - Character limit: ${characterLimit} characters MAXIMUM
  - Company name: ${companyName}
  - Unsubscribe text: "${unsubscribeText}" (include this in every variant)
  - Tones to use: ${tones.join(', ')}
  - Languages: ${languages.join(', ')}
  - Creativity level: ${creativityLevel}/1.0
  - Emojis: ${includeEmojis ? 'Include relevant emojis where appropriate' : 'Do not use emojis'}
  ${customInstructions ? `- Custom instructions: ${customInstructions}` : ''}`;
  
    // Add previous messages as reference context only
    if (previousMessages && previousMessages.length > 0) {
      systemPrompt += `
  
  PREVIOUS MESSAGES SENT IN THIS CAMPAIGN (for reference only):
  ${previousMessages.map((msg, index) => `${index + 1}. "${msg}"`).join('\n')}
  
  CONTEXT GUIDANCE:
  - Use the previous messages as inspiration for maintaining campaign consistency
  - Feel free to create variations while keeping the core message intact
  - Focus on creating effective messaging rather than strict uniqueness`;
    }
  
    systemPrompt += `
  
  OUTPUT FORMAT: Return ONLY a JSON array where each object has:
  {
    "content": "The actual SMS message text",
    "tone": "One of the specified tones",
    "language": "One of the specified languages",
    "characterCount": number,
    "spamScore": number between 0-5 (0=not spammy, 5=very spammy),
    "encoding": "GSM-7" or "UCS-2",
    "cost": number of SMS segments (1 or 2)
  }
  
  RULES:
  1. Every message MUST include the unsubscribe text
  2. Strictly respect the ${characterLimit} character limit
  3. Calculate character count accurately
  4. Assign appropriate spam scores based on common spam triggers
  5. Use UCS-2 encoding if message contains emojis or non-GSM characters, otherwise GSM-7
  6. Calculate cost: 1 segment for GSM-7 up to 160 chars, 2 segments beyond; 1 segment for UCS-2 up to 70 chars, 2 segments beyond
  7. Ensure tone matches the assigned tone category
  8. Make messages compelling and action-oriented
  9. Follow the ${category} message guidelines provided above
  
  Return ONLY the JSON array, no other text.`;
  
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