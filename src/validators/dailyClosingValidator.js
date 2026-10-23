const { z } = require("zod");

const dailyClosingSchema = z.object({
  date: z.string().min(1, "Date is required"),

  actualCash: z.number().nonnegative("Actual cash cannot be negative"),

  note: z.string().trim().max(500).optional().default(""),
});

const reopenDailyClosingSchema = z.object({
  date: z.string().min(1, "Date is required"),
  changedBy: z.string().trim().min(1, "Name is required").max(100),
  role: z.enum(["MANAGER", "CASHIER"]),
  reason: z.string().trim().min(1, "Reason is required").max(500),
});

module.exports = {
  dailyClosingSchema,
  reopenDailyClosingSchema,
};
