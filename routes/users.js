const express = require('express');
const User = require('../models/User');
const Sim = require('../models/Sim');
const { auth, isAdmin } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(auth);

// Get all users (Admin only)
router.get('/', isAdmin, async (req, res) => {
    try {
        const users = await User.find({ createdBy: req.user.id })
            .select('-password -resetPasswordToken -resetPasswordExpires')
            .populate('assignedSims', 'phoneNumber operator status port slot')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            reason: 'Error fetching users'
        });
    }
});

// Create user (Admin only)
router.post('/', isAdmin, async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Validate required fields
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                reason: 'Name, email, and password are required'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                reason: 'User already exists with this email'
            });
        }

        // Validate role if provided
        if (role && !['user', 'admin'].includes(role)) {
            return res.status(400).json({
                success: false,
                reason: 'Invalid role. Must be either "user" or "admin"'
            });
        }

        // Create new user
        const user = new User({
            name,
            email,
            password,
            role: role || 'user',
            createdBy: req.user.id
        });

        await user.save();

        // Return user without password
        const userResponse = user.toObject();
        delete userResponse.password;
        delete userResponse.resetPasswordToken;
        delete userResponse.resetPasswordExpires;

        res.status(201).json({
            success: true,
            data: userResponse
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({
            success: false,
            reason: 'Error creating user'
        });
    }
});

// Update user (Admin only)
router.put('/:userId', isAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { name, email, role } = req.body;

        // Find user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                reason: 'User not found'
            });
        }

        // Validate role if provided
        if (role && !['user', 'admin'].includes(role)) {
            return res.status(400).json({
                success: false,
                reason: 'Invalid role. Must be either "user" or "admin"'
            });
        }

        // Check if email is being changed and if it's already taken
        if (email && email !== user.email) {
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    reason: 'Email already in use by another user'
                });
            }
            user.email = email;
        }

        // Update fields
        if (name) user.name = name;
        if (role) user.role = role;

        await user.save();

        // Return user without sensitive fields
        const userResponse = user.toObject();
        delete userResponse.password;
        delete userResponse.resetPasswordToken;
        delete userResponse.resetPasswordExpires;

        res.json({
            success: true,
            data: userResponse
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            reason: 'Error updating user'
        });
    }
});

// Delete user (Admin only)
router.delete('/:userId', isAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        // Prevent admin from deleting themselves
        if (userId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                reason: 'You cannot delete your own account'
            });
        }

        // Find and delete user
        const user = await User.findByIdAndDelete(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                reason: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            reason: 'Error deleting user'
        });
    }
});

// Get all SIM cards (All authenticated users)
router.get('/sims/all', async (req, res) => {
    try {
        const sims = await Sim.find()
            .select('phoneNumber operator status port slot imei iccid signalStrength')
            .populate('device', 'name ipAddress')
            .sort({ port: 1, slot: 1 });

        res.json({
            success: true,
            data: sims
        });
    } catch (error) {
        console.error('Get SIMs error:', error);
        res.status(500).json({
            success: false,
            reason: 'Error fetching SIM cards'
        });
    }
});

// Assign SIMs to user (Admin only)
router.post('/:userId/assign-sims', isAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { simIds } = req.body;

        // Validate input
        if (!simIds || !Array.isArray(simIds) || simIds.length === 0) {
            return res.status(400).json({
                success: false,
                reason: 'simIds must be a non-empty array'
            });
        }

        // Find user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                reason: 'User not found'
            });
        }

        // Verify all SIM IDs exist
        const sims = await Sim.find({ _id: { $in: simIds } });
        if (sims.length !== simIds.length) {
            return res.status(400).json({
                success: false,
                reason: 'One or more SIM IDs are invalid'
            });
        }

        // Assign SIMs to user
        user.assignedSims = simIds;
        await user.save();

        // Populate and return updated user
        await user.populate('assignedSims', 'phoneNumber operator status port slot');

        const userResponse = user.toObject();
        delete userResponse.password;
        delete userResponse.resetPasswordToken;
        delete userResponse.resetPasswordExpires;

        res.json({
            success: true,
            data: userResponse
        });
    } catch (error) {
        console.error('Assign SIMs error:', error);
        res.status(500).json({
            success: false,
            reason: 'Error assigning SIM cards'
        });
    }
});

// Get user's assigned SIMs
router.get('/:userId/sims', async (req, res) => {
    try {
        const { userId } = req.params;

        // Regular users can only view their own SIMs
        if (req.user.role !== 'admin' && userId !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                reason: 'You can only view your own assigned SIMs'
            });
        }

        const user = await User.findById(userId)
            .populate('assignedSims', 'phoneNumber operator status port slot imei iccid signalStrength device')
            .select('assignedSims');

        if (!user) {
            return res.status(404).json({
                success: false,
                reason: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user.assignedSims
        });
    } catch (error) {
        console.error('Get user SIMs error:', error);
        res.status(500).json({
            success: false,
            reason: 'Error fetching user SIM cards'
        });
    }
});

module.exports = router;
