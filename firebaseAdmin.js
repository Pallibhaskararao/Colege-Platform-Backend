const admin = require('firebase-admin');
const path = require('path');

// Use path.join to resolve the file path correctly
const serviceAccountPath = path.join(__dirname, 'college-platform-b30e2-firebase-adminsdk-fbsvc-ffe713278e.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;