const fs = require("fs");
const { restoreBackup } = require("../services/restoreService");

const restoreBackupController = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please select a ZIP backup file.",
    });
  }

  try {
    const result = await restoreBackup(req.file.path);

    return res.json({
      success: true,
      message: result.message,
      safetyBackup: result.safetyBackup,
    });
  } catch (error) {
    console.error("Restore request failed:", error);

    return res.status(400).json({
      success: false,
      message: error.message || "Failed to restore backup.",
    });
  } finally {
    fs.rm(req.file.path, { force: true }, () => {});
  }
};

module.exports = {
  restoreBackupController,
};
