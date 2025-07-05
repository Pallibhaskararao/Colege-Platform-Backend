const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const User = require('../models/User');
const { verifyJwtToken } = require('../middleware/auth');

router.post('/', verifyJwtToken, async (req, res) => {
  const { name, memberIds } = req.body;

  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'Faculty') {
      return res.status(403).json({ message: 'Only faculty can create groups' });
    }

    if (!Array.isArray(memberIds)) {
      return res.status(400).json({ message: 'memberIds must be an array' });
    }

    const members = await User.find({ _id: { $in: memberIds } });
    if (members.length !== memberIds.length) {
      return res.status(400).json({ message: 'One or more member IDs are invalid' });
    }

    const group = new Group({
      name,
      creator: req.userId,
      members: [...new Set([...memberIds, req.userId])],
      unreadCounts: [...new Set([...memberIds, req.userId])].map(memberId => ({
        user: memberId,
        count: 0,
      })),
    });

    await group.save();
    await group.populate('creator members', 'name email');

    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/', verifyJwtToken, async (req, res) => {
  try {
    const groups = await Group.find({
      $or: [
        { creator: req.userId },
        { members: req.userId },
      ],
    }).populate('creator members', 'name email');

    res.json(groups);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:groupId', verifyJwtToken, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId).populate('creator members', 'name email');
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (!group.members.some(member => member._id.toString() === req.userId)) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    res.json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:groupId/add-member', verifyJwtToken, async (req, res) => {
  const { groupId } = req.params;
  const { memberId } = req.body;

  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'Faculty') {
      return res.status(403).json({ message: 'Only faculty can add members to groups' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (group.creator.toString() !== req.userId) {
      return res.status(403).json({ message: 'Only the group creator can add members' });
    }

    const member = await User.findById(memberId);
    if (!member) {
      return res.status(404).json({ message: 'Member not found' });
    }

    if (group.members.includes(memberId)) {
      return res.status(400).json({ message: 'User is already a member of this group' });
    }

    group.members.push(memberId);
    group.unreadCounts.push({ user: memberId, count: 0 });
    await group.save();
    await group.populate('members', 'name email');

    res.json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:groupId/remove-member', verifyJwtToken, async (req, res) => {
  const { groupId } = req.params;
  const { memberId } = req.body;

  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'Faculty') {
      return res.status(403).json({ message: 'Only faculty can remove members from groups' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (group.creator.toString() !== req.userId) {
      return res.status(403).json({ message: 'Only the group creator can remove members' });
    }

    if (memberId === group.creator.toString()) {
      return res.status(400).json({ message: 'Cannot remove the group creator' });
    }

    if (!group.members.includes(memberId)) {
      return res.status(400).json({ message: 'User is not a member of this group' });
    }

    group.members = group.members.filter(member => member.toString() !== memberId);
    group.unreadCounts = group.unreadCounts.filter(uc => uc.user.toString() !== memberId);
    await group.save();
    await group.populate('members', 'name email');

    res.json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:groupId/reset-unread', verifyJwtToken, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (!group.members.some(member => member._id.toString() === req.userId)) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    group.unreadCounts = group.unreadCounts.map(uc => 
      uc.user.toString() === req.userId ? { ...uc, count: 0 } : uc
    );
    await group.save();
    await group.populate('creator members', 'name email');

    res.json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;