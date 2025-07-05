const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['Student', 'Faculty', 'Admin'], default: 'Student' }, // Add 'Admin'
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
  skills: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Skill' }],
  bio: { type: String },
  profilePicture: { 
    type: String, 
    default: '/uploads/profile_pics/default-profile-pic.jpg'
  },
  pendingRequests: [
    {
      from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    },
  ],
  acquaintances: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  banned: { type: Boolean, default: false },
  banRequests: [
    {
      from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: { type: String },
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    },
  ],
});

module.exports = mongoose.model('User', userSchema);