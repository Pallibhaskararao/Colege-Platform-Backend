const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { verifyJwtToken } = require('../middleware/auth');

const getExpirationDate = (notification) => {
  const createdAt = new Date(notification.createdAt);
  const expiryDays = notification.viewed ? 3 : 7;
  return new Date(createdAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);
};

const cleanupExpiredNotifications = async (io) => {
  try {
    const notifications = await Notification.find();
    const now = new Date();

    const expiredNotifications = notifications.filter(notification => {
      const expirationDate = getExpirationDate(notification);
      return now > expirationDate;
    });

    for (const notification of expiredNotifications) {
      await Notification.findByIdAndDelete(notification._id);
      io.emit('notificationDeleted', { notificationId: notification._id });
    }

    console.log(`Cleaned up ${expiredNotifications.length} expired notifications`);
  } catch (err) {
    console.error('Error cleaning up expired notifications:', err);
  }
};

module.exports = (ioInstance) => {
  setInterval(() => cleanupExpiredNotifications(ioInstance), 3600 * 1000);

  router.get('/', verifyJwtToken, async (req, res) => {
    try {
      const now = new Date();
      const notifications = await Notification.find({ user: req.userId });

      const validNotifications = notifications.filter(notification => {
        const expirationDate = getExpirationDate(notification);
        return now <= expirationDate;
      });

      res.json(validNotifications);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.put('/:id/read', verifyJwtToken, async (req, res) => {
    try {
      const notification = await Notification.findById(req.params.id);
      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }
      if (notification.user.toString() !== req.userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      notification.read = true;
      await notification.save();

      ioInstance.emit('notificationRead', { notificationId: notification._id });

      res.json(notification);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.put('/:id/viewed', verifyJwtToken, async (req, res) => {
    try {
      const notification = await Notification.findById(req.params.id);
      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }
      if (notification.user.toString() !== req.userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      notification.viewed = true;
      await notification.save();

      ioInstance.emit('notificationViewed', { notificationId: req.params.id });

      res.json({ message: 'Notification marked as viewed' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.put('/viewed', verifyJwtToken, async (req, res) => {
    try {
      const notifications = await Notification.find({ user: req.userId, viewed: false });
      for (const notification of notifications) {
        notification.viewed = true;
        await notification.save();
        ioInstance.emit('notificationViewed', { notificationId: notification._id });
      }

      res.json({ message: 'All notifications marked as viewed' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.delete('/:id', verifyJwtToken, async (req, res) => {
    try {
      const notification = await Notification.findById(req.params.id);
      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }
      if (notification.user.toString() !== req.userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }

      await Notification.findByIdAndDelete(req.params.id);
      ioInstance.emit('notificationDeleted', { notificationId: req.params.id });

      res.json({ message: 'Notification deleted' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  return router;
};