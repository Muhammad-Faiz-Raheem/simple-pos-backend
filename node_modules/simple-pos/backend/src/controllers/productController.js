const fs = require("fs");
const path = require("path");
const db = require("../db/database");
const { productImagesDir } = require("../config/dataPaths");

const removeOldProductImage = (imagePath) => {
  if (!imagePath || !imagePath.startsWith("/uploads/products/")) return;

  try {
    const filename = path.basename(imagePath);
    const fullPath = path.join(productImagesDir, filename);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { force: true });
    }
  } catch (error) {
    console.warn("Could not remove old product image:", error.message);
  }
};

const getProducts = (req, res) => {
  try {
    const { search, category } = req.query;

    let query = `
            SELECT *
            FROM products
            WHERE isActive = 1
        `;

    const params = {};

    if (search) {
      query += `
                AND (
                    name LIKE @search
                    OR category LIKE @search
                )
            `;

      params.search = `%${search}%`;
    }

    if (category) {
      query += ` AND category = @category`;
      params.category = category;
    }

    query += ` ORDER BY name ASC`;

    const products = db.prepare(query).all(params);

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("getProducts error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
};

const getProductById = (req, res) => {
  try {
    const { id } = req.params;

    const product = db
      .prepare(
        `
                SELECT *
                FROM products
                WHERE id = ?
            `,
      )
      .get(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("getProductById error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
};

const createProduct = (req, res) => {
  try {
    const { name, price, image, category } = req.body;

    const result = db
      .prepare(
        `
                INSERT INTO products (
                    name,
                    price,
                    image,
                    category,
                    createdAt,
                    updatedAt
                )
                VALUES (
                    @name,
                    @price,
                    @image,
                    @category,
                    datetime('now', 'localtime'),
                    datetime('now', 'localtime')
                )
            `,
      )
      .run({
        name,
        price,
        image: image || null,
        category: category || null,
      });

    const product = db
      .prepare(
        `
                SELECT *
                FROM products
                WHERE id = ?
            `,
      )
      .get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    console.error("createProduct error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create product",
    });
  }
};

const updateProduct = (req, res) => {
  try {
    const { id } = req.params;

    const { name, price, image, category, isActive } = req.body;

    const existingProduct = db
      .prepare(
        `
                SELECT *
                FROM products
                WHERE id = ?
            `,
      )
      .get(id);

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const nextImage = image || null;

    db.prepare(
      `
            UPDATE products
            SET
                name = @name,
                price = @price,
                image = @image,
                category = @category,
                isActive = @isActive,
                updatedAt = datetime('now', 'localtime')
            WHERE id = @id
        `,
    ).run({
      id,
      name,
      price,
      image: nextImage,
      category: category || null,
      isActive:
        isActive === undefined ? existingProduct.isActive : isActive ? 1 : 0,
    });

    if (existingProduct.image && existingProduct.image !== nextImage) {
      removeOldProductImage(existingProduct.image);
    }

    const product = db
      .prepare(
        `
                SELECT *
                FROM products
                WHERE id = ?
            `,
      )
      .get(id);

    res.json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    console.error("updateProduct error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update product",
    });
  }
};

const deleteProduct = (req, res) => {
  try {
    const { id } = req.params;

    const existingProduct = db
      .prepare(
        `
                SELECT *
                FROM products
                WHERE id = ?
            `,
      )
      .get(id);

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    /*
     * Soft-delete by deactivating the product so historical bills remain intact.
     */
    db.prepare(
      `
            UPDATE products
            SET
                isActive = 0,
                updatedAt = datetime('now', 'localtime')
            WHERE id = ?
        `,
    ).run(id);

    res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("deleteProduct error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
};

const exportProducts = (req, res) => {
  try {
    const products = db
      .prepare(
        `SELECT name, price, category
         FROM products
         WHERE isActive = 1
         ORDER BY name ASC`,
      )
      .all();

    const escapeCSV = (value) => {
      const text = String(value ?? "");
      return `"${text.replace(/"/g, '""')}"`;
    };

    const rows = [
      ["name", "price", "category"],
      ...products.map((product) => [
        product.name,
        product.price,
        product.category || "",
      ]),
    ];

    const csv =
      "\uFEFF" + rows.map((row) => row.map(escapeCSV).join(",")).join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="products.csv"');

    res.send(csv);
  } catch (error) {
    console.error("exportProducts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export products",
    });
  }
};

const downloadProductSample = (req, res) => {
  const csv =
    "\uFEFF" +
    "name,price,category\r\n" +
    '"Coca Cola",100,"Drinks"\r\n' +
    '"Mineral Water",80,"Drinks"\r\n';

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="sample-products.csv"',
  );

  res.send(csv);
};

// Handles commas, quoted values, escaped quotes and newlines in CSV.
const parseCSV = (content) => {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (inQuotes && char === '"' && content[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && content[i + 1] === "\n") i++;

      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);

      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unclosed quoted value.");
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }

  return rows;
};

const importProducts = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select a CSV file.",
      });
    }

    const content = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");

    const rows = parseCSV(content);

    if (rows.length < 2) {
      return res.status(400).json({
        success: false,
        message: "The CSV file has no product rows.",
      });
    }

    const headers = rows[0].map((header) => header.trim().toLowerCase());

    const nameIndex = headers.indexOf("name");
    const priceIndex = headers.indexOf("price");
    const categoryIndex = headers.indexOf("category");

    if (nameIndex === -1 || priceIndex === -1) {
      return res.status(400).json({
        success: false,
        message:
          "CSV must contain name and price columns. Download the sample file for the correct format.",
      });
    }

    const insertProduct = db.prepare(`
      INSERT INTO products (name, price, image, category, createdAt, updatedAt)
      VALUES (@name, @price, NULL, @category, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `);

    let imported = 0;
    const errors = [];

    const importTransaction = db.transaction(() => {
      rows.slice(1).forEach((row, index) => {
        const rowNumber = index + 2;
        const name = (row[nameIndex] || "").trim();
        const rawPrice = (row[priceIndex] || "").trim();
        const price = Number(rawPrice);
        const category =
          categoryIndex === -1 ? "" : (row[categoryIndex] || "").trim();

        if (!name) {
          errors.push(`Row ${rowNumber}: Product name is required.`);
          return;
        }

        if (rawPrice === "" || !Number.isFinite(price) || price < 0) {
          errors.push(
            `Row ${rowNumber}: Price must be a valid non-negative number.`,
          );
          return;
        }

        if (row.length !== headers.length) {
          errors.push(
            `Row ${rowNumber}: Number of columns does not match the header.`,
          );
          return;
        }

        insertProduct.run({
          name,
          price,
          category: category || null,
        });

        imported++;
      });
    });

    importTransaction();

    res.json({
      success: true,
      message: `Imported ${imported} product(s).`,
      data: {
        imported,
        failed: errors.length,
        errors,
      },
    });
  } catch (error) {
    console.error("importProducts error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to import products.",
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  exportProducts,
  downloadProductSample,
  importProducts,
};
