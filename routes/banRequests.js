const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { verifyJwtToken } = require('../middleware/auth');
const BanRequest = require('../models/BanRequest');
const User = require('../models/User');
const Notification = require('../models/Notification');

module.exports = (io) => {
  router.post('/', verifyJwtToken, async (req, res) => {
    const { userToBan, reason, post } = req.body;

    try {
      if (!req.userId) {
        return res.status(401).json({ message: 'User ID not found in token' });
      }

      if (!mongoose.Types.ObjectId.isValid(req.userId)) {
        return res.status(400).json({ message: 'Invalid requester ID' });
      }
      if (!userToBan || !mongoose.Types.ObjectId.isValid(userToBan)) {
        return res.status(400).json({ message: 'Invalid user to ban ID' });
      }
      if (post && post !== 'null' && !mongoose.Types.ObjectId.isValid(post)) {
        return res.status(400).json({ message: 'Invalid post ID' });
      }

      console.log('Fetching requester with userId:', req.userId);
      const requester = await User.findById(req.userId);
      if (!requester) {
        return res.status(404).json({ message: 'Requester not found' });
      }
      if (requester.role !== 'Faculty') {
        return res.status(403).json({ message: 'Unauthorized: Faculty only' });
      }

      if (!reason || !reason.trim()) {
        return res.status(400).json({ message: 'Reason for the ban request is required' });
      }

      console.log('Fetching user to ban with userId:', userToBan);
      const user = await User.findById(userToBan);
      if (!user) {
        return res.status(404).json({ message: 'User to ban not found' });
      }

      console.log('Creating ban request with data:', { requester: req.userId, userToBan, reason, post });
      const banRequest = new BanRequest({
        requester: req.userId,
        userToBan,
        reason,
        post: post && post !== 'null' ? post : null,
      });

      await banRequest.save();
      console.log('Ban request saved with ID:', banRequest._id);

      console.log('Fetching admins with role: Admin');
      const admins = await User.find({ role: 'Admin' });
      if (admins.length === 0) {
        return res.status(404).json({ message: 'No admins found to notify' });
      }

      const notifications = admins.map((admin) => ({
        user: admin._id,
        type: 'ban_request',
        message: `${requester.name} has submitted a ban request for ${user.name}.`,
        banRequestId: banRequest._id,
        relatedId: userToBan,
      }));
      console.log('Creating notifications:', notifications);

      await Notification.insertMany(notifications);
      console.log('Notifications created successfully');

      if (io) {
        admins.forEach((admin) => {
          const notification = notifications.find((n) => n.user.toString() === admin._id.toString());
          console.log('Emitting notification to admin:', admin._id.toString());
          io.to(admin._id.toString()).emit('newNotification', notification);
        });
      } else {
        console.warn('Socket.IO instance (io) is not available. Skipping notification emission.');
      }

      res.status(201).json({ message: 'Ban request submitted successfully' });
    } catch (err) {
      console.error('Error creating ban request:', {
        message: err.message,
        stack: err.stack,
        requestBody: req.body,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to create ban request. Please try again.' });
    }
  });

  router.get('/all', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching admin with userId:', req.userId);
      const admin = await User.findById(req.userId);
      if (!admin || admin.role !== 'Admin') {
        return res.status(403).json({ message: 'Unauthorized: Admins only' });
      }

      console.log('Fetching all ban requests');
      const banRequests = await BanRequest.find()
        .populate('userToBan', 'name email')
        .populate('requester', 'name email')
        .sort({ createdAt: -1 });

      res.json(banRequests);
    } catch (err) {
      console.error('Error in /api/ban-requests/all:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to fetch ban requests' });
    }
  });

  router.get('/', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching admin with userId:', req.userId);
      const admin = await User.findById(req.userId);
      if (!admin || admin.role !== 'Admin') {
        return res.status(403).json({ message: 'Unauthorized: Admins only' });
      }

      console.log('Fetching pending ban requests');
      const banRequests = await BanRequest.find({ status: 'pending' })
        .populate('userToBan', 'name email')
        .populate('requester', 'name email')
        .sort({ createdAt: -1 });

      res.json(banRequests);
    } catch (err) {
      console.error('Error in /api/ban-requests:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
      });
      res.status(500).json({ message: 'Failed to fetch ban requests' });
    }
  });

  router.put('/:id/approve', verifyJwtToken, async (req, res) => {
    try {
      // Validate admin
      console.log('Fetching admin with userId:', req.userId);
      const admin = await User.findById(req.userId);
      if (!admin || admin.role !== 'Admin') {
        console.log('Unauthorized: Requester is not an admin', { userId: req.userId, role: admin?.role });
        return res.status(403).json({ message: 'Unauthorized: Admins only' });
      }

      // Fetch the ban request
      console.log('Fetching ban request with ID:', req.params.id);
      const banRequest = await BanRequest.findById(req.params.id)
        .populate('userToBan', 'name')
        .populate('requester', 'name');
      if (!banRequest) {
        console.log('Ban request not found:', req.params.id);
        return res.status(404).json({ message: 'Ban request not found' });
      }

      // Check if userToBan exists in the ban request
      if (!banRequest.userToBan) {
        console.warn('Ban request missing userToBan:', banRequest._id);
        return res.status(400).json({ message: 'Cannot approve ban request: User to ban is not specified' });
      }

      // Update the ban request status
      console.log('Updating ban request status to approved:', banRequest._id);
      await BanRequest.findByIdAndUpdate(
        req.params.id,
        { status: 'approved' },
        { new: true, runValidators: false }
      );

      // Ban the user
      console.log('Fetching user to ban with ID:', banRequest.userToBan._id);
      const user = await User.findById(banRequest.userToBan);
      if (!user) {
        console.log('User to ban not found:', banRequest.userToBan._id);
        return res.status(404).json({ message: 'User to ban not found' });
      }

      console.log('Current banned status before update:', user.banned);
      user.banned = true; // Use the correct field name
      console.log('Set banned to true, saving user...');
      await user.save();
      console.log(`User ${user._id} banned successfully, new banned status:`, user.banned);

      // Verify the update in the database
      const updatedUser = await User.findById(banRequest.userToBan).lean();
      console.log('Verified banned status in database:', updatedUser.banned);

      if (!updatedUser.banned) {
        console.error('Database update failed: banned is still false');
        return res.status(500).json({ message: 'Failed to update ban status in database' });
      }

      // Create a notification for the requester
      console.log('Creating notification for requester:', banRequest.requester._id);
      const notification = new Notification({
        user: banRequest.requester,
        type: 'ban_request_approved',
        message: `Your ban request for ${user.name} has been approved.`,
        banRequestId: banRequest._id,
        relatedId: banRequest.userToBan,
      });
      await notification.save();
      console.log('Notification created for requester:', banRequest.requester.toString());

      // Emit the notification
      if (io) {
        io.to(banRequest.requester.toString()).emit('newNotification', notification);
        console.log('Notification emitted to requester:', banRequest.requester.toString());
      } else {
        console.warn('Socket.IO instance (io) is not available. Skipping notification emission.');
      }

      res.json({ message: 'Ban request approved and user banned successfully' });
    } catch (err) {
      console.error('Error approving ban request:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
        banRequestId: req.params.id,
      });
      res.status(500).json({ message: 'Failed to approve ban request' });
    }
  });

  router.put('/:id/reject', verifyJwtToken, async (req, res) => {
    try {
      // Validate admin
      console.log('Fetching admin with userId:', req.userId);
      const admin = await User.findById(req.userId);
      if (!admin || admin.role !== 'Admin') {
        console.log('Unauthorized: Requester is not an admin', { userId: req.userId, role: admin?.role });
        return res.status(403).json({ message: 'Unauthorized: Admins only' });
      }

      // Fetch the ban request
      console.log('Fetching ban request with ID:', req.params.id);
      const banRequest = await BanRequest.findById(req.params.id)
        .populate('userToBan', 'name')
        .populate('requester', 'name');
      if (!banRequest) {
        console.log('Ban request not found:', req.params.id);
        return res.status(404).json({ message: 'Ban request not found' });
      }

      // Check if userToBan exists in the ban request
      if (!banRequest.userToBan) {
        console.warn('Ban request missing userToBan:', banRequest._id);
        // Update the status even if userToBan is missing, since rejecting doesn't require banning
        await BanRequest.findByIdAndUpdate(
          req.params.id,
          { status: 'rejected' },
          { new: true, runValidators: false }
        );
        return res.status(400).json({ message: 'Ban request rejected, but user to ban is not specified' });
      }

      // Update the ban request status
      console.log('Updating ban request status to rejected:', banRequest._id);
      await BanRequest.findByIdAndUpdate(
        req.params.id,
        { status: 'rejected' },
        { new: true, runValidators: false }
      );

      // Fetch the user for the notification
      console.log('Fetching user with ID for notification:', banRequest.userToBan._id);
      const user = await User.findById(banRequest.userToBan);
      if (!user) {
        console.log('User not found:', banRequest.userToBan._id);
        return res.status(404).json({ message: 'User not found' });
      }

      // Create a notification for the requester
      console.log('Creating notification for requester:', banRequest.requester._id);
      const notification = new Notification({
        user: banRequest.requester,
        type: 'ban_request_rejected',
        message: `Your ban request for ${user.name} has been rejected.`,
        banRequestId: banRequest._id,
        relatedId: banRequest.userToBan,
      });
      await notification.save();
      console.log('Notification created for requester:', banRequest.requester.toString());

      // Emit the notification
      if (io) {
        io.to(banRequest.requester.toString()).emit('newNotification', notification);
        console.log('Notification emitted to requester:', banRequest.requester.toString());
      } else {
        console.warn('Socket.IO instance (io) is not available. Skipping notification emission.');
      }

      res.json({ message: 'Ban request rejected successfully' });
    } catch (err) {
      console.error('Error rejecting ban request:', {
        message: err.message,
        stack: err.stack,
        userId: req.userId,
        banRequestId: req.params.id,
      });
      res.status(500).json({ message: 'Failed to reject ban request' });
    }
  });

  return router;
};