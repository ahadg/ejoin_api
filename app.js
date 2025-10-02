const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const statusRoutes = require('./routes/Ejoin/status');
const ejoinSmsRoutes = require('./routes/Ejoin/Sms');
const campaignRoutes = require('./routes/compaign');
const contactRoutes = require('./routes/contacts');
const deviceRoutes = require('./routes/devices');
const { auth } = require('./middleware/auth');
const messageRoutes = require('./routes/messages');
const smsRoutes = require('./routes/sms');

const app = express();
const port = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sms-platform', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

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
// system routes
app.use('/api/sms', auth, smsRoutes);
app.use('/api/campaigns', auth, campaignRoutes);
app.use('/api/contacts', auth, contactRoutes);
app.use('/api/devices', auth, deviceRoutes);
app.use('/api/messages', auth, messageRoutes);

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

app.listen(port, () => {
  console.log(`SMS Platform API server running on port ${port}`);
});

module.exports = app;