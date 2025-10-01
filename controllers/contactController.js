const ContactList = require('../models/ContactList');
const Contact = require('../models/Contact');

// Get contacts in a list
exports.getContacts = async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;

    const contactList = await ContactList.findOne({ _id: req.params.listId, user: req.user._id });
    if (!contactList) return res.status(404).json({ code: 404, reason: 'Contact list not found' });

    const query = { contactList: contactList._id };
    if (status) query.status = status;

    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Contact.countDocuments(query);

    res.json({
      code: 200,
      data: { contacts, totalPages: Math.ceil(total / limit), currentPage: parseInt(page), total }
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching contacts' });
  }
};

// Create new contact
exports.createContact = async (req, res) => {
  try {
    const contactList = await ContactList.findOne({ _id: req.params.listId, user: req.user._id });
    if (!contactList) return res.status(404).json({ code: 404, reason: 'Contact list not found' });

    const contact = new Contact({ ...req.body, contactList: contactList._id, user: req.user._id });
    await contact.save();

    res.status(201).json({ code: 201, message: 'Contact created successfully', data: { contact } });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ code: 400, reason: 'Contact with this phone number already exists in the list' });
    }
    console.error('Create contact error:', error);
    res.status(500).json({ code: 500, reason: 'Error creating contact' });
  }
};

// Update contact
exports.updateContact = async (req, res) => {
  try {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!contact) return res.status(404).json({ code: 404, reason: 'Contact not found' });

    res.json({ code: 200, message: 'Contact updated successfully', data: { contact } });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ code: 500, reason: 'Error updating contact' });
  }
};

// Delete contact
exports.deleteContact = async (req, res) => {
  try {
    const contact = await Contact.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!contact) return res.status(404).json({ code: 404, reason: 'Contact not found' });

    res.json({ code: 200, message: 'Contact deleted successfully' });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({ code: 500, reason: 'Error deleting contact' });
  }
};

// Bulk import contacts
exports.importContacts = async (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ code: 400, reason: 'Contacts array is required' });
    }

    const contactList = await ContactList.findOne({ _id: req.params.listId, user: req.user._id });
    if (!contactList) return res.status(404).json({ code: 404, reason: 'Contact list not found' });

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
        errors.push({ index, error: error.message, data: contactData });
      }
    }

    res.json({
      code: 200,
      message: `Imported ${importedContacts.length} contacts successfully`,
      data: { imported: importedContacts.length, failed: errors.length, errors }
    });
  } catch (error) {
    console.error('Import contacts error:', error);
    res.status(500).json({ code: 500, reason: 'Error importing contacts' });
  }
};
