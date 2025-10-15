// controllers/aiGenerationController.js
const axios = require('axios');
const Message = require('../models/Message');
const MessageVariant = require('../models/MessageVariant');

class AIGenerationController {
  constructor() {
    this.grokApiKey = process.env.GROK_API_KEY;
    this.grokApiUrl = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';
  }

  // Generate message variants using Grok AI
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
        customInstructions = ''
      } = req.body;

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
        customInstructions
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

  // Generate variants and save message in one operation
  generateAndSaveMessage = async (req, res) => {
    try {
      const {
        name,
        category,
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
        isTemplate = false
      } = req.body;

      // Validate required fields
      if (!name || !prompt || !companyName) {
        return res.status(400).json({ 
          code: 400, 
          reason: 'Name, prompt, and company name are required' 
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
        customInstructions
      });

      // Create message
      const message = new Message({
        name,
        category: category || 'General',
        originalPrompt: prompt,
        baseMessage: variants[0]?.content || '',
        settings: {
          variantCount: parseInt(variantCount),
          characterLimit: parseInt(characterLimit),
          tones: Array.isArray(tones) ? tones : [tones],
          languages: Array.isArray(languages) ? languages : [languages],
          creativityLevel: parseFloat(creativityLevel),
          includeEmojis: Boolean(includeEmojis),
          companyName,
          unsubscribeText: unsubscribeText || 'Reply STOP to unsubscribe',
          customInstructions
        },
        isTemplate: Boolean(isTemplate),
        user: req.user._id
      });

      await message.save();

      // Create variants with message reference
      const variantDocuments = variants.map((variant, index) => ({
        message: message._id,
        content: variant.content,
        tone: variant.tone,
        language: variant.language,
        characterCount: variant.characterCount,
        spamScore: variant.spamScore,
        encoding: variant.encoding,
        cost: variant.cost,
        sortOrder: index
      }));

      const savedVariants = await MessageVariant.insertMany(variantDocuments);

      // Populate the message with variants
      const populatedMessage = await Message.findById(message._id)
        .populate('variants');

      res.status(201).json({
        code: 201,
        message: 'Message created with variants successfully',
        data: { 
          message: populatedMessage,
          variants: savedVariants
        }
      });

    } catch (error) {
      console.error('Generate and save message error:', error);
      res.status(500).json({ 
        code: 500, 
        reason: 'Error generating and saving message: ' + error.message 
      });
    }
  };

  // Private method to generate variants using Grok AI
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
      customInstructions
    } = params;
    console.log("generateWithGrok_params",params)
    // Construct the system prompt for Grok
    const systemPrompt = this.buildSystemPrompt({
      variantCount,
      characterLimit,
      tones,
      languages,
      creativityLevel,
      includeEmojis,
      companyName,
      unsubscribeText,
      customInstructions
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
      console.log("grok_response",response.data);

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

  // Build comprehensive system prompt for Grok
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
      customInstructions
    } = params;

    return `You are an expert SMS copywriter. Generate ${variantCount} compelling SMS message variants based on the user's prompt.

REQUIREMENTS:
- Character limit: ${characterLimit} characters MAXIMUM
- Company name: ${companyName}
- Unsubscribe text: "${unsubscribeText}" (include this in every variant)
- Tones to use: ${tones.join(', ')}
- Languages: ${languages.join(', ')}
- Creativity level: ${creativityLevel}/1.0
- Emojis: ${includeEmojis ? 'Include relevant emojis where appropriate' : 'Do not use emojis'}
${customInstructions ? `- Custom instructions: ${customInstructions}` : ''}

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

Return ONLY the JSON array, no other text.`;
  };

  // Parse AI response and extract variants
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