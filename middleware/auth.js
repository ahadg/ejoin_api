const jwt = require('jsonwebtoken');
const User = require('../models/User');
const deviceModel = require('../models/Device'); // <-- import your device model

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const auth = async (req, res, next) => {
  try {
    console.log(`[AUTH] ${req.method} ${req.originalUrl}`); // <-- log current URL
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        code: 401,
        reason: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({
        code: 401,
        reason: 'Invalid token.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        code: 401,
        reason: 'Account deactivated.'
      });
    }
    //console.log("req.params.device_id",req.params);
    // If device_id is provided in query, validate and attach device
    if (req.query.device_id) {
      const device = await deviceModel.findOne({
        _id: req.query.device_id,
        user: user._id
      });

      if (!device) {
        return res.status(404).json({
          code: 404,
          reason: 'Device not found or not linked to this user.'
        });
      }

      req.device = device;
    }


    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      code: 401,
      reason: 'Invalid token.'
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      if (user && user.isActive) {
        req.user = user;

        // also check for device if provided
        if (req.params.device_id) {
          const device = await deviceModel.findOne({
            _id: req.params.device_id,
            user: user._id
          });
          if (device) {
            req.device = device;
          }
        }
      }
    }
    next();
  } catch (error) {
    next();
  }
};

// Admin authorization middleware
const isAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        code: 401,
        reason: 'Authentication required.'
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        code: 403,
        reason: 'Access denied. Admin privileges required.'
      });
    }

    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({
      code: 500,
      reason: 'Authorization error.'
    });
  }
};

module.exports = { auth, optionalAuth, isAdmin, JWT_SECRET };
