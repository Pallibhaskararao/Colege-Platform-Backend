const mongoose = require('mongoose');
const Notification = require('./models/Notification'); // Import the Notification model
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected for clearing notifications'))
  .catch(err => console.log('Error connecting to MongoDB:', err));

// Function to clear all notifications
const clearNotifications = async () => {
  try {
    // Clear all notifications
    const result = await Notification.deleteMany({});
    console.log(`Cleared ${result.deletedCount} notifications from the database`);

    // Close the connection
    mongoose.connection.close();
    console.log('Database connection closed');
  } catch (err) {
    console.error('Error clearing notifications:', err);
    mongoose.connection.close();
  }
};

// Run the clear function
clearNotifications();