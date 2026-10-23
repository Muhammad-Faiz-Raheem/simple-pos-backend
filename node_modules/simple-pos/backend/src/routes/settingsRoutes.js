const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");

const {
  getSettings,
  updateSettings,
  uploadLogo,
  downloadBackup,
  deleteAllData,
} = require("../controllers/settingsController");

const { logoDir } = require("../config/dataPaths");
const { restoreBackupController } = require("../controllers/restoreController");

const restoreUploadDir = path.join(os.tmpdir(), "simple-pos-restore-uploads");
fs.mkdirSync(restoreUploadDir, { recursive: true });
fs.mkdirSync(logoDir, { recursive: true });

// Create a Multer upload middleware to handle file uploads.
const upload = multer({
  dest: restoreUploadDir,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, callback) => {
    if (path.extname(file.originalname).toLowerCase() !== ".zip") {
      return callback(new Error("Only ZIP backup files are allowed."));
    }

    callback(null, true);
  },
});

// Create a Multer upload middleware to handle logo uploads.
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => callback(null, logoDir),
    filename: (req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `shop-logo-${Date.now()}${extension}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowedTypes = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };

    const extension = path.extname(file.originalname).toLowerCase();

    if (allowedTypes[extension] !== file.mimetype) {
      return callback(
        new Error("Only PNG, JPG, JPEG, and WebP images are allowed."),
      );
    }

    callback(null, true);
  },
});

const router = express.Router();

router.get("/backup", downloadBackup);
router.get("/", getSettings);
router.put("/", updateSettings);
router.post("/logo", logoUpload.single("logo"), uploadLogo);

router.post("/restore", upload.single("backup"), restoreBackupController);
router.delete("/delete-all-data", deleteAllData);

module.exports = router;
