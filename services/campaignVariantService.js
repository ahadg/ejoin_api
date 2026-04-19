const Campaign = require('../models/Campaign');
const MessageSentDetails = require('../models/MessageSentDetails');
const aiGenerationController = require('../controllers/aiGenerationController');

class CampaignVariantService {
  constructor({ variantRoundRobinIndex }) {
    this.variantRoundRobinIndex = variantRoundRobinIndex;
  }

  getRoundRobinItem(indexMap, key, items) {
    if (!items?.length) {
      return { item: null, index: -1, nextIndex: 0 };
    }

    if (!indexMap.has(key)) {
      indexMap.set(key, 0);
    }

    const currentIndex = indexMap.get(key);
    const item = items[currentIndex];
    const nextIndex = (currentIndex + 1) % items.length;
    indexMap.set(key, nextIndex);

    return { item, index: currentIndex, nextIndex };
  }

  buildMessagePayload(content, variantId, tone = 'Professional') {
    const resolvedContent = content || 'Default message';

    return {
      content: resolvedContent,
      variantId,
      tone,
      characterCount: resolvedContent.length
    };
  }

  getMessageSetting(settings, key, fallback = undefined) {
    if (!settings || typeof settings.get !== 'function') {
      return fallback;
    }

    const value = settings.get(key);
    return value === undefined ? fallback : value;
  }

  async getPreviousCampaignMessages(campaignId, limit = 50) {
    try {
      const previousMessages = await MessageSentDetails.find({
        campaign: campaignId,
        status: { $in: ['sent', 'delivered'] }
      })
        .select('content -_id')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return previousMessages.map(msg => msg.content);
    } catch (error) {
      console.error(`Error fetching previous messages for campaign ${campaignId}:`, error);
      return [];
    }
  }

  async generateMessageVariant(campaignId, taskSettings, contact) {
    const campaign = await Campaign.findById(campaignId)
      .populate('message')
      .populate({
        path: 'message',
        populate: { path: 'variants', model: 'MessageVariant' }
      });

    console.log("generateMessageVariant_start", {
      campaignId,
      messageVariationType: campaign?.taskSettings?.messageVariationType,
      useAiGeneration: campaign?.taskSettings?.useAiGeneration,
      contact: contact?.phoneNumber
    });

    if (campaign?.taskSettings?.messageVariationType === 'single_variant') {
      console.log("Using single variant from messageContent");
      return this.buildMessagePayload(campaign.messageContent, 'single-base-message');
    }

    if (campaign?.taskSettings?.messageVariationType === 'multiple_variants') {
      if (campaign?.message?.variants && campaign.message.variants.length > 0) {
        const { item: selectedVariant, index: currentIndex, nextIndex } = this.getRoundRobinItem(
          this.variantRoundRobinIndex,
          campaignId,
          campaign.message.variants
        );

        console.log("Selected round-robin variant:", {
          variantId: selectedVariant._id,
          index: currentIndex,
          totalVariants: campaign.message.variants.length,
          nextIndex
        });

        return {
          content: selectedVariant.content,
          variantId: selectedVariant._id,
          tone: selectedVariant.tone || 'Professional',
          characterCount: selectedVariant.characterCount
        };
      }

      console.log("No variants found, falling back to base message");
      return this.buildMessagePayload(campaign?.messageContent, 'fallback-base-message');
    }

    if (campaign?.taskSettings?.messageVariationType === 'ai_random' ||
      campaign?.taskSettings?.useAiGeneration) {

      console.log("current_campaign:", campaign);
      console.log("current_campaign_message:", campaign?.message);
      console.log("current_campaign_message_settings:", campaign?.message?.settings);
      console.log("current_campaign_message_characterLimit:", campaign?.message?.settings?.characterLimit);

      const previousMessages = await this.getPreviousCampaignMessages(campaignId);
      console.log(`Found ${previousMessages.length} previous messages for context`);

      try {
        const aiResponse = await aiGenerationController.generateWithOpenAI({
          prompt: campaign?.message?.originalPrompt || campaign?.message?.baseMessage,
          variantCount: 1,
          characterLimit: this.getMessageSetting(campaign?.message?.settings, "characterLimit"),
          tones: this.getMessageSetting(campaign?.message?.settings, "tones"),
          languages: this.getMessageSetting(campaign?.message?.settings, "languages"),
          creativityLevel: this.getMessageSetting(campaign?.message?.settings, "creativityLevel"),
          includeEmojis: this.getMessageSetting(campaign?.message?.settings, "includeEmojis"),
          companyName: this.getMessageSetting(campaign?.message?.settings, "companyName", ''),
          companyAddress: this.getMessageSetting(campaign?.message?.settings, "companyAddress", ''),
          companyEmail: this.getMessageSetting(campaign?.message?.settings, "companyEmail", ''),
          companyPhone: this.getMessageSetting(campaign?.message?.settings, "companyPhone", ''),
          companyWebsite: this.getMessageSetting(campaign?.message?.settings, "companyWebsite", ''),
          unsubscribeText: this.getMessageSetting(campaign?.message?.settings, "unsubscribeText"),
          customInstructions: this.getMessageSetting(campaign?.message?.settings, "customInstructions"),
          category: campaign?.message?.category,
          previousMessages
        });

        console.log("aiResponse", aiResponse);
        console.log("aiResponse_content", aiResponse?.[0]?.content);

        if (aiResponse && aiResponse[0]?.content) {
          const variant = aiResponse[0];
          console.log("AI variant generated successfully");
          return {
            content: variant.content,
            variantId: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            tone: variant.tone || 'AI-Generated',
            characterCount: variant.characterCount
          };
        }
      } catch (error) {
        console.error('AI message generation failed, using fallback:', error);
      }

      if (campaign?.message?.variants && campaign.message.variants.length > 0) {
        const { item: selectedVariant } = this.getRoundRobinItem(
          this.variantRoundRobinIndex,
          campaignId,
          campaign.message.variants
        );

        console.log("AI failed, using round-robin variant as fallback");
        return {
          content: selectedVariant.content,
          variantId: selectedVariant._id,
          tone: selectedVariant.tone || 'Professional',
          characterCount: selectedVariant.characterCount
        };
      }

      console.log("Using base message as final fallback");
      return this.buildMessagePayload(
        campaign?.messageContent || campaign?.taskSettings?.aiPrompt,
        'ai-fallback-base-message'
      );
    }

    console.log("No message variation type specified, using default");
    return this.buildMessagePayload(campaign?.messageContent, 'default-base-message');
  }

  async resetVariantRoundRobin(campaignId) {
    this.variantRoundRobinIndex.set(campaignId, 0);
    console.log(`Reset variant round-robin index for campaign ${campaignId}`);
    return { success: true };
  }
}

module.exports = CampaignVariantService;
