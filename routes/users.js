const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Request = require('../models/Request');
const Notification = require('../models/Notification');
const { verifyJwtToken } = require('../middleware/auth');
const upload = require('../middleware/upload');

module.exports = (ioInstance) => {
  const router = express.Router();
  global.io = ioInstance;

  // Profile picture upload endpoint
  router.put('/profile-picture', verifyJwtToken, upload.single('profilePicture'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const filePath = `/uploads/profile_pics/${req.file.filename}`;
      const user = await User.findByIdAndUpdate(
        req.userId,
        { profilePicture: filePath },
        { new: true }
      )
        .populate('branch')
        .populate('skills')
        .populate('acquaintances');

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json(user);
    } catch (err) {
      console.error('Error uploading profile picture:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to upload profile picture' });
    }
  });

  // Register a new user
  router.post('/register', async (req, res) => {
    const { name, email, password, branch, skills } = req.body;

    try {
      if (!name || !email || !password) {
        return res.status(400).json({ message: 'Name, email, and password are required' });
      }

      let user = await User.findOne({ email });
      if (user) {
        return res.status(400).json({ message: 'User already exists' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      user = new User({
        name,
        email,
        password: hashedPassword,
        branch,
        skills,
      });

      await user.save();

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      res.status(201).json({ token, userId: user._id });
    } catch (err) {
      console.error('Error in /api/users/register:', {
        message: err.message,
        stack: err.stack,
        requestBody: req.body,
      });
      res.status(500).json({ message: 'Failed to register user' });
    }
  });

 // Login a user
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      console.log('Missing email or password:', { email, passwordProvided: !!password });
      return res.status(400).json({ message: 'Email and password are required' });
    }

    console.log('Fetching user with email:', email);
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found with email:', email);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    console.log('User found:', user._id, 'Checking ban status...');
    console.log('User banned status:', user.banned);
    if (user.banned) {
      console.log('Login attempt blocked: User is banned:', user._id);
      return res.status(403).json({ message: 'Account is banned' });
    }

    console.log('Comparing password for user:', user._id);
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Password mismatch for user:', user._id);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    console.log('Password matched, generating token for user:', user._id);
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    console.log('Login successful for user:', user._id);
    res.json({ token, userId: user._id });
  } catch (err) {
    console.error('Error in /api/auth/login:', {
      message: err.message,
      stack: err.stack,
      requestBody: req.body,
    });
    res.status(500).json({ message: 'Failed to login' });
  }
});

  // Get all users (Admin only)
  router.get('/', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching admin with userId:', req.userId);
      const admin = await User.findById(req.userId);
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }
      if (admin.role !== 'Admin') {
        return res.status(403).json({ message: 'Unauthorized: Admins only' });
      }

      console.log('Fetching all users');
      const users = await User.find().select('-password');
      res.json(users);
    } catch (err) {
      console.error('Error in /api/users:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });

  // Get all admins
  router.get('/admins', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching admins');
      const admins = await User.find({ role: 'Admin' }).select('name email profilePicture');
      res.json(admins);
    } catch (err) {
      console.error('Error in /api/users/admins:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to fetch admins' });
    }
  });

  // Create a faculty account (Admin only)
  router.post('/create-faculty', verifyJwtToken, async (req, res) => {
    const { name, email, password } = req.body;

    try {
      const admin = await User.findById(req.userId);
      if (!admin || admin.role !== 'Admin') {
        return res.status(403).json({ message: 'Unauthorized: Admins only' });
      }

      if (!name || !email || !password) {
        return res.status(400).json({ message: 'Name, email, and password are required' });
      }

      let user = await User.findOne({ email });
      if (user) {
        return res.status(400).json({ message: 'User already exists' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      user = new User({
        name,
        email,
        password: hashedPassword,
        role: 'Faculty',
      });

      await user.save();
      res.status(201).json({ message: 'Faculty account created successfully' });
    } catch (err) {
      console.error('Error in /api/users/create-faculty:', {
        message: err.message,
        stack: err.stack,
        requestBody: req.body,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to create faculty account' });
    }
  });
// Ban a user (Admin only)
router.put('/:id/ban', verifyJwtToken, async (req, res) => {
  try {
    console.log('Attempting to ban user with ID:', req.params.id);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log('Invalid user ID:', req.params.id);
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    console.log('Fetching admin with userId:', req.userId);
    const admin = await User.findById(req.userId);
    if (!admin || admin.role !== 'Admin') {
      console.log('Unauthorized: Requester is not an admin', { userId: req.userId, role: admin?.role });
      return res.status(403).json({ message: 'Unauthorized: Admins only' });
    }

    console.log('Fetching user to ban with ID:', req.params.id);
    const user = await User.findById(req.params.id);
    if (!user) {
      console.log('User not found with ID:', req.params.id);
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'Admin') {
      console.log('Cannot ban an admin:', req.params.id);
      return res.status(400).json({ message: 'Cannot ban an admin' });
    }

    console.log('Current banned status before update:', user.banned);
    user.banned = true; // Use the correct field name
    console.log('Set banned to true, saving user...');
    try {
      await user.save();
    } catch (saveErr) {
      console.error('Error saving user during ban:', {
        message: saveErr.message,
        stack: saveErr.stack,
      });
      return res.status(500).json({ message: 'Failed to save user during ban' });
    }
    console.log('User saved successfully, new banned status:', user.banned);

    // Verify the update in the database
    const updatedUser = await User.findById(req.params.id).lean();
    console.log('Verified banned status in database:', updatedUser.banned);

    if (!updatedUser.banned) {
      console.error('Database update failed: banned is still false');
      return res.status(500).json({ message: 'Failed to update ban status in database' });
    }

    res.json({ message: 'User banned successfully' });
  } catch (err) {
    console.error('Error in /api/users/:id/ban:', {
      message: err.message,
      stack: err.stack,
      userId: req.userId,
      targetUserId: req.params.id,
    });
    res.status(500).json({ message: 'Failed to ban user' });
  }
});

// Unban a user (Admin only)
router.put('/:id/unban', verifyJwtToken, async (req, res) => {
  try {
    console.log('Attempting to unban user with ID:', req.params.id);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log('Invalid user ID:', req.params.id);
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    console.log('Fetching admin with userId:', req.userId);
    const admin = await User.findById(req.userId);
    if (!admin || admin.role !== 'Admin') {
      console.log('Unauthorized: Requester is not an admin', { userId: req.userId, role: admin?.role });
      return res.status(403).json({ message: 'Unauthorized: Admins only' });
    }

    console.log('Fetching user to unban with ID:', req.params.id);
    const user = await User.findById(req.params.id);
    if (!user) {
      console.log('User not found with ID:', req.params.id);
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('Current banned status before update:', user.banned);
    user.banned = false; // Use the correct field name
    console.log('Set banned to false, saving user...');
    try {
      await user.save();
    } catch (saveErr) {
      console.error('Error saving user during unban:', {
        message: saveErr.message,
        stack: saveErr.stack,
      });
      return res.status(500).json({ message: 'Failed to save user during unban' });
    }
    console.log('User saved successfully, new banned status:', user.banned);

    // Verify the update in the database
    const updatedUser = await User.findById(req.params.id).lean();
    console.log('Verified banned status in database:', updatedUser.banned);

    if (updatedUser.banned) {
      console.error('Database update failed: banned is still true');
      return res.status(500).json({ message: 'Failed to update unban status in database' });
    }

    res.json({ message: 'User unbanned successfully' });
  } catch (err) {
    console.error('Error in /api/users/:id/unban:', {
      message: err.message,
      stack: err.stack,
      userId: req.userId,
      targetUserId: req.params.id,
    });
    res.status(500).json({ message: 'Failed to unban user' });
  }
});

  // Admin login
  router.post('/admin-login', async (req, res) => {
    const { email, password } = req.body;

    try {
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      if (user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied: Admins only' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      res.json({ token, userId: user._id });
    } catch (err) {
      console.error('Error in /api/users/admin-login:', {
        message: err.message,
        stack: err.stack,
        requestBody: req.body,
      });
      res.status(500).json({ message: 'Failed to login as admin' });
    }
  });

  // Get the authenticated user's profile
  router.get('/profile', verifyJwtToken, async (req, res) => {
    try {
      const user = await User.findById(req.userId)
        .populate('branch')
        .populate('skills')
        .populate('acquaintances')
        .populate({ path: 'pendingRequests.from', strictPopulate: false })
        .select('-password');

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json(user);
    } catch (err) {
      console.error('Error in /api/users/profile:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to fetch profile' });
    }
  });

  // Remove an acquaintance
  router.delete('/acquaintances/:acquaintanceId', verifyJwtToken, async (req, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ message: 'User not authenticated' });
      }

      if (!mongoose.Types.ObjectId.isValid(req.params.acquaintanceId)) {
        return res.status(400).json({ message: 'Invalid acquaintance ID' });
      }

      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (!user.acquaintances.includes(req.params.acquaintanceId)) {
        return res.status(400).json({ message: 'Acquaintance not found in your list' });
      }

      const acquaintance = await User.findById(req.params.acquaintanceId);
      if (!acquaintance) {
        return res.status(404).json({ message: 'Acquaintance not found' });
      }

      user.acquaintances = user.acquaintances.filter(
        (id) => id.toString() !== req.params.acquaintanceId
      );

      acquaintance.acquaintances = acquaintance.acquaintances.filter(
        (id) => id.toString() !== req.userId
      );

      await user.save();
      await acquaintance.save();

      const updatedUser = await User.findById(req.userId)
        .populate('branch')
        .populate('skills')
        .populate('acquaintances')
        .populate({ path: 'pendingRequests.from', strictPopulate: false })
        .select('-password');

      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found after update' });
      }

      res.json({ message: 'Acquaintance removed successfully', user: updatedUser });
    } catch (err) {
      console.error('Error removing acquaintance:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
        acquaintanceId: req.params.acquaintanceId,
      });
      res.status(500).json({ message: 'Failed to remove acquaintance' });
    }
  });

  // Update the authenticated user's profile
  router.put('/profile', verifyJwtToken, async (req, res) => {
    try {
      const updates = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.email) updates.email = req.body.email;
      if (req.body.bio) updates.bio = req.body.bio;

      if (req.body.branch) {
        if (!mongoose.Types.ObjectId.isValid(req.body.branch)) {
          return res.status(400).json({ message: 'Invalid branch ID' });
        }
        updates.branch = req.body.branch;
      } else if (req.body.branch === '') {
        updates.branch = null;
      }

      if (req.body.skills) {
        updates.skills = req.body.skills;
        if (!Array.isArray(updates.skills)) {
          updates.skills = JSON.parse(req.body.skills);
        }
      }

      const user = await User.findByIdAndUpdate(req.userId, updates, { new: true })
        .populate('branch')
        .populate('skills')
        .populate('acquaintances');

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json(user);
    } catch (err) {
      console.error('Error updating profile:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
        requestBody: req.body,
      });
      res.status(500).json({ message: 'Failed to update profile' });
    }
  });

  // Get sent friend requests
  router.get('/requests/sent', verifyJwtToken, async (req, res) => {
    try {
      const requests = await Request.find({ from: req.userId })
        .populate('to', 'name email profilePicture');
      res.json(requests);
    } catch (err) {
      console.error('Error in /api/users/requests/sent:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to fetch sent requests' });
    }
  });

  // Send a friend request
  router.post('/requests/:id', verifyJwtToken, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid recipient ID' });
      }

      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const toUser = await User.findById(req.params.id);
      if (!toUser) {
        return res.status(404).json({ message: 'Recipient not found' });
      }

      if (req.userId === req.params.id) {
        return res.status(400).json({ message: 'Cannot send request to yourself' });
      }

      const existingRequest = await Request.findOne({
        from: req.userId,
        to: req.params.id,
        status: 'pending',
      });
      if (existingRequest) {
        return res.status(400).json({ message: 'Request already sent' });
      }

      const existingAcquaintance = user.acquaintances.includes(req.params.id);
      if (existingAcquaintance) {
        return res.status(400).json({ message: 'Already acquaintances' });
      }

      const request = new Request({
        from: req.userId,
        to: req.params.id,
      });
      await request.save();
      console.log('Request saved with ID:', request._id);

      let notification = await Notification.findOne({
        user: req.params.id,
        type: 'friend_request',
        relatedId: req.userId,
      });

      if (notification) {
        notification.message = `${user.name} sent you a friend request`;
        notification.requestId = request._id;
        notification.count = (notification.count || 1) + 1;
        notification.createdAt = Date.now();
        await notification.save();
        console.log('Updated existing notification:', {
          _id: notification._id,
          user: notification.user,
          relatedId: notification.relatedId,
          requestId: notification.requestId,
          count: notification.count,
        });
      } else {
        notification = new Notification({
          user: req.params.id,
          type: 'friend_request',
          message: `${user.name} sent you a friend request`,
          relatedId: req.userId, // relatedId is the sender of the friend request
          requestId: request._id,
          senderId: req.userId,
        });
        await notification.save();
        console.log('Created new notification:', {
          _id: notification._id,
          user: notification.user,
          relatedId: notification.relatedId,
          requestId: notification.requestId,
          senderId: notification.senderId,
        });
      }

      console.log('Created request:', {
        _id: request._id,
        from: request.from,
        to: request.to,
      });

      ioInstance.to(req.params.id).emit('newNotification', notification);

      res.status(201).json({ message: 'Friend request sent' });
    } catch (err) {
      console.error('Error sending friend request:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
        recipientId: req.params.id,
      });
      res.status(500).json({ message: 'Failed to send friend request' });
    }
  });

  // Accept a friend request
  router.put('/requests/:id/accept', verifyJwtToken, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid request ID' });
      }

      const request = await Request.findById(req.params.id);
      if (!request) {
        return res.status(404).json({ message: 'Request not found' });
      }

      if (request.to.toString() !== req.userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }

      console.log('Accepting request:', request);

      request.status = 'accepted';
      await request.save();

      const fromUser = await User.findById(request.from);
      const toUser = await User.findById(request.to);

      fromUser.acquaintances.push(toUser._id);
      toUser.acquaintances.push(fromUser._id);

      await fromUser.save();
      await toUser.save();

      console.log('Looking for notification to delete:', {
        user: req.userId,
        type: 'friend_request',
        relatedId: request.from.toString(),
      });

      const notification = await Notification.findOne({
        user: req.userId,
        type: 'friend_request',
        relatedId: request.from.toString(),
      });

      if (notification) {
        console.log('Found notification to delete:', notification);
        const deleteResult = await Notification.deleteOne({ _id: notification._id });
        console.log('Notification deletion result:', deleteResult);
        ioInstance.to(req.userId).emit('notificationDeleted', { notificationId: notification._id });
      } else {
        console.log('No notification found to delete');
      }

      console.log('Deleting request:', req.params.id);
      const deletedRequest = await Request.deleteOne({ _id: req.params.id });
      console.log('Request deletion result:', deletedRequest);

      const notificationForSender = new Notification({
        user: request.from,
        type: 'friend_request_accepted',
        message: `${toUser.name} accepted your friend request`,
        relatedId: toUser._id, // relatedId is the user who accepted the request
      });
      await notificationForSender.save();

      ioInstance.to(request.from.toString()).emit('newNotification', notificationForSender);

      const updatedUser = await User.findById(req.userId)
        .populate('branch')
        .populate('skills')
        .populate('acquaintances');

      res.json(updatedUser);
    } catch (err) {
      console.error('Error in /api/users/requests/:id/accept:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
        requestId: req.params.id,
      });
      res.status(500).json({ message: 'Failed to accept friend request' });
    }
  });

  // Decline a friend request
  router.put('/requests/:id/decline', verifyJwtToken, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid request ID' });
      }

      const request = await Request.findById(req.params.id);
      if (!request) {
        return res.status(404).json({ message: 'Request not found' });
      }

      if (request.to.toString() !== req.userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }

      console.log('Declining request:', request);

      request.status = 'declined';
      await request.save();

      const fromUser = await User.findById(request.from);
      const toUser = await User.findById(request.to);

      console.log('Looking for notification to delete:', {
        user: req.userId,
        type: 'friend_request',
        relatedId: request.from.toString(),
      });

      const notification = await Notification.findOne({
        user: req.userId,
        type: 'friend_request',
        relatedId: request.from.toString(),
      });

      if (notification) {
        console.log('Found notification to delete:', notification);
        const deleteResult = await Notification.deleteOne({ _id: notification._id });
        console.log('Notification deletion result:', deleteResult);
        ioInstance.to(req.userId).emit('notificationDeleted', { notificationId: notification._id });
      } else {
        console.log('No notification found to delete');
      }

      console.log('Deleting request:', req.params.id);
      const deletedRequest = await Request.deleteOne({ _id: req.params.id });
      console.log('Request deletion result:', deletedRequest);

      const notificationForSender = new Notification({
        user: request.from,
        type: 'friend_request_declined',
        message: `${toUser.name} declined your friend request`,
        relatedId: toUser._id, // relatedId is the user who declined the request
      });
      await notificationForSender.save();

      ioInstance.to(request.from.toString()).emit('newNotification', notificationForSender);

      const updatedUser = await User.findById(req.userId)
        .populate('branch')
        .populate('skills')
        .populate('acquaintances');

      res.json(updatedUser);
    } catch (err) {
      console.error('Error in /api/users/requests/:id/decline:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
        requestId: req.params.id,
      });
      res.status(500).json({ message: 'Failed to decline friend request' });
    }
  });

  // Get user recommendations
  router.get('/recommendations', verifyJwtToken, async (req, res) => {
    try {
      const user = await User.findById(req.userId).populate('branch skills');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const recommendedUsers = await User.find({
        $or: [
          { branch: user.branch },
          { skills: { $in: user.skills } },
        ],
        _id: { $ne: req.userId },
        acquaintances: { $nin: [req.userId] },
      })
        .select('name email branch skills bio profilePicture')
        .limit(5);

      res.json(recommendedUsers);
    } catch (err) {
      console.error('Error in /api/users/recommendations:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to fetch recommendations' });
    }
  });

  // Get a user's profile by ID
  router.get('/:id', verifyJwtToken, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid user ID' });
      }

      const user = await User.findById(req.params.id)
        .populate('branch')
        .populate('skills')
        .populate('acquaintances')
        .select('-password');

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json(user);
    } catch (err) {
      console.error('Error in /api/users/:id:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
        targetUserId: req.params.id,
      });
      res.status(500).json({ message: 'Failed to fetch user profile' });
    }
  });

  return router;
};