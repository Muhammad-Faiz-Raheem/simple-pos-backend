const path = require("path");
const fs = require("fs");

// In development, keep using the existing backend directory.
// Later, Electron can supply a separate writable data directory
// through the POS_DATA_DIR environment variable.
const dataDir = process.env.POS_DATA_DIR
  ? path.resolve(process.env.POS_DATA_DIR)
  : path.resolve(__dirname, "../..");

const databasePath = path.join(dataDir, "pos.db");
const uploadsDir = path.join(dataDir, "uploads");
const productImagesDir = path.join(uploadsDir, "products");
const logoDir = path.join(uploadsDir, "logo");
const backupsDir = path.join(dataDir, "backups");

// Ensure required directories exist.
for (const directory of [
  dataDir,
  uploadsDir,
  productImagesDir,
  logoDir,
  backupsDir,
]) {
  fs.mkdirSync(directory, { recursive: true });
}

module.exports = {
  dataDir,
  databasePath,
  uploadsDir,
  productImagesDir,
  logoDir,
  backupsDir,
};
