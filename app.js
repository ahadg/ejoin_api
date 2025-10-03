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
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const port = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sms-platform', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  console.log("Socket.IO token",token)
  if (!token) {
    console.log("Socket.IO not token found")
    return next(new Error('Authentication error'));

  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (error) {
    console.log("Socket.IO decodedn error",error)
    next(new Error('Authentication error'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected`);

  // Join user to their personal room
  socket.join(`user:${socket.userId}`);

  socket.on('disconnect', () => {
    console.log(`User ${socket.userId} disconnected`);
  });
});

// Make io available to routes
app.set('io', io);

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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Authentication routes
app.use('/api/auth', authRoutes);

// EJOIN routes
app.use('/api/ejoin/goip_get_status', auth, statusRoutes);
app.use('/api/ejoin/sms', auth, ejoinSmsRoutes);
app.use('/api/ejoin/commands', auth, commandsRoutes);
app.use('/api/sims', auth, simRoutes);
// system routes
app.use('/api/sms', smsRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/messages', messageRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    code: 404,
    reason: 'Route not found'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    code: 500,
    reason: 'Internal server error'
  });
});

server.listen(port, () => {
  console.log(`SMS Platform API server running on port ${port}`);
});

module.exports = { app, server, io };