# User Management API Documentation

This document provides detailed information about the user management API endpoints.

## Base URL
All endpoints are prefixed with `/api/users`

## Authentication
All endpoints require authentication via Bearer token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Admin-Only Endpoints
The following endpoints require admin role:
- `POST /api/users` - Create user
- `PUT /api/users/:userId` - Update user
- `DELETE /api/users/:userId` - Delete user
- `POST /api/users/:userId/assign-sims` - Assign SIMs to user
- `GET /api/users` - Get all users

---

## Endpoints

### 1. Get All Users
**Endpoint:** `GET /api/users`  
**Authentication:** Required (Admin only)  
**Description:** Fetch all users in the system with their assigned SIMs

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "admin",
      "assignedSims": [
        {
          "_id": "sim_id",
          "phoneNumber": "+1234567890",
          "operator": "AT&T",
          "status": "active",
          "port": 1,
          "slot": 1
        }
      ],
      "createdBy": {
        "_id": "admin_user_id",
        "name": "Admin User",
        "email": "admin@example.com"
      },
      "isActive": true,
      "lastLogin": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 2. Create User
**Endpoint:** `POST /api/users`  
**Authentication:** Required (Admin only)  
**Description:** Create a new user

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword",
  "role": "user"
}
```

**Fields:**
- `name` (required): User's full name
- `email` (required): User's email address (must be unique)
- `password` (required): User's password (minimum 6 characters)
- `role` (optional): Either "user" or "admin" (defaults to "user")

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "isActive": true,
    "assignedSims": [],
    "createdBy": "admin_user_id",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `400`: Missing required fields or email already exists
- `403`: Not authorized (not admin)
- `500`: Server error

---

### 3. Update User
**Endpoint:** `PUT /api/users/:userId`  
**Authentication:** Required (Admin only)  
**Description:** Update user information

**URL Parameters:**
- `userId`: The ID of the user to update

**Request Body:**
```json
{
  "name": "John Doe Updated",
  "email": "john.updated@example.com",
  "role": "admin"
}
```

**Fields (all optional):**
- `name`: Updated name
- `email`: Updated email (must be unique if changed)
- `role`: Updated role ("user" or "admin")

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "user_id",
    "name": "John Doe Updated",
    "email": "john.updated@example.com",
    "role": "admin",
    "isActive": true,
    "assignedSims": [],
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `400`: Invalid role or email already in use
- `403`: Not authorized (not admin)
- `404`: User not found
- `500`: Server error

---

### 4. Delete User
**Endpoint:** `DELETE /api/users/:userId`  
**Authentication:** Required (Admin only)  
**Description:** Delete a user from the system

**URL Parameters:**
- `userId`: The ID of the user to delete

**Response:**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

**Error Responses:**
- `400`: Cannot delete own account
- `403`: Not authorized (not admin)
- `404`: User not found
- `500`: Server error

**Note:** Admins cannot delete their own account for security reasons.

---

### 5. Get All SIM Cards
**Endpoint:** `GET /api/users/sims/all`  
**Authentication:** Required  
**Description:** Fetch all available SIM cards in the system

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "sim_id",
      "phoneNumber": "+1234567890",
      "operator": "AT&T",
      "status": "active",
      "port": 1,
      "slot": 1,
      "imei": "123456789012345",
      "iccid": "89012345678901234567",
      "signalStrength": 85,
      "device": {
        "_id": "device_id",
        "name": "Device 1",
        "ipAddress": "192.168.1.100"
      }
    }
  ]
}
```

**Error Responses:**
- `401`: Not authenticated
- `500`: Server error

---

### 6. Assign SIMs to User
**Endpoint:** `POST /api/users/:userId/assign-sims`  
**Authentication:** Required (Admin only)  
**Description:** Assign SIM cards to a specific user

**URL Parameters:**
- `userId`: The ID of the user to assign SIMs to

**Request Body:**
```json
{
  "simIds": ["sim_id_1", "sim_id_2", "sim_id_3"]
}
```

**Fields:**
- `simIds` (required): Array of SIM card IDs to assign

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "assignedSims": [
      {
        "_id": "sim_id_1",
        "phoneNumber": "+1234567890",
        "operator": "AT&T",
        "status": "active",
        "port": 1,
        "slot": 1
      }
    ],
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `400`: Invalid simIds (must be non-empty array) or invalid SIM IDs
- `403`: Not authorized (not admin)
- `404`: User not found
- `500`: Server error

**Note:** This endpoint replaces all previously assigned SIMs with the new list.

---

### 7. Get User's Assigned SIMs
**Endpoint:** `GET /api/users/:userId/sims`  
**Authentication:** Required  
**Description:** Get SIM cards assigned to a specific user

**URL Parameters:**
- `userId`: The ID of the user

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "sim_id",
      "phoneNumber": "+1234567890",
      "operator": "AT&T",
      "status": "active",
      "port": 1,
      "slot": 1,
      "imei": "123456789012345",
      "iccid": "89012345678901234567",
      "signalStrength": 85,
      "device": "device_id"
    }
  ]
}
```

**Error Responses:**
- `401`: Not authenticated
- `403`: Regular users can only view their own SIMs
- `404`: User not found
- `500`: Server error

**Note:** Regular users can only view their own assigned SIMs. Admins can view any user's SIMs.

---

## Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "reason": "Error message describing what went wrong"
}
```

## Common HTTP Status Codes

- `200`: Success
- `201`: Created (for POST requests)
- `400`: Bad Request (validation errors, missing fields)
- `401`: Unauthorized (not authenticated)
- `403`: Forbidden (not admin when admin access required)
- `404`: Not Found (resource doesn't exist)
- `500`: Internal Server Error

---

## Usage Examples

### Example 1: Create a new user (Admin)
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane@example.com",
    "password": "securepass123",
    "role": "user"
  }'
```

### Example 2: Assign SIMs to user (Admin)
```bash
curl -X POST http://localhost:3000/api/users/USER_ID/assign-sims \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "simIds": ["sim_id_1", "sim_id_2"]
  }'
```

### Example 3: Get all users (Admin)
```bash
curl -X GET http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Example 4: Get my assigned SIMs (Any user)
```bash
curl -X GET http://localhost:3000/api/users/MY_USER_ID/sims \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Model Updates

### User Model
The User model has been updated with the following fields:

```javascript
assignedSims: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Sim'
}],
createdBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User'
}
```

- **assignedSims**: Stores references to SIM cards assigned to the user
- **createdBy**: Stores reference to the admin user who created this account


---

## Security Notes

1. **Password Security**: Passwords are automatically hashed using bcrypt before storage
2. **Admin Protection**: Admins cannot delete their own accounts
3. **Role Validation**: Only "user" and "admin" roles are accepted
4. **Email Uniqueness**: Email addresses must be unique across all users
5. **Token-based Auth**: All endpoints require valid JWT tokens
6. **Authorization Checks**: Regular users can only access their own data (except for viewing all SIMs)
7. **Audit Trail**: The `createdBy` field tracks which admin created each user account for accountability
