const express = require("express");
const router = express.Router();
const simController = require("../controllers/simController");

const { auth } = require('../middleware/auth');
// GET all SIMs with optional filtering
router.get("/", simController.getAllSims);

// GET SIMs by device
router.get("/device/:deviceId", simController.getSimsByDevice);

// GET single SIM by ID
router.get("/:simId", simController.getSimById);

// Update SIM daily limit
router.put("/:simId/limit", simController.updateSimLimit);

// Bulk update SIM limits
router.put("/bulk-limits", simController.bulkUpdateSimLimits);

// Reset daily usage for SIMs
router.post("/reset-usage", simController.resetDailyUsage);

// GET USSD commands by deviceId & port
router.get("/:deviceId/:port/ussd-commands", simController.getUssdCommands);

module.exports = router;