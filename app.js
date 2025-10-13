// server.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const authRoutes = require('./routes/auth');
const statusRoutes = require('./routes/Ejoin/status');
const ejoinSmsRoutes = require('./routes/Ejoin/Sms');
const campaignRoutes = require('./routes/compaign');
const contactRoutes = require('./routes/contacts');
const deviceRoutes = require('./routes/devices');
const { auth } = require('./middleware/auth');
const messageRoutes = require('./routes/messages');
const smsRoutes = require('./routes/sms');
const commandsRoutes = require('./routes/Ejoin/commands');
const simRoutes = require('./routes/sim');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');

// Import Redis configuration
const redis = require('./config/redis');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const port = process.env.PORT || 3000;

// Initialize Redis connection
const initializeRedis = async () => {
  try {
    console.log('🔄 Initializing Redis connection...');
    const redisConnection = redis.init();
    
    // Test Redis connection
    await redisConnection.ping();
    console.log('✅ Redis connected successfully');
    
    return redisConnection;
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    throw error;
  }
};

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sms-platform', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  console.log("Socket.IO token", token);
  if (!token) {
    console.log("Socket.IO not token found");
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (error) {
    console.log("Socket.IO decoded error", error);
    next(new Error('Authentication error'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`👤 User ${socket.userId} connected`);

  // Join user to their personal room
  socket.join(`user:${socket.userId}`);

  socket.on('disconnect', () => {
    console.log(`👤 User ${socket.userId} disconnected`);
  });
});

// Make io and redis available to routes
app.set('io', io);
app.set('redis', redis);

// CORS middleware
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  exposedHeaders: ['Authorization'],
  credentials: true,
}));

// Handle preflight requests
app.options('*', cors());

// Body parsers
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Public routes
app.get('/health', async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
    
    // Check Redis health
    const redisHealth = await redis.healthCheck();
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: dbStatus,
      redis: redisHealth.status,
      services: {
        database: dbStatus === 'Connected',
        redis: redisHealth.status === 'connected',
        campaignService: 'active'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Redis health check endpoint
app.get('/health/redis', async (req, res) => {
  try {
    const health = await redis.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Get info about all queues or a specific queue
app.get('/api/queues', async (req, res) => {
  try {
    const queueName = req.query.name;

    if (queueName) {
      // Return metrics for a specific queue
      const metrics = await redis.getQueueMetrics(queueName);
      return res.json({ status: 'success', data: metrics });
    }

    // Otherwise, return metrics for all queues
    const allMetrics = await redis.getAllQueueMetrics();
    res.json({ status: 'success', data: allMetrics });
  } catch (error) {
    console.error('Error fetching queue metrics:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
});


// Authentication routes
app.use('/api/auth', authRoutes);

// EJOIN routes
app.use('/api/ejoin/goip_get_status', auth, statusRoutes);
app.use('/api/ejoin/sms', auth, ejoinSmsRoutes);
app.use('/api/ejoin/commands', auth, commandsRoutes);
app.use('/api/sims', auth, simRoutes);

// System routes
app.use('/api/sms', smsRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    code: 404,
    reason: 'Route not found'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Server error:', error);
  res.status(500).json({
    code: 500,
    reason: 'Internal server error'
  });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('🛑 Received shutdown signal, closing servers...');
  
  try {
    // Close Redis connection
    await redis.close();
    console.log('✅ Redis connection closed');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
    
    // Close HTTP server
    server.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      console.error('❌ Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
    
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start server with Redis initialization
const startServer = async () => {
  try {
    // Initialize Redis first
    await initializeRedis();
    
    // Start the server
    server.listen(port, () => {
      console.log(`🚀 SMS Platform API server running on port ${port}`);
      console.log(`📊 Health check available at: http://localhost:${port}/health`);
      console.log(`🔍 Redis health: http://localhost:${port}/health/redis`);
    });
  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = { app, server, io, redis };