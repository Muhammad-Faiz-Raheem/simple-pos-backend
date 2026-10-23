const db = require("../db/database");
const { getBusinessDayContext } = require("../services/businessDay");

const getCurrentBusinessDate = (req, res) => {
  try {
    return res.json({
      success: true,
      data: getBusinessDayContext(),
    });
  } catch (error) {
    console.error("getCurrentBusinessDate error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to determine the current business date",
    });
  }
};

const getDailySummary = (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    const summary = db
      .prepare(
        `
                SELECT
                    COUNT(*) AS totalBills,

                    COALESCE(
                        SUM(total),
                        0
                    ) AS totalSales,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN paymentMethod = 'CASH'
                                THEN total
                                ELSE 0
                            END
                        ),
                        0
                    ) AS cashSales,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN paymentMethod = 'CARD'
                                THEN total
                                ELSE 0
                            END
                        ),
                        0
                    ) AS cardSales,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN paymentMethod = 'OTHER'
                                THEN total
                                ELSE 0
                            END
                        ),
                        0
                    ) AS otherSales

                FROM bills

                WHERE businessDate = ?
            `,
      )
      .get(date);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("getDailySummary error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch daily summary",
    });
  }
};

const createDailyClosing = (req, res) => {
  try {
    const { date, actualCash, note = "" } = req.body;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    const numericActualCash = Number(actualCash);

    if (!Number.isFinite(numericActualCash) || numericActualCash < 0) {
      return res.status(400).json({
        success: false,
        message: "Actual cash must be a valid non-negative number",
      });
    }

    const closeDay = db.transaction(() => {
      const existingClosing = db
        .prepare("SELECT * FROM daily_closings WHERE date = ?")
        .get(date);

      if (existingClosing?.status === "CLOSED") {
        return { error: "ALREADY_CLOSED" };
      }

      const summary = db
        .prepare(
          `
          SELECT
              COALESCE(SUM(total), 0) AS totalSales,
              COALESCE(
                  SUM(CASE WHEN paymentMethod = 'CASH' THEN total ELSE 0 END),
                  0
              ) AS expectedCash
          FROM bills
          WHERE businessDate = ?
          `,
        )
        .get(date);

      const totalSales = Number(summary.totalSales || 0);
      const expectedCash = Number(summary.expectedCash || 0);
      const difference = numericActualCash - expectedCash;
      let closingId;

      if (existingClosing) {
        db.prepare(
          `
          UPDATE daily_closings
          SET totalSales = @totalSales,
              expectedCash = @expectedCash,
              actualCash = @actualCash,
              difference = @difference,
              note = @note,
              status = 'CLOSED',
              closedAt = datetime('now', 'localtime')
          WHERE id = @id AND status = 'OPEN'
          `,
        ).run({
          id: existingClosing.id,
          totalSales,
          expectedCash,
          actualCash: numericActualCash,
          difference,
          note: note.trim() || null,
        });
        closingId = existingClosing.id;
      } else {
        const result = db
          .prepare(
            `
            INSERT INTO daily_closings (
                date, totalSales, expectedCash, actualCash, difference, note, status, closedAt
            )
            VALUES (
                @date, @totalSales, @expectedCash, @actualCash, @difference,
                @note, 'CLOSED', datetime('now', 'localtime')
            )
            `,
          )
          .run({
            date,
            totalSales,
            expectedCash,
            actualCash: numericActualCash,
            difference,
            note: note.trim() || null,
          });
        closingId = result.lastInsertRowid;
      }

      const closing = db
        .prepare("SELECT * FROM daily_closings WHERE id = ?")
        .get(closingId);

      db.prepare(
        `
        INSERT INTO daily_closing_events (
            closingId, action, totalSales, expectedCash, actualCash,
            difference, note, createdAt
        )
        VALUES (
            @closingId, 'CLOSED', @totalSales, @expectedCash, @actualCash,
            @difference, @note, @closedAt
        )
        `,
      ).run({
        closingId,
        totalSales: closing.totalSales,
        expectedCash: closing.expectedCash,
        actualCash: closing.actualCash,
        difference: closing.difference,
        note: closing.note,
        closedAt: closing.closedAt,
      });

      return {
        closing,
        reopened: Boolean(existingClosing),
      };
    });

    const result = closeDay.immediate();

    if (result.error === "ALREADY_CLOSED") {
      return res.status(409).json({
        success: false,
        message: "This date has already been closed",
      });
    }

    res.status(result.reopened ? 200 : 201).json({
      success: true,
      message: result.reopened
        ? "Day reclosed successfully"
        : "Day closed successfully",
      data: result.closing,
    });
  } catch (error) {
    console.error("createDailyClosing error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to close the day",
    });
  }
};

