const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');
const Notification = require('../models/Notification');
const { verifyJwtToken } = require('../middleware/auth');

module.exports = (io) => {
  router.post('/', verifyJwtToken, async (req, res) => {
    const { receiverId, groupId, content } = req.body;

    try {
      const sender = await User.findById(req.userId);
      if (!sender) {
        return res.status(404).json({ message: 'Sender not found' });
      }

      let message;
      if (groupId) {
        const group = await Group.findById(groupId);
        if (!group) {
          return res.status(404).json({ message: 'Group not found' });
        }

        if (!group.members.includes(req.userId)) {
          return res.status(403).json({ message: 'You are not a member of this group' });
        }

        message = new Message({
          sender: req.userId,
          group: groupId,
          content,
        });

        await message.save();
        await message.populate('sender', 'name email');

        group.unreadCounts = group.members.map(memberId => {
          const existing = group.unreadCounts.find(uc => uc.user.toString() === memberId.toString()) || { count: 0 };
          return {
            user: memberId,
            count: memberId.toString() === req.userId ? 0 : existing.count + 1,
          };
        });
        await group.save();

        group.members.forEach(memberId => {
          io.to(memberId.toString()).emit('receiveMessage', {
            ...message.toObject(),
            isSentByMe: memberId.toString() === req.userId,
            groupId,
          });
        });

        for (const memberId of group.members) {
          if (memberId.toString() === req.userId) continue;

          let notification = await Notification.findOne({
            user: memberId,
            type: 'new_group_message',
            relatedId: group._id,
          });

          if (notification) {
            notification.count = (notification.count || 1) + 1;
            notification.message = `${notification.count} new message${notification.count > 1 ? 's' : ''} in group ${group.name} from ${sender.name}`;
            notification.messageId = message._id;
            notification.createdAt = new Date();
            await notification.save();
          } else {
            notification = new Notification({
              user: memberId,
              type: 'new_group_message',
              message: `New message in group ${group.name} from ${sender.name}`,
              relatedId: group._id,
              messageId: message._id,
              count: 1,
            });
            await notification.save();
          }

          io.to(memberId.toString()).emit('newNotification', notification);
        }

        res.status(201).json({
          ...message.toObject(),
          isSentByMe: true,
          groupId,
        });
      } else {
        const receiver = await User.findById(receiverId);
        if (!receiver) {
          return res.status(404).json({ message: 'Receiver not found' });
        }

        const isAcquaintance = sender.acquaintances.some(acquaintance => acquaintance._id.toString() === receiverId);
        const hasConversation = await Message.exists({
          $or: [
            { sender: req.userId, receiver: receiverId },
            { sender: receiverId, receiver: req.userId },
          ],
        });

        if (sender.role !== 'Faculty' && !isAcquaintance && !hasConversation) {
          return res.status(403).json({ message: 'You can only message acquaintances or reply to existing conversations' });
        }

        message = new Message({
          sender: req.userId,
          receiver: receiverId,
          content,
        });

        await message.save();
        await message.populate('sender receiver', 'name email');

        io.to(req.userId).emit('receiveMessage', {
          ...message.toObject(),
          isSentByMe: true,
        });
        io.to(receiverId).emit('receiveMessage', {
          ...message.toObject(),
          isSentByMe: false,
        });

        let notification = await Notification.findOne({
          user: receiverId,
          type: 'new_message',
          relatedId: sender._id,
        });

        if (notification) {
          notification.count = (notification.count || 1) + 1;
          notification.message = `You received ${notification.count} message${notification.count > 1 ? 's' : ''} from ${sender.name}`;
          notification.messageId = message._id;
          notification.createdAt = new Date();
          await notification.save();
        } else {
          notification = new Notification({
            user: receiverId,
            type: 'new_message',
            message: `New message from ${sender.name}`,
            relatedId: sender._id,
            messageId: message._id,
            count: 1,
          });
          await notification.save();
        }

        io.to(receiverId).emit('newNotification', notification);

        res.status(201).json({
          ...message.toObject(),
          isSentByMe: message.sender._id.toString() === req.userId,
        });
      }
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/conversations', verifyJwtToken, async (req, res) => {
    try {
      const user = await User.findById(req.userId).populate('acquaintances', 'name email');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      console.log('Fetching messages for user:', req.userId);
      const messages = await Message.find({
        $or: [
          { sender: req.userId },
          { receiver: req.userId },
        ],
      })
        .populate('sender receiver', 'name email')
        .sort({ createdAt: -1 });

      console.log('Messages found:', messages.map(msg => ({
        sender: msg.sender._id,
        receiver: msg.receiver?._id,
        content: msg.content,
      })));

      const conversationUsers = new Set();
      messages.forEach(message => {
        if (message.sender._id.toString() === req.userId) {
          if (message.receiver) {
            conversationUsers.add(message.receiver._id.toString());
          }
        } else {
          conversationUsers.add(message.sender._id.toString());
        }
      });

      console.log('Conversation users:', Array.from(conversationUsers));

      let usersToInclude;
      if (user.role === 'Faculty') {
        usersToInclude = await User.find({
          _id: { $in: Array.from(conversationUsers) },
        }).select('name email');
      } else {
        const acquaintanceIds = user.acquaintances.map(acquaintance => acquaintance._id.toString());
        const allUserIds = new Set([...acquaintanceIds, ...conversationUsers]);
        usersToInclude = await User.find({
          _id: { $in: Array.from(allUserIds) },
        }).select('name email');
      }

      console.log('Users to include:', usersToInclude.map(u => u._id));

      const conversations = await Promise.all(
        usersToInclude.map(async (acquaintance) => {
          const latestMessage = await Message.findOne({
            $or: [
              { sender: req.userId, receiver: acquaintance._id },
              { sender: acquaintance._id, receiver: req.userId },
            ],
          })
            .sort({ createdAt: -1 })
            .populate('sender receiver', 'name email');

          return {
            acquaintance,
            latestMessage: latestMessage
              ? {
                  content: latestMessage.content,
                  createdAt: latestMessage.createdAt,
                  sender: latestMessage.sender.name,
                  isSentByMe: latestMessage.sender._id.toString() === req.userId,
                }
              : null,
          };
        })
      );

      console.log('Returning conversations:', conversations.map(conv => ({
        acquaintanceId: conv.acquaintance._id,
        latestMessage: conv.latestMessage,
      })));

      res.json(conversations);
    } catch (err) {
      console.error('Error in /api/messages/conversations:', err);
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/history/:userId', verifyJwtToken, async (req, res) => {
    try {
      const user = await User.findById(req.userId);
      const otherUser = await User.findById(req.params.userId);

      if (!otherUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      const isAcquaintance = user.acquaintances.some(acquaintance => acquaintance._id.toString() === req.params.userId);
      const hasConversation = await Message.exists({
        $or: [
          { sender: req.userId, receiver: req.params.userId },
          { sender: req.params.userId, receiver: req.userId },
        ],
      });

      if (user.role !== 'Faculty' && !isAcquaintance && !hasConversation) {
        return res.status(403).json({ message: 'You can only view messages with acquaintances' });
      }

      console.log('Fetching message history for userId:', req.userId, 'with user:', req.params.userId);
      const messages = await Message.find({
        $or: [
          { sender: req.userId, receiver: req.params.userId },
          { sender: req.params.userId, receiver: req.userId },
        ],
      })
        .populate('sender receiver', 'name email')
        .sort({ createdAt: 1 });

      console.log('Messages found:', messages);
      const messagesWithSenderFlag = messages.map(message => ({
        ...message.toObject(),
        isSentByMe: message.sender._id.toString() === req.userId,
      }));

      res.json(messagesWithSenderFlag);
    } catch (err) {
      console.error('Error fetching message history:', err);
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/group-history/:groupId', verifyJwtToken, async (req, res) => {
    try {
      const group = await Group.findById(req.params.groupId);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      if (!group.members.includes(req.userId)) {
        return res.status(403).json({ message: 'You are not a member of this group' });
      }

      const messages = await Message.find({
        group: req.params.groupId,
      })
        .populate('sender', 'name email')
        .sort({ createdAt: 1 });

      const messagesWithSenderFlag = messages.map(message => ({
        ...message.toObject(),
        isSentByMe: message.sender._id.toString() === req.userId,
      }));

      res.json(messagesWithSenderFlag);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  return router;
};