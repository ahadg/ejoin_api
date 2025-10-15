const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth, JWT_SECRET } = require('../middleware/auth');
const { sendPasswordEmail } = require('../utils/emailService');
const crypto = require('crypto');

const router = express.Router();

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        code: 400,
        reason: 'User already exists with this email'
      });
    }

    // Create user
    const user = new User({ email, password, name });
    await user.save();

    // Generate token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { 
      expiresIn: '7d' 
    });

    res.status(201).json({
      code: 201,
      message: 'User created successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        token
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error creating user'
    });
  }
});

// Signin
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid email or password'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid email or password'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { 
      expiresIn: '7d' 
    });

    res.json({
      code: 200,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          lastLogin: user.lastLogin
        },
        token
      }
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error during login'
    });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  res.json({
    code: 200,
    data: {
      user: {
        id: req.user._id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        lastLogin: req.user.lastLogin
      }
    }
  });
});

// Change password
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id);
    const isMatch = await user.comparePassword(currentPassword);
    
    if (!isMatch) {
      return res.status(400).json({
        code: 400,
        reason: 'Current password is incorrect'
      });
    }

    user.password = newPassword;
    await user.save();

    res.json({
      code: 200,
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error changing password'
    });
  }
});

// Forgot password - generate reset token and send email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal whether email exists or not for security
      return res.json({
        code: 200,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Save token to user
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    // Generate reset link
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/reset-password?token=${resetToken}`;

    // Send email
    await sendPasswordEmail(email, resetLink);

    res.json({
      code: 200,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error processing password reset request'
    });
  }
});

// Reset password - validate token and set new password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Find user by valid reset token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        code: 400,
        reason: 'Invalid or expired reset token'
      });
    }

    // Update password and clear reset token
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({
      code: 200,
      message: 'Password has been reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Error resetting password'
    });
  }
});


module.exports = router;