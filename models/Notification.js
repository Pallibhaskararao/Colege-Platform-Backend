const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: [
      'new_message',
      'new_group_message',
      'friend_request',
      'friend_request_accepted',
      'friend_request_declined',
      'like',
      'comment',
      'dislike',
      'ban_request',
      'ban_request_approved',
      'ban_request_rejected',
    ],
    required: true,
  },
  message: { type: String, required: true },
  relatedId: { type: mongoose.Schema.Types.ObjectId, required: false }, // Made optional
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Request' },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' }, // Added ref for clarity
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, // Added ref for clarity
  commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }, // Added ref for clarity
  banRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'BanRequest' }, // Added for ban requests
  count: { type: Number, default: 1 },
  read: { type: Boolean, default: false },
  viewed: { type: Boolean, default: false },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Notification', notificationSchema);