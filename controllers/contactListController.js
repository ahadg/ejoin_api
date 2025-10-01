const ContactList = require('../models/ContactList');
const Contact = require('../models/Contact');

// Get all contact lists for user
exports.getContactLists = async (req, res) => {
  try {
    const contactLists = await ContactList.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ code: 200, data: { contactLists } });
  } catch (error) {
    console.error('Get contact lists error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching contact lists' });
  }
};

// Get single contact list
exports.getContactListById = async (req, res) => {
  try {
    const contactList = await ContactList.findOne({ _id: req.params.id, user: req.user._id });
    if (!contactList) return res.status(404).json({ code: 404, reason: 'Contact list not found' });

    res.json({ code: 200, data: { contactList } });
  } catch (error) {
    console.error('Get contact list error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching contact list' });
  }
};

// Create new contact list
exports.createContactList = async (req, res) => {
  try {
    const { name, description } = req.body;
    const contactList = new ContactList({ name, description, user: req.user._id });
    await contactList.save();

    res.status(201).json({
      code: 201,
      message: 'Contact list created successfully',
      data: { contactList }
    });
  } catch (error) {
    console.error('Create contact list error:', error);
    res.status(500).json({ code: 500, reason: 'Error creating contact list' });
  }
};

// Update contact list
exports.updateContactList = async (req, res) => {
  try {
    const { name, description } = req.body;
    const contactList = await ContactList.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { name, description, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!contactList) return res.status(404).json({ code: 404, reason: 'Contact list not found' });

    res.json({
      code: 200,
      message: 'Contact list updated successfully',
      data: { contactList }
    });
  } catch (error) {
    console.error('Update contact list error:', error);
    res.status(500).json({ code: 500, reason: 'Error updating contact list' });
  }
};

// Delete contact list (and its contacts)
exports.deleteContactList = async (req, res) => {
  try {
    const contactList = await ContactList.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!contactList) return res.status(404).json({ code: 404, reason: 'Contact list not found' });

    await Contact.deleteMany({ contactList: contactList._id });

    res.json({ code: 200, message: 'Contact list deleted successfully' });
  } catch (error) {
    console.error('Delete contact list error:', error);
    res.status(500).json({ code: 500, reason: 'Error deleting contact list' });
  }
};
