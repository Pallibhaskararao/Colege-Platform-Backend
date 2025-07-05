const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure the uploads/profile_pics directory exists
const uploadDir = path.join(__dirname, '../uploads/profile_pics');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage for multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); // Store files in uploads/profile_pics
  },
  filename: (req, file, cb) => {
    const userId = req.userId; // From verifyJwtToken middleware
    const timestamp = Date.now();
    const ext = path.extname(file.originalname); // Get file extension (e.g., .jpg)
    cb(null, `${userId}-${timestamp}${ext}`); // e.g., userId-timestamp.jpg
  },
});

// File filter to allow only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and GIF images are allowed'), false);
  }
};

// Configure multer with limits (e.g., 5MB max file size)
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

module.exports = upload;