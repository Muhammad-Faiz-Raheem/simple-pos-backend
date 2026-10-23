const { z } = require("zod");

const billSchema = z.object({
  customerName: z.string().trim().max(100).optional().nullable(),

  discount: z.number().nonnegative().default(0),

  paymentMethod: z.enum(["CASH", "CARD", "OTHER"]).default("CASH"),

  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),

  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),

        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

module.exports = {
  billSchema,
};
