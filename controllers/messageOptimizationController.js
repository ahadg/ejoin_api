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
  buildOptimizationPrompt = (params) => {
    const {
      companyName,
      messageCategory,
      targetSpamScore,
      preserveIntent,
      includeUnsubscribe
    } = params;

    return `You are an expert SMS copywriter and spam optimization specialist and compliance specialist for Canada's Anti-Spam Legislation (CASL). Optimize the provided SMS message to reduce spam score while maintaining effectiveness.

COMPANY: ${companyName}
CATEGORY: ${messageCategory}
TARGET SPAM SCORE: ${targetSpamScore}/10 or lower
PRESERVE INTENT: ${preserveIntent ? 'Yes' : 'No'}
INCLUDE UNSUBSCRIBE: ${includeUnsubscribe ? 'Yes' : 'No'}

OPTIMIZATION STRATEGIES:
1. Replace spam-trigger words with professional alternatives
2. Remove excessive capitalization and exclamation marks
3. Reduce emoji usage to 1-2 relevant emojis maximum
4. Ensure clear value proposition without hype
5. Use natural, conversational language
6. Add proper context and legitimacy indicators
7. Include "Reply STOP to unsubscribe" if missing
8. Maintain character limit under 160 for single segment
- Keep the message concise, natural, and value-forward (no hype).
- Minimize spam triggers.
- Ensure CASL compliance for SMS in Canada using short-form identification + link.

COMMON SPAM TRIGGERS TO ELIMINATE:
- FREE, WIN, PRIZE, CASH, GUARANTEED
- URGENT, ACT NOW, LIMITED TIME, DON'T MISS OUT
- Multiple exclamation points (!!!) 
- ALL CAPS phrases
- Too many emojis (more than 2)
- Suspicious or shortened URLs
- Misleading claims

OUTPUT FORMAT: Return ONLY a JSON object with this structure:
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