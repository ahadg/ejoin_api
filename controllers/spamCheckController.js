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
  buildSpamAnalysisPrompt = (params) => {
    const {
      companyName,
      messageCategory
    } = params;

    return `You are an expert SMS spam analyst. and spam optimization specialist and compliance specialist for Canada's Anti-Spam Legislation (CASL). Analyze the provided SMS message for spam indicators and provide a comprehensive assessment.

    COMPANY CONTEXT: ${companyName}
    MESSAGE CATEGORY: ${messageCategory}

    ANALYSIS CRITERIA:
    1. **Spam Score (0-10)**: 0=Not spammy, 10=Very spammy
    2. **Spam Risk Level**: Low, Medium, High, Critical
    3. **Key Spam Indicators**: List specific elements that trigger spam filters
    4. **Compliance Issues**: Identify any legal or regulatory concerns
    5. **Carrier Filter Risk**: Likelihood of being blocked by mobile carriers
    6. **Recommendations**: Specific suggestions to reduce spam score

    COMMON SPAM TRIGGERS TO CHECK:
    - Excessive use of capital letters
    - Too many emojis or special characters
    - Urgency language (ACT NOW!, LIMITED TIME!)
    - Financial incentives (FREE, WIN, PRIZE, CASH)
    - Suspicious links or URL shorteners
    - Missing unsubscribe mechanism
    - Misleading or deceptive content
    - Overly promotional language without value

    OUTPUT FORMAT: Return ONLY a JSON object with this structure:
    {
      "spamScore": number (0-10),
      "riskLevel": "Low" | "Medium" | "High" | "Critical",
      "characterCount": number,
      "encoding": "GSM-7" | "UCS-2",
      "segments": number,
      "spamIndicators": string[],
      "complianceIssues": string[],
      "carrierFilterRisk": "Low" | "Medium" | "High",
      "improvementSuggestions": string[],
      "overallAssessment": string
    }

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