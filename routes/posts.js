const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { verifyJwtToken } = require('../middleware/auth');
const mongoose = require('mongoose');

module.exports = (io) => {
  router.post('/', verifyJwtToken, async (req, res) => {
    const { title, description, tags } = req.body;

    try {
      // Validate req.userId
      if (!req.userId) {
        console.log('User not authenticated');
        return res.status(401).json({ message: 'User not authenticated' });
      }

      // Check if user is banned
      const user = await User.findById(req.userId);
      if (!user) {
        console.log('User not found:', req.userId);
        return res.status(404).json({ message: 'User not found' });
      }
      if (user.banned) {
        console.log('User is banned:', req.userId);
        return res.status(403).json({ message: 'You are banned and cannot create posts' });
      }

      // Validate input
      if (!title || !title.trim()) {
        console.log('Title is required');
        return res.status(400).json({ message: 'Title is required' });
      }
      if (!description || !description.trim()) {
        console.log('Description is required');
        return res.status(400).json({ message: 'Description is required' });
      }
      if (!Array.isArray(tags)) {
        console.log('Tags must be an array');
        return res.status(400).json({ message: 'Tags must be an array' });
      }

      console.log('Creating new post with data:', { title, description, tags, author: req.userId });
      const post = new Post({
        title,
        description,
        tags,
        author: req.userId,
      });

      await post.save();
      console.log('Post saved with ID:', post._id);

      console.log('Populating author with fields: name, email, profilePicture');
      await post.populate('author', 'name email profilePicture');
      res.status(201).json(post);
    } catch (err) {
      console.error('Error in /api/posts POST:', {
        message: err.message,
        stack: err.stack,
        requestBody: req.body,
      });
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching all posts');
      const posts = await Post.find()
        .populate('author', 'name email profilePicture') // Include profilePicture
        .populate('comments.user', 'name profilePicture') // Include profilePicture for commenters
        .sort({ createdAt: -1 }); // Sort by creation date
      console.log('Posts fetched:', posts.length);
      res.json(posts);
    } catch (err) {
      console.error('Error in /api/posts GET:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

  router.post('/:id/like', verifyJwtToken, async (req, res) => {
    try {
      console.log('Like endpoint called for post:', req.params.id, 'by user:', req.userId);

      // Validate req.userId
      if (!req.userId) {
        console.log('User not authenticated');
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const post = await Post.findById(req.params.id);
      if (!post) {
        console.log('Post not found:', req.params.id);
        return res.status(404).json({ message: 'Post not found' });
      }
      console.log('Post found:', post._id);

      const user = await User.findById(req.userId);
      if (!user) {
        console.log('User not found:', req.userId);
        return res.status(404).json({ message: 'User not found' });
      }
      console.log('User found:', user._id, 'Name:', user.name);

      // Check if user is banned
      if (user.banned) {
        console.log('User is banned:', req.userId);
        return res.status(403).json({ message: 'You are banned and cannot like posts' });
      }

      // Ensure likes and dislikes are arrays
      if (!Array.isArray(post.likes)) {
        post.likes = [];
      }
      if (!Array.isArray(post.dislikes)) {
        post.dislikes = [];
      }

      // Convert req.userId to ObjectId for comparison
      const userId = new mongoose.Types.ObjectId(req.userId);
      const userIndex = post.likes.findIndex((id) => id.toString() === userId.toString());
      if (userIndex === -1) {
        post.likes.push(userId);
        // Remove the user from dislikes if they like the post
        post.dislikes = post.dislikes.filter((id) => id.toString() !== userId.toString());

        if (post.author.toString() !== req.userId) {
          const notification = new Notification({
            user: post.author,
            type: 'like',
            message: `${user.name} liked your post`,
            relatedId: req.userId,
            postId: post._id,
          });
          await notification.save();
          io.to(post.author.toString()).emit('newNotification', notification);
        }
      } else {
        post.likes.splice(userIndex, 1);
      }

      await post.save();

      // Populate with error handling
      await post.populate({ path: 'author', select: 'name email profilePicture', options: { strictPopulate: false } }).catch((err) => {
        console.error('Error populating author:', err);
      });
      await post.populate({ path: 'comments.user', select: 'name profilePicture', options: { strictPopulate: false } }).catch((err) => {
        console.error('Error populating comments.user:', err);
      });

      res.json({ ...post.toObject(), dislikes: post.dislikes || [] });
    } catch (err) {
      console.error('Error in /api/posts/:id/like:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: 'Error liking post', error: err.message });
    }
  });

  router.post('/:id/dislike', verifyJwtToken, async (req, res) => {
    try {
      console.log('Dislike endpoint called for post:', req.params.id, 'by user:', req.userId);

      // Validate req.userId
      if (!req.userId) {
        console.log('User not authenticated');
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const post = await Post.findById(req.params.id);
      if (!post) {
        console.log('Post not found:', req.params.id);
        return res.status(404).json({ message: 'Post not found' });
      }
      console.log('Post found:', post._id);

      const user = await User.findById(req.userId);
      if (!user) {
        console.log('User not found:', req.userId);
        return res.status(404).json({ message: 'User not found' });
      }
      console.log('User found:', user._id, 'Name:', user.name);

      // Check if user is banned
      if (user.banned) {
        console.log('User is banned:', req.userId);
        return res.status(403).json({ message: 'You are banned and cannot dislike posts' });
      }

      // Initialize dislikes if undefined
      if (!Array.isArray(post.dislikes)) {
        console.log('Initializing post.dislikes as empty array');
        post.dislikes = [];
      }

      // Convert req.userId to ObjectId for comparison
      const userId = new mongoose.Types.ObjectId(req.userId);
      console.log('User ID as ObjectId:', userId);

      const userIndex = post.dislikes.findIndex((id) => id.toString() === userId.toString());
      console.log('User index in dislikes:', userIndex);

      if (userIndex === -1) {
        console.log('Adding user to dislikes');
        post.dislikes.push(userId);

        // Remove the user from likes if they dislike the post
        console.log('Removing user from likes if present');
        post.likes = post.likes.filter((id) => id.toString() !== userId.toString());

        if (post.author.toString() !== req.userId) {
          console.log('Creating notification for author:', post.author);
          const userName = user.name || 'Anonymous';
          const notification = new Notification({
            user: post.author,
            type: 'dislike',
            message: `${userName} disliked your post`,
            relatedId: req.userId,
            postId: post._id,
          });
          await notification.save();
          console.log('Notification saved:', notification._id);

          console.log('Emitting notification to author:', post.author.toString());
          io.to(post.author.toString()).emit('newNotification', notification);
        }
      } else {
        console.log('Removing user from dislikes');
        post.dislikes.splice(userIndex, 1);
      }

      console.log('Saving post');
      await post.save();

      // Populate with error handling
      console.log('Populating author');
      await post.populate({ path: 'author', select: 'name email profilePicture', options: { strictPopulate: false } }).catch((err) => {
        console.error('Error populating author:', err);
      });
      console.log('Populating comments.user');
      await post.populate({ path: 'comments.user', select: 'name profilePicture', options: { strictPopulate: false } }).catch((err) => {
        console.error('Error populating comments.user:', err);
      });

      console.log('Sending response');
      res.json({ ...post.toObject(), dislikes: post.dislikes || [] });
    } catch (err) {
      console.error('Error in /api/posts/:id/dislike:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: 'Error disliking post', error: err.message });
    }
  });

  router.post('/:id/comment', verifyJwtToken, async (req, res) => {
    try {
      console.log('Comment endpoint called for post:', req.params.id, 'by user:', req.userId);

      // Validate req.userId
      if (!req.userId) {
        console.log('User not authenticated');
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const post = await Post.findById(req.params.id);
      if (!post) {
        console.log('Post not found:', req.params.id);
        return res.status(404).json({ message: 'Post not found' });
      }

      const user = await User.findById(req.userId);
      if (!user) {
        console.log('User not found:', req.userId);
        return res.status(404).json({ message: 'User not found' });
      }

      // Check if user is banned
      if (user.banned) {
        console.log('User is banned:', req.userId);
        return res.status(403).json({ message: 'You are banned and cannot comment on posts' });
      }

      const { text } = req.body;
      if (!text || text.trim() === '') {
        console.log('Comment text is required');
        return res.status(400).json({ message: 'Comment text is required' });
      }

      // Add the comment to the post
      post.comments.push({
        user: req.userId,
        text: text.trim(),
        createdAt: new Date(),
      });

      await post.save();

      // Create a notification for the post author (if the commenter is not the author)
      if (post.author.toString() !== req.userId) {
        const userName = user.name || 'Anonymous';
        const notification = new Notification({
          user: post.author,
          type: 'comment',
          message: `${userName} commented on your post`,
          relatedId: req.userId,
          postId: post._id,
          commentId: post.comments[post.comments.length - 1]._id,
        });
        await notification.save();
        io.to(post.author.toString()).emit('newNotification', notification);
      }

      // Populate the post with author and comment user details
      await post.populate({ path: 'author', select: 'name email profilePicture', options: { strictPopulate: false } }).catch((err) => {
        console.error('Error populating author:', err);
      });
      await post.populate({ path: 'comments.user', select: 'name profilePicture', options: { strictPopulate: false } }).catch((err) => {
        console.error('Error populating comments.user:', err);
      });

      res.json({ ...post.toObject(), dislikes: post.dislikes || [] });
    } catch (err) {
      console.error('Error in /api/posts/:id/comment:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: 'Error adding comment', error: err.message });
    }
  });

  router.get('/search', verifyJwtToken, async (req, res) => {
    const { query } = req.query;
    try {
      console.log('Searching posts with query:', query);
      const posts = await Post.find({
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } },
          { tags: { $regex: query, $options: 'i' } },
        ],
      })
        .populate('author', 'name email profilePicture')
        .populate('comments.user', 'name profilePicture')
        .sort({ createdAt: -1 });
      console.log('Found posts:', posts.length);
      res.json(posts);
    } catch (err) {
      console.error('Error in /api/posts/search:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/user/me', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching posts for user:', req.userId);
      const posts = await Post.find({ author: req.userId })
        .populate('author', 'name email profilePicture')
        .populate('comments.user', 'name profilePicture')
        .sort({ createdAt: -1 });
      console.log('Found posts:', posts.length);
      res.json(posts);
    } catch (err) {
      console.error('Error in /api/posts/user/me:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/user/:id', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching posts for user:', req.params.id);
      const posts = await Post.find({ author: req.params.id })
        .populate('author', 'name email profilePicture')
        .populate('comments.user', 'name profilePicture')
        .sort({ createdAt: -1 });
      console.log('Found posts:', posts.length);
      res.json(posts);
    } catch (err) {
      console.error('Error in /api/posts/user/:id:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/recommendations', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching user for recommendations:', req.userId);
      const user = await User.findById(req.userId);
      if (!user) {
        console.log('User not found:', req.userId);
        return res.status(404).json({ message: 'User not found' });
      }

      console.log('Fetching recommended posts for user:', req.userId);
      const recommendedPosts = await Post.find({
        $or: [
          { branch: user.branch },
          { tags: { $in: user.skills } },
        ],
      })
        .populate('author', 'name email profilePicture')
        .populate('comments.user', 'name profilePicture')
        .sort({ createdAt: -1 })
        .limit(5);
      console.log('Found recommended posts:', recommendedPosts.length);
      res.json(recommendedPosts);
    } catch (err) {
      console.error('Error in /api/posts/recommendations:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/by-tag/:tag', verifyJwtToken, async (req, res) => {
    try {
      const tag = req.params.tag;
      console.log('Fetching posts by tag:', tag);
      const posts = await Post.find({ tags: tag })
        .populate('author', 'name email profilePicture')
        .populate('comments.user', 'name profilePicture')
        .sort({ createdAt: -1 });
      console.log('Found posts:', posts.length);
      res.json(posts);
    } catch (err) {
      console.error('Error in /api/posts/by-tag/:tag:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

  router.delete('/:id', verifyJwtToken, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        console.log('Invalid post ID:', req.params.id);
        return res.status(400).json({ message: 'Invalid post ID' });
      }

      if (!req.userId) {
        console.log('User not authenticated');
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const post = await Post.findById(req.params.id);
      if (!post) {
        console.log('Post not found:', req.params.id);
        return res.status(404).json({ message: 'Post not found' });
      }

      const user = await User.findById(req.userId);
      if (!user) {
        console.log('User not found:', req.userId);
        return res.status(404).json({ message: 'User not found' });
      }

      const isAuthor = post.author.toString() === req.userId;
      const isAdmin = user.role === 'Admin';

      if (!isAuthor && !isAdmin) {
        console.log('Unauthorized: User is neither author nor admin', { userId: req.userId, postAuthor: post.author });
        return res.status(403).json({ message: 'You are not authorized to delete this post' });
      }

      await Post.deleteOne({ _id: req.params.id });
      console.log('Post deleted:', req.params.id);
      res.json({ message: 'Post deleted successfully' });
    } catch (err) {
      console.error('Error in /api/posts/:id DELETE:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: 'Server error' });
    }
  });

  router.get('/:id', verifyJwtToken, async (req, res) => {
    try {
      console.log('Fetching post by ID:', req.params.id);
      const post = await Post.findById(req.params.id)
        .populate('author', 'name email profilePicture')
        .populate('comments.user', 'name profilePicture');
      if (!post) {
        console.log('Post not found:', req.params.id);
        return res.status(404).json({ message: 'Post not found' });
      }
      res.json(post);
    } catch (err) {
      console.error('Error in /api/posts/:id GET:', {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

  return router;
};