// Load environment variables from .env file
require('dotenv').config();

const mongoose = require('mongoose');
const Notification = require('./models/Notification');
const User = require('./models/User'); // Import the User model

// Connect to MongoDB using the URI from .env
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000, // Increase timeout to 30 seconds
  })
  .then(() => {
    console.log('MongoDB connected successfully to:', process.env.MONGO_URI);
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  });

const migrate = async () => {
  try {
    // Step 1: Delete all friend_request notifications
    console.log('Deleting all friend_request notifications...');
    const deletionResult = await Notification.deleteMany({ type: 'friend_request' });
    console.log('Deletion result:', deletionResult);

    // Step 2: Update users without a profilePicture to use the default
    console.log('Updating users with default profile picture...');
    const updateResult = await User.updateMany(
      { profilePicture: { $exists: false } }, // Match users without a profilePicture field
      { $set: { profilePicture: '/uploads/profile_pics/default-profile-pic.jpg' } } // Set the default profile picture
    );
    console.log(`Updated ${updateResult.modifiedCount} users with default profile picture.`);

    console.log('Migration completed successfully');
    mongoose.connection.close();
  } catch (err) {
    console.error('Migration failed:', err);
    mongoose.connection.close();
    process.exit(1);
  }
};

// Run the migration
migrate();