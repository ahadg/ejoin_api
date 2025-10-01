const express = require('express');
const { auth } = require('../middleware/auth');
const contactListController = require('../controllers/contactListController');
const contactController = require('../controllers/contactController');

const router = express.Router();

// Contact list routes
router.get('/lists', auth, contactListController.getContactLists);
router.get('/lists/:id', auth, contactListController.getContactListById);
router.post('/lists', auth, contactListController.createContactList);
router.put('/lists/:id', auth, contactListController.updateContactList);
router.delete('/lists/:id', auth, contactListController.deleteContactList);

// Contact routes
router.get('/lists/:listId/contacts', auth, contactController.getContacts);
router.post('/lists/:listId/contacts', auth, contactController.createContact);
router.put('/contacts/:id', auth, contactController.updateContact);
router.delete('/contacts/:id', auth, contactController.deleteContact);
router.post('/lists/:listId/contacts/import', auth, contactController.importContacts);

module.exports = router;
