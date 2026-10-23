const { z } = require("zod");

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),

  price: z.number().nonnegative("Price cannot be negative"),

  image: z.string().optional().nullable(),

  category: z.string().trim().optional().nullable(),

  isActive: z.union([z.boolean(), z.number()]).optional(),
});

module.exports = {
  productSchema,
};
