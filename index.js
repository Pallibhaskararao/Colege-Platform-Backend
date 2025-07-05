require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const Message = require('./models/Message');
const Notification = require('./models/Notification');
const User = require('./models/User');
const banRequestRoutes = require('./routes/banRequests');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files from the React app (for production)
app.use(express.static(path.join(__dirname, '../client/build')));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/users', require('./routes/users')(io));
app.use('/api/posts', require('./routes/posts')(io));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/skills', require('./routes/skills'));
app.use('/api/messages', require('./routes/messages')(io));
app.use('/api/notifications', require('./routes/notifications')(io));
app.use('/api/search', require('./routes/search'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/ban-requests', banRequestRoutes(io));

// Socket.IO Connection Handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User joins their own room based on userId
  socket.on('join', (userId) => {
    if (!userId) {
      console.warn('Join event received with no userId:', socket.id);
      return;
    }
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });

  // Handle sending messages
  socket.on('sendMessage', async (data) => {
    console.log('Received sendMessage:', data);
    const { senderId, receiverId, content, groupId } = data;

    try {
      if (!senderId || (!receiverId && !groupId) || !content) {
        console.warn('Invalid sendMessage data:', data);
        return;
      }

      const message = new Message({
        sender: senderId,
        content,
        ...(groupId ? { group: groupId } : { receiver: receiverId }),
      });

      await message.save();

      const populatedMessage = await Message.findById(message._id)
        .populate('sender', 'name profilePicture')
        .populate('receiver', 'name profilePicture')
        .populate('group', 'name');

      // Notify the recipient or group members
      if (groupId) {
        const group = await require('./models/Group').findById(groupId);
        if (group) {
          group.members.forEach((memberId) => {
            if (memberId.toString() !== senderId) {
              io.to(memberId.toString()).emit('newMessage', populatedMessage);
            }
          });

          // Create a group message notification
          const notification = new Notification({
            user: group.members.filter((id) => id.toString() !== senderId),
            type: 'new_group_message',
            message: `New message in group ${group.name}`,
            relatedId: groupId,
            messageId: message._id,
            senderId,
          });
          await notification.save();

          group.members.forEach((memberId) => {
            if (memberId.toString() !== senderId) {
              io.to(memberId.toString()).emit('newNotification', notification);
            }
          });
        }
      } else {
        io.to(receiverId).emit('newMessage', populatedMessage);

        // Create a direct message notification
        const sender = await User.findById(senderId);
        const notification = new Notification({
          user: receiverId,
          type: 'new_message',
          message: `${sender.name} sent you a message`,
          relatedId: senderId,
          messageId: message._id,
          senderId,
        });
        await notification.save();

        io.to(receiverId).emit('newNotification', notification);
      }
    } catch (err) {
      console.error('Error handling sendMessage:', {
        message: err.message,
        stack: err.stack,
        data,
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Watch for notification deletions
const notificationChangeStream = Notification.watch();
notificationChangeStream.on('change', (change) => {
  if (change.operationType === 'delete') {
    const deletedNotificationId = change.documentKey._id;
    console.log('Notification deleted, broadcasting:', deletedNotificationId);
    io.emit('notificationDeleted', { notificationId: deletedNotificationId });
  }
});

// Handle React routing, return all requests to React app (for production)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ message: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));