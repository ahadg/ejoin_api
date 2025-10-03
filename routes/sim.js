const express = require("express");
const router = express.Router();
const simController = require("../controllers/simController");

// GET USSD commands by deviceId & port
// /api/sims/:deviceId/:port/ussd-commands
router.get("/:deviceId/:port/ussd-commands", simController.getUssdCommands);

module.exports = router;
