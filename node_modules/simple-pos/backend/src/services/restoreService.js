const fs = require("fs");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");
const extract = require("extract-zip");
const initializeDatabase = require("../db/schema");

const {
  productImagesDir,
  logoDir,
  backupsDir,
} = require("../config/dataPaths");
const db = require("../db/database");

// const uploadsPath = path.join(__dirname, "../../uploads/products");
const uploadsPath = productImagesDir;
const requiredTables = [
  "products",
  "bills",
  "bill_items",
  "daily_closings",
  "settings",
];

function validateDatabase(databasePath) {
  const testDb = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const integrity = testDb.pragma("integrity_check");

    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error("Database integrity check failed.");
    }

    const tables = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((table) => table.name);

    const missingTables = requiredTables.filter(
      (table) => !tables.includes(table),
    );

    if (missingTables.length > 0) {
      throw new Error(
        `Backup is missing required tables: ${missingTables.join(", ")}`,
      );
    }

    const foreignKeyErrors = testDb.pragma("foreign_key_check");

    if (foreignKeyErrors.length > 0) {
      throw new Error("Backup contains invalid foreign-key relationships.");
    }
  } finally {
    testDb.close();
  }
}

async function restoreBackup(zipPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "simple-pos-restore-"));

  const extractDir = path.join(tempDir, "extracted");
  const candidateDb = path.join(extractDir, "pos.db");

  const liveDbPath = db.getDatabasePath();
  // const backupRoot = path.join(__dirname, "../../backups");
  const backupRoot = backupsDir;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const safetyDir = path.join(backupRoot, `Before_Restore_${timestamp}`);

  const safetyDbPath = path.join(safetyDir, "pos.db");
  const safetyImagesPath = path.join(safetyDir, "uploads", "products");

  const candidateLogoPath = path.join(extractDir, "uploads", "logo");
  const safetyLogoPath = path.join(safetyDir, "uploads", "logo");

  const candidateImagesPath = path.join(extractDir, "uploads", "products");

  let connectionClosed = false;
  let replacementStarted = false;

  try {
    fs.mkdirSync(extractDir, { recursive: true });
    fs.mkdirSync(safetyImagesPath, { recursive: true });
    fs.mkdirSync(safetyLogoPath, { recursive: true });
    fs.mkdirSync(path.dirname(liveDbPath), { recursive: true });

    // Extract only into a temporary directory.
    await extract(zipPath, { dir: extractDir });

    if (!fs.existsSync(candidateDb)) {
      throw new Error("Invalid backup: pos.db was not found in the ZIP.");
    }

    // Validate the uploaded database before touching live data.
    validateDatabase(candidateDb);

    // Create a recoverable snapshot of the current database.
    await db.backup(safetyDbPath);

    // Preserve the current product images.
    if (fs.existsSync(uploadsPath)) {
      fs.cpSync(uploadsPath, safetyImagesPath, {
        recursive: true,
      });
    }

    // Preserve the current shop logo for rollback.
    if (fs.existsSync(logoDir)) {
      fs.cpSync(logoDir, safetyLogoPath, {
        recursive: true,
      });
    }

    // Ensure the safety database itself is valid.
    validateDatabase(safetyDbPath);

    // Stop using SQLite before replacing its files.
    db.closeConnection();
    connectionClosed = true;

    replacementStarted = true;

    // Replace the database and remove stale WAL sidecar files.
    fs.rmSync(liveDbPath, { force: true });
    fs.rmSync(`${liveDbPath}-wal`, { force: true });
    fs.rmSync(`${liveDbPath}-shm`, { force: true });

    fs.copyFileSync(candidateDb, liveDbPath);

    // Replace product images with the contents of the backup.
    fs.rmSync(uploadsPath, {
      recursive: true,
      force: true,
    });

    fs.mkdirSync(path.dirname(uploadsPath), {
      recursive: true,
    });

    if (fs.existsSync(candidateImagesPath)) {
      fs.cpSync(candidateImagesPath, uploadsPath, {
        recursive: true,
      });
    } else {
      fs.mkdirSync(uploadsPath, { recursive: true });
    }

    // logo
    // Replace the logo with the logo included in the backup.
    // Older backups may not contain uploads/logo.
    fs.rmSync(logoDir, {
      recursive: true,
      force: true,
    });

    fs.mkdirSync(logoDir, { recursive: true });

    if (fs.existsSync(candidateLogoPath)) {
      fs.cpSync(candidateLogoPath, logoDir, {
        recursive: true,
      });
    }

    // Reopen the database and validate the live copy.
    db.reopenConnection();
    connectionClosed = false;

    initializeDatabase();
    validateDatabase(liveDbPath);

    return {
      success: true,
      message: "Backup restored successfully.",
      safetyBackup: safetyDir,
    };
  } catch (error) {
    // If replacement began, try to restore the previous files.
    if (replacementStarted) {
      try {
        if (!connectionClosed) {
          db.closeConnection();
          connectionClosed = true;
        }

        fs.rmSync(liveDbPath, { force: true });
        fs.rmSync(`${liveDbPath}-wal`, { force: true });
        fs.rmSync(`${liveDbPath}-shm`, { force: true });

        if (fs.existsSync(safetyDbPath)) {
          fs.copyFileSync(safetyDbPath, liveDbPath);
        }

        fs.rmSync(uploadsPath, {
          recursive: true,
          force: true,
        });

        fs.mkdirSync(path.dirname(uploadsPath), {
          recursive: true,
        });

        if (fs.existsSync(safetyImagesPath)) {
          fs.cpSync(safetyImagesPath, uploadsPath, {
            recursive: true,
          });
        }

        // logo
        // Restore the previous logo during rollback.
        fs.rmSync(logoDir, {
          recursive: true,
          force: true,
        });

        fs.mkdirSync(logoDir, { recursive: true });

        if (fs.existsSync(safetyLogoPath)) {
          fs.cpSync(safetyLogoPath, logoDir, {
            recursive: true,
          });
        }

        db.reopenConnection();
        connectionClosed = false;

        initializeDatabase();
      } catch (rollbackError) {
        console.error("CRITICAL: Restore rollback failed.", rollbackError);

        throw new Error(
          `Restore failed and automatic recovery also failed. Preserve the safety backup at: ${safetyDir}`,
        );
      }
    }

    throw error;
  } finally {
    // Close SQLite if recovery left it closed.
    if (connectionClosed) {
      try {
        db.reopenConnection();
      } catch (reopenError) {
        console.error("Could not reopen database connection:", reopenError);
      }
    }

    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  }
}

module.exports = {
  restoreBackup,
};
