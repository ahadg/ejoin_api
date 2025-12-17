EJOIN HTTP API Server

A scalable SMS campaign management platform built with Node.js and Express, designed to integrate seamlessly with EJOIN / GOIP devices for bulk SMS operations.
The system supports intelligent scheduling, SIM rotation, queue-based processing, and real-time monitoring.

✨ Key Highlights

Built for high-volume SMS campaigns

Reliable queue-based processing with BullMQ

Real-time campaign tracking via Socket.IO

Intelligent SIM rotation & rate limiting

Designed for production stability and extensibility

🚀 Features
Core Functionality

RESTful HTTP API for EJOIN / GOIP SMS gateways

Multi-device management with authentication & live status

Campaign automation with scheduling and queuing

Real-time updates using Socket.IO

Graceful shutdown and fault-tolerant processing

Campaign Management

Intelligent SIM rotation (round-robin + daily limits)

Time-based sending windows with auto pause/resume

Contact list management with opt-in / opt-out support

Message variants (single, multiple, AI-generated)

Detailed campaign analytics and delivery metrics

SMS Processing

Queue-based execution using BullMQ

Configurable rate limiting and send delays

Automatic retries and failover handling

Delivery status tracking with error reporting

Technical Features

Redis for queue management and caching

MongoDB for persistent storage

JWT authentication with role-based access control

Health check and monitoring endpoints

Secure password hashing and input validation

🧰 Tech Stack
Backend

Node.js – Runtime environment

Express.js – Web framework

MongoDB – Database (Mongoose ODM)

Redis – Queue management & caching

Socket.IO – Real-time communication

Key Libraries

BullMQ – Job queues and background processing

JWT – Authentication & authorization

Axios – Device communication

Bcrypt – Password hashing

Nodemon – Development hot-reload

🏗️ Architecture Overview
BullMQ Integration

BullMQ is used to ensure reliable and scalable SMS delivery:

Dedicated queue per campaign

Sequential message processing with delays

Delayed jobs for scheduled campaigns

Retry handling with exponential backoff

Automatic recovery after server restarts

Real-time progress tracking

System Components
src/
├── app.js                # Express app entry point
├── routes/               # API routes
├── controllers/          # Request handlers
├── services/
│   ├── campaign.service  # Campaign business logic
│   ├── device.service    # EJOIN device communication
│   └── queue.service     # BullMQ integration
├── sockets/              # Socket.IO event handlers
├── models/               # Mongoose schemas
├── workers/              # BullMQ workers
└── utils/                # Helpers & shared utilities

🔧 API Endpoints
Authentication & Users

POST /api/auth/* – Authentication

GET /api/users/* – User management

EJOIN / GOIP Devices

POST /api/ejoin/sms – Submit SMS to device

GET /api/ejoin/goip_get_status – Device status

POST /api/ejoin/commands – Execute device commands

Campaign Management

POST /api/campaigns – Create campaign

GET /api/campaigns/:id/progress – Campaign progress

POST /api/campaigns/:id/pause – Pause / resume

GET /api/queues – Queue metrics and monitoring

System & Monitoring

GET /health – System health check

GET /health/redis – Redis connection status

GET /api/dashboard – System statistics & overview

🚀 Getting Started
Prerequisites

Node.js v16+

MongoDB v4+

Redis v6+

EJOIN / GOIP devices with HTTP API enabled

Installation
# Clone repository
git clone <repository-url>
cd ejoin-http-api

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env

Environment Variables
MONGODB_URI=mongodb://localhost:27017/ejoin_sms
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret_key
PORT=3000

Run Server
# Development
npm run dev

# Production
npm start