const reopenDailyClosing = (req, res) => {
  try {
    const { date, changedBy, role, reason } = req.body;

    if (role !== "MANAGER") {
      return res.status(403).json({
        success: false,
        message: "Only a manager can reopen a closed day",
      });
    }

    const reopenDay = db.transaction(() => {
      const closing = db
        .prepare("SELECT * FROM daily_closings WHERE date = ?")
        .get(date);

      if (!closing) {
        return { error: "NOT_FOUND" };
      }

      if (closing.status !== "CLOSED") {
        return { error: "NOT_CLOSED" };
      }

      db.prepare(
        "UPDATE daily_closings SET status = 'OPEN' WHERE id = ?",
      ).run(closing.id);

      db.prepare(
        `
        INSERT INTO daily_closing_events (
            closingId, action, totalSales, expectedCash, actualCash,
            difference, note, changedBy, role, reason
        )
        VALUES (
            @closingId, 'REOPENED', @totalSales, @expectedCash, @actualCash,
            @difference, @note, @changedBy, @role, @reason
        )
        `,
      ).run({
        closingId: closing.id,
        totalSales: closing.totalSales,
        expectedCash: closing.expectedCash,
        actualCash: closing.actualCash,
        difference: closing.difference,
        note: closing.note,
        changedBy: changedBy.trim(),
        role,
        reason: reason.trim(),
      });

      return {
        closing: db
          .prepare("SELECT * FROM daily_closings WHERE id = ?")
          .get(closing.id),
      };
    });

    const result = reopenDay.immediate();

    if (result.error === "NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "No closing exists for this date",
      });
    }

    if (result.error === "NOT_CLOSED") {
      return res.status(409).json({
        success: false,
        message: "This day is already open",
      });
    }

    return res.json({
      success: true,
      message: "Day reopened successfully",
      data: result.closing,
    });
  } catch (error) {
    console.error("reopenDailyClosing error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reopen the day",
    });
  }
};

const getDailyClosings = (req, res) => {
  try {
    const closings = db
      .prepare(
        `
                SELECT *
                FROM daily_closings
                ORDER BY date DESC
            `,
      )
      .all();

    res.json({
      success: true,
      data: closings,
    });
  } catch (error) {
    console.error("getDailyClosings error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch closing history",
    });
  }
};

const getClosingEvents = (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    const events = db
      .prepare(
        `
        SELECT event.*
        FROM daily_closing_events AS event
        JOIN daily_closings AS closing ON closing.id = event.closingId
        WHERE closing.date = ?
        ORDER BY event.id ASC
        `,
      )
      .all(date);

    return res.json({ success: true, data: events });
  } catch (error) {
    console.error("getClosingEvents error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch closing audit history",
    });
  }
};

const getClosingByDate = (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    const closing = db
      .prepare(
        `
                SELECT *
                FROM daily_closings
                WHERE date = ?
            `,
      )
      .get(date);

    res.json({
      success: true,
      data: closing || null,
    });
  } catch (error) {
    console.error("getClosingByDate error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch closing",
    });
  }
};

const getClosingHistory = (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date cannot be after end date",
      });
    }

    const closings = db
      .prepare(
        `
        SELECT *
        FROM daily_closings
        WHERE date >= ? AND date <= ?
        ORDER BY date DESC
      `,
      )
      .all(startDate, endDate);

    return res.json({
      success: true,
      data: closings,
    });
  } catch (error) {
    console.error("getClosingHistory error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch closing history",
    });
  }
};

module.exports = {
  getDailySummary,
  getCurrentBusinessDate,
  createDailyClosing,
  reopenDailyClosing,
  getDailyClosings,
  getClosingByDate,
  getClosingEvents,
  getClosingHistory,
};
