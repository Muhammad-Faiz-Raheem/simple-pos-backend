const db = require("../db/database");
const fs = require("fs");
const path = require("path");
const os = require("os");
const archiver = require("archiver");
const Database = require("better-sqlite3");

const {
  productImagesDir,
  logoDir,
  backupsDir,
} = require("../config/dataPaths");

const getSettings = (req, res) => {
  try {
    const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();

    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error("getSettings error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load settings",
    });
  }
};

const updateSettings = (req, res) => {
  try {
    const {
      shopName,
      phone,
      address,
      footerMessage,
      receiptWidth,
      shiftStartTime,
      shiftEndTime,
      removeLogo,
    } = req.body;

    if (!shopName || !shopName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Shop name is required",
      });
    }

    if (!["58mm", "80mm"].includes(receiptWidth)) {
      return res.status(400).json({
        success: false,
        message: "Receipt width must be 58mm or 80mm",
      });
    }

    const validTime = (value) =>
      typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

    if (
      !validTime(shiftStartTime) ||
      !validTime(shiftEndTime) ||
      shiftStartTime === shiftEndTime
    ) {
      return res.status(400).json({
        success: false,
        message: "Shift start and end must be valid, different times",
      });
    }

    const existingSettings = db
      .prepare("SELECT * FROM settings WHERE id = 1")
      .get();

    db.prepare(
      `
            UPDATE settings
            SET shopName = ?,
                phone = ?,
                address = ?,
                footerMessage = ?,
                receiptWidth = ?,
                shiftStartTime = ?,
                shiftEndTime = ?
            WHERE id = 1
        `,
    ).run(
      shopName.trim(),
      phone || "",
      address || "",
      footerMessage || "",
      receiptWidth,
      shiftStartTime,
      shiftEndTime,
    );

    if (removeLogo && existingSettings?.logoPath) {
      db.prepare("UPDATE settings SET logoPath = '' WHERE id = 1").run();

      if (existingSettings.logoPath.startsWith("/uploads/logo/")) {
        const oldFilename = path.basename(existingSettings.logoPath);
        const oldFilePath = path.join(logoDir, oldFilename);
        fs.rmSync(oldFilePath, { force: true });
      }
    }

    const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();

    res.json({
      success: true,
      message: "Settings saved successfully",
      data: settings,
    });
  } catch (error) {
    console.error("updateSettings error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to save settings",
    });
  }
};

const downloadBackup = async (req, res) => {
  let tempDir;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const fileName = `POS_Backup_${timestamp}.zip`;

  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "simple-pos-backup-"));

    const snapshotPath = path.join(tempDir, "pos.db");
    const zipPath = path.join(tempDir, fileName);

    // Create a consistent SQLite database snapshot.
    await db.backup(snapshotPath);

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    const output = fs.createWriteStream(zipPath);

    const archiveDone = new Promise((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
    });

    archive.pipe(output);

    archive.file(snapshotPath, {
      name: "pos.db",
    });

    if (fs.existsSync(productImagesDir)) {
      archive.directory(productImagesDir, "uploads/products");
    }
    if (fs.existsSync(logoDir)) {
      archive.directory(logoDir, "uploads/logo");
    }

    await archive.finalize();
    await archiveDone;

    res.download(zipPath, fileName, (error) => {
      fs.rm(
        tempDir,
        {
          recursive: true,
          force: true,
        },
        () => {},
      );

      if (error && !res.headersSent) {
        console.error("Backup download error:", error);
        res.status(500).end("Failed to download backup.");
      }
    });
  } catch (error) {
    console.error("Backup creation error:", error);

    if (tempDir) {
      fs.rm(
        tempDir,
        {
          recursive: true,
          force: true,
        },
        () => {},
      );
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to create backup.",
      });
    }
  }
};

const createSafetyBackup = async () => {
  fs.mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const fileName = `POS_Backup_${timestamp}.zip`;
  const backupPath = path.join(backupsDir, fileName);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "simple-pos-backup-"));

  try {
    const snapshotPath = path.join(tempDir, "pos.db");

    await db.backup(snapshotPath);

    const testDb = new Database(snapshotPath, {
      readonly: true,
      fileMustExist: true,
    });

    try {
      const integrity = testDb.pragma("integrity_check");

      if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
        throw new Error("Database snapshot failed integrity check.");
      }

      const foreignKeyErrors = testDb.pragma("foreign_key_check");

      if (foreignKeyErrors.length > 0) {
        throw new Error("Database snapshot has foreign-key errors.");
      }
    } finally {
      testDb.close();
    }

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    const output = fs.createWriteStream(backupPath);

    const archiveDone = new Promise((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
    });

    archive.pipe(output);

    archive.file(snapshotPath, { name: "pos.db" });

    if (fs.existsSync(productImagesDir)) {
      archive.directory(productImagesDir, "uploads/products");
    }
    if (fs.existsSync(logoDir)) {
      archive.directory(logoDir, "uploads/logo");
    }

    await archive.finalize();
    await archiveDone;

    if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
      throw new Error("Backup archive is missing or empty.");
    }

    return {
      fileName,
      backupPath,
    };
  } catch (error) {
    fs.rmSync(backupPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  }
};

const deleteAllData = async (req, res) => {
  try {
    const backup = await createSafetyBackup();

    const clearData = db.transaction(() => {
      db.prepare("DELETE FROM bill_items").run();
      db.prepare("DELETE FROM bills").run();
      db.prepare("DELETE FROM daily_closings").run();
      db.prepare("DELETE FROM products").run();
    });

    clearData();

    if (fs.existsSync(productImagesDir)) {
      fs.rmSync(productImagesDir, {
        recursive: true,
        force: true,
      });
    }

    fs.mkdirSync(productImagesDir, {
      recursive: true,
    });

    return res.json({
      success: true,
      message: "All operational data deleted successfully.",
      data: {
        backupFile: backup.fileName,
        backupPath: backup.backupPath,
      },
    });
  } catch (error) {
    console.error("deleteAllData error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to complete data deletion. Check the database and backup before retrying.",
    });
  }
};

const uploadLogo = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid logo image.",
      });
    }

    const oldSettings = db
      .prepare("SELECT logoPath FROM settings WHERE id = 1")
      .get();

    if (!oldSettings) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(500).json({
        success: false,
        message: "Settings record was not found.",
      });
    }

    const logoPath = `/uploads/logo/${req.file.filename}`;

    try {
      db.prepare("UPDATE settings SET logoPath = ? WHERE id = 1").run(logoPath);
    } catch (error) {
      fs.rmSync(req.file.path, { force: true });
      throw error;
    }

    const oldLogoPath = oldSettings.logoPath;

    if (oldLogoPath && oldLogoPath.startsWith("/uploads/logo/")) {
      const oldFilename = path.basename(oldLogoPath);
      const oldFilePath = path.join(logoDir, oldFilename);

      if (oldFilePath !== req.file.path) {
        fs.rmSync(oldFilePath, { force: true });
      }
    }

    return res.json({
      success: true,
      message: "Logo uploaded successfully.",
      data: { logoPath },
    });
  } catch (error) {
    console.error("uploadLogo error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save logo.",
    });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  uploadLogo,
  downloadBackup,
  deleteAllData,
};
