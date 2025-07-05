const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const { verifyJwtToken } = require('../middleware/auth');

router.get('/', verifyJwtToken, async (req, res) => {
  try {
    const query = req.query.query ? req.query.query.toLowerCase() : '';

    const posts = await Post.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { tags: { $regex: query, $options: 'i' } },
      ],
    }).populate('author', 'name email');

    const users = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
      ],
      _id: { $ne: req.userId },
    }).select('name email branch skills bio');

    const allPosts = await Post.find();
    const tagsSet = new Set();
    allPosts.forEach(post => {
      post.tags.forEach(tag => {
        if (tag.toLowerCase().includes(query)) {
          tagsSet.add(tag);
        }
      });
    });
    const tags = Array.from(tagsSet);

    res.json({ posts, users, tags });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;