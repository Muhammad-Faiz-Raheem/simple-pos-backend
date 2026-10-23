const express = require("express");

const {
  getDailySummary,
  getCurrentBusinessDate,
  createDailyClosing,
  getDailyClosings,
  getClosingByDate,
  getClosingEvents,
  getClosingHistory,
  reopenDailyClosing,
} = require("../controllers/dailyClosingController");

const validate = require("../validators/validate");

const {
  dailyClosingSchema,
  reopenDailyClosingSchema,
} = require("../validators/dailyClosingValidator");

const router = express.Router();

router.get("/", getDailyClosings);
router.get("/current-business-date", getCurrentBusinessDate);
router.get("/summary", getDailySummary);
router.get("/by-date", getClosingByDate);
router.get("/events", getClosingEvents);
router.get("/history", getClosingHistory);
router.post("/", validate(dailyClosingSchema), createDailyClosing);
router.post(
  "/reopen",
  validate(reopenDailyClosingSchema),
  reopenDailyClosing,
);

module.exports = router;
