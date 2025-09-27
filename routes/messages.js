const express = require('express');
const Message = require('../models/Message');
const MessageVariant = require('../models/MessageVariant');
const MessageTemplate = require('../models/MessageTemplate');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get all messages for user
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, isTemplate } = req.query;
    
    const query = { user: req.user._id };
    if (isTemplate !== undefined) {
      query.isTemplate = isTemplate === 'true';
    }
    
    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Message.countDocuments(query);
    
    res.json({
      code: 200,
      data: {
        messages,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error fetching messages'
    });
  }
});

// Create a new message
router.post('/', auth, async (req, res) => {
  try {
    const { name, category, originalPrompt, baseMessage, settings, isTemplate } = req.body;
    
    const message = new Message({
      name,
      category,
      originalPrompt,
      baseMessage,
      settings,
      isTemplate,
      user: req.user._id
    });
    
    await message.save();
    
    res.status(201).json({
      code: 201,
      message: 'Message created successfully',
      data: { message }
    });
  } catch (error) {
    console.error('Create message error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error creating message'
    });
  }
});

// Get message by ID with variants
router.get('/:id', auth, async (req, res) => {
  try {
    const message = await Message.findOne({ 
      _id: req.params.id, 
      user: req.user._id 
    }).populate('variants');
    
    if (!message) {
      return res.status(404).json({
        code: 404,
        reason: 'Message not found'
      });
    }
    
    const variants = await MessageVariant.find({ message: message._id });
    
    res.json({
      code: 200,
      data: {
        message: { ...message.toObject(), variants }
      }
    });
  } catch (error) {
    console.error('Get message error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error fetching message'
    });
  }
});

// Update message
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, category, baseMessage, settings } = req.body;
    
    const message = await Message.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { name, category, baseMessage, settings, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!message) {
      return res.status(404).json({
        code: 404,
        reason: 'Message not found'
      });
    }
    
    res.json({
      code: 200,
      message: 'Message updated successfully',
      data: { message }
    });
  } catch (error) {
    console.error('Update message error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error updating message'
    });
  }
});

// Delete message
router.delete('/:id', auth, async (req, res) => {
  try {
    const message = await Message.findOneAndDelete({ 
      _id: req.params.id, 
      user: req.user._id 
    });
    
    if (!message) {
      return res.status(404).json({
        code: 404,
        reason: 'Message not found'
      });
    }
    
    // Also delete associated variants
    await MessageVariant.deleteMany({ message: message._id });
    
    res.json({
      code: 200,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error deleting message'
    });
  }
});

// Message Variants Routes

// Create variant for message
router.post('/:id/variants', auth, async (req, res) => {
  try {
    console.log("req.params", req.params);
    console.log("req.user", req.user);
    console.log("req.body", req.body);

    // 🔹 Verify the parent message belongs to the user
    const message = await Message.findOne({ 
      _id: req.params.id, 
      user: req.user._id 
    });

    if (!message) {
      return res.status(404).json({
        code: 404,
        reason: 'Message not found'
      });
    }

    let variants;

    if (Array.isArray(req.body)) {
      // 🔹 If payload is an array → bulk insert
      const variantsToInsert = req.body.map(v => ({
        ...v,
        message: message._id
      }));

      variants = await MessageVariant.insertMany(variantsToInsert);
    } else {
      // 🔹 If payload is a single object → create normally
      const variant = new MessageVariant({
        ...req.body,
        message: message._id
      });

      variants = await variant.save();
    }

    res.status(201).json({
      code: 201,
      message: 'Variant(s) created successfully',
      data: { variants }
    });

  } catch (error) {
    console.error('Create variant error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error creating variant'
    });
  }
});


// Get variants for message
router.get('/:id/variants', auth, async (req, res) => {
  try {
    const message = await Message.findOne({ 
      _id: req.params.id, 
      user: req.user._id 
    });
    
    if (!message) {
      return res.status(404).json({
        code: 404,
        reason: 'Message not found'
      });
    }
    
    const variants = await MessageVariant.find({ message: message._id }).sort({ sortOrder: 1 });
    
    res.json({
      code: 200,
      data: { variants }
    });
  } catch (error) {
    console.error('Get variants error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error fetching variants'
    });
  }
});

// Message Templates Routes

// Get all templates for user
router.get('/templates', auth, async (req, res) => {
  try {
    const templates = await MessageTemplate.find({ user: req.user._id }).sort({ createdAt: -1 });
    
    res.json({
      code: 200,
      data: { templates }
    });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error fetching templates'
    });
  }
});

// Create template
router.post('/templates', auth, async (req, res) => {
  try {
    const template = new MessageTemplate({
      ...req.body,
      user: req.user._id
    });
    
    await template.save();
    
    res.status(201).json({
      code: 201,
      message: 'Template created successfully',
      data: { template }
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error creating template'
    });
  }
});

// Update template
router.put('/templates/:id', auth, async (req, res) => {
  try {
    const template = await MessageTemplate.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!template) {
      return res.status(404).json({
        code: 404,
        reason: 'Template not found'
      });
    }
    
    res.json({
      code: 200,
      message: 'Template updated successfully',
      data: { template }
    });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error updating template'
    });
  }
});

// Delete template
router.delete('/templates/:id', auth, async (req, res) => {
  try {
    const template = await MessageTemplate.findOneAndDelete({ 
      _id: req.params.id, 
      user: req.user._id 
    });
    
    if (!template) {
      return res.status(404).json({
        code: 404,
        reason: 'Template not found'
      });
    }
    
    res.json({
      code: 200,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error deleting template'
    });
  }
});

module.exports = router;