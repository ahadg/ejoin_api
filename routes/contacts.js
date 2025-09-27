const express = require('express');
const ContactList = require('../models/ContactList');
const Contact = require('../models/Contact');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Contact Lists Routes

// Get all contact lists for user
router.get('/lists', auth, async (req, res) => {
  try {
    const contactLists = await ContactList.find({ user: req.user._id }).sort({ createdAt: -1 });
    
    res.json({
      code: 200,
      data: { contactLists }
    });
  } catch (error) {
    console.error('Get contact lists error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error fetching contact lists'
    });
  }
});

// Get contact list by ID
router.get('/lists/:id', auth, async (req, res) => {
  try {
    const contactList = await ContactList.findOne({ 
      _id: req.params.id, 
      user: req.user._id 
    });
    
    if (!contactList) {
      return res.status(404).json({
        code: 404,
        reason: 'Contact list not found'
      });
    }
    
    res.json({
      code: 200,
      data: { contactList }
    });
  } catch (error) {
    console.error('Get contact list error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error fetching contact list'
    });
  }
});

// Create new contact list
router.post('/lists', auth, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const contactList = new ContactList({
      name,
      description,
      user: req.user._id
    });
    
    await contactList.save();
    
    res.status(201).json({
      code: 201,
      message: 'Contact list created successfully',
      data: { contactList }
    });
  } catch (error) {
    console.error('Create contact list error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error creating contact list'
    });
  }
});

// Update contact list
router.put('/lists/:id', auth, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const contactList = await ContactList.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { name, description, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!contactList) {
      return res.status(404).json({
        code: 404,
        reason: 'Contact list not found'
      });
    }
    
    res.json({
      code: 200,
      message: 'Contact list updated successfully',
      data: { contactList }
    });
  } catch (error) {
    console.error('Update contact list error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error updating contact list'
    });
  }
});

// Delete contact list
router.delete('/lists/:id', auth, async (req, res) => {
  try {
    const contactList = await ContactList.findOneAndDelete({ 
      _id: req.params.id, 
      user: req.user._id 
    });
    
    if (!contactList) {
      return res.status(404).json({
        code: 404,
        reason: 'Contact list not found'
      });
    }
    
    // Also delete all contacts in this list
    await Contact.deleteMany({ contactList: contactList._id });
    
    res.json({
      code: 200,
      message: 'Contact list deleted successfully'
    });
  } catch (error) {
    console.error('Delete contact list error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error deleting contact list'
    });
  }
});

// Contacts Routes

// Get contacts in a list
router.get('/lists/:listId/contacts', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    
    // Verify contact list belongs to user
    const contactList = await ContactList.findOne({
      _id: req.params.listId,
      user: req.user._id
    });
    
    if (!contactList) {
      return res.status(404).json({
        code: 404,
        reason: 'Contact list not found'
      });
    }
    
    const query = { contactList: contactList._id };
    if (status) {
      query.status = status;
    }
    
    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Contact.countDocuments(query);
    
    res.json({
      code: 200,
      data: {
        contacts,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total
      }
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error fetching contacts'
    });
  }
});

// Create new contact
router.post('/lists/:listId/contacts', auth, async (req, res) => {
  try {
    // Verify contact list belongs to user
    const contactList = await ContactList.findOne({
      _id: req.params.listId,
      user: req.user._id
    });
    
    if (!contactList) {
      return res.status(404).json({
        code: 404,
        reason: 'Contact list not found'
      });
    }
    
    const contact = new Contact({
      ...req.body,
      contactList: contactList._id,
      user: req.user._id
    });
    
    await contact.save();
    
    res.status(201).json({
      code: 201,
      message: 'Contact created successfully',
      data: { contact }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        code: 400,
        reason: 'Contact with this phone number already exists in the list'
      });
    }
    
    console.error('Create contact error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error creating contact'
    });
  }
});

// Update contact
router.put('/contacts/:id', auth, async (req, res) => {
  try {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!contact) {
      return res.status(404).json({
        code: 404,
        reason: 'Contact not found'
      });
    }
    
    res.json({
      code: 200,
      message: 'Contact updated successfully',
      data: { contact }
    });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error updating contact'
    });
  }
});

// Delete contact
router.delete('/contacts/:id', auth, async (req, res) => {
  try {
    const contact = await Contact.findOneAndDelete({ 
      _id: req.params.id, 
      user: req.user._id 
    });
    
    if (!contact) {
      return res.status(404).json({
        code: 404,
        reason: 'Contact not found'
      });
    }
    
    res.json({
      code: 200,
      message: 'Contact deleted successfully'
    });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error deleting contact'
    });
  }
});

// Bulk import contacts
router.post('/lists/:listId/contacts/import', auth, async (req, res) => {
  try {
    const { contacts } = req.body;
    
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        code: 400,
        reason: 'Contacts array is required'
      });
    }
    
    // Verify contact list belongs to user
    const contactList = await ContactList.findOne({
      _id: req.params.listId,
      user: req.user._id
    });
    
    if (!contactList) {
      return res.status(404).json({
        code: 404,
        reason: 'Contact list not found'
      });
    }
    
    const importBatchId = require('crypto').randomUUID();
    const importedContacts = [];
    const errors = [];
    
    for (const [index, contactData] of contacts.entries()) {
      try {
        const contact = new Contact({
          ...contactData,
          contactList: contactList._id,
          user: req.user._id,
          importBatchId,
          source: 'import'
        });
        
        await contact.save();
        importedContacts.push(contact);
      } catch (error) {
        errors.push({
          index,
          error: error.message,
          data: contactData
        });
      }
    }
    
    res.json({
      code: 200,
      message: `Imported ${importedContacts.length} contacts successfully`,
      data: {
        imported: importedContacts.length,
        failed: errors.length,
        errors
      }
    });
  } catch (error) {
    console.error('Import contacts error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error importing contacts'
    });
  }
});

module.exports = router;