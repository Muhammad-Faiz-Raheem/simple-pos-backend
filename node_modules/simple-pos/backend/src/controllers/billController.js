const db = require("../db/database");
const { getBusinessDayContext } = require("../services/businessDay");

// Round to 2 decimal places
const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const generateBillNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const prefix = `INV-${year}${month}${day}`;

  const checkExisting = db.prepare(
    "SELECT 1 FROM bills WHERE billNumber = ? LIMIT 1",
  );

  for (let attempt = 0; attempt < 25; attempt++) {
    const random = Math.floor(1000 + Math.random() * 9000);
    const candidate = `${prefix}-${random}`;
    if (!checkExisting.get(candidate)) {
      return candidate;
    }
  }

  // Fallback guaranteed unique suffix using timestamp + random
  return `${prefix}-${Date.now().toString().slice(-6)}`;
};

const createBill = (req, res) => {
  const {
    customerName,
    discount = 0,
    paymentMethod = "CASH",
    items,
    businessDate: requestedBusinessDate,
  } = req.body;

  try {
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Bill must contain at least one product",
      });
    }

    const validPaymentMethods = ["CASH", "CARD", "OTHER"];

    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    /*
     * Calculate subtotal from the actual
     * product prices stored in the database.
     */
    let subtotal = 0;
    const billItems = [];

    for (const item of items) {
      const product = db
        .prepare(
          `
                    SELECT *
                    FROM products
                    WHERE id = ?
                    AND isActive = 1
                `,
        )
        .get(item.productId);

      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product ${item.productId} not found or inactive`,
        });
      }

      const quantity = Number(item.quantity);

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for ${product.name}`,
        });
      }

      // const itemTotal = product.price * quantity;
      // subtotal += itemTotal;
      const itemTotal = roundMoney(product.price * quantity);
      subtotal = roundMoney(subtotal + itemTotal);

      billItems.push({
        productId: product.id,
        productName: product.name,
        price: product.price,
        quantity,
        total: itemTotal,
      });
    }

    // const numericDiscount = Number(discount) || 0;
    const numericDiscount = roundMoney(Number(discount) || 0);

    if (numericDiscount < 0) {
      return res.status(400).json({
        success: false,
        message: "Discount cannot be negative",
      });
    }

    if (numericDiscount > subtotal) {
      return res.status(400).json({
        success: false,
        message: "Discount cannot be greater than subtotal",
      });
    }

    // const total = subtotal - numericDiscount;
    const total = roundMoney(subtotal - numericDiscount);
    const businessDayContext = getBusinessDayContext();
    let businessDate = businessDayContext.businessDate;

    if (businessDayContext.inShift) {
      if (
        requestedBusinessDate &&
        requestedBusinessDate !== businessDayContext.businessDate
      ) {
        return res.status(400).json({
          success: false,
          message: "This sale must use the current shift's business date",
        });
      }
    } else {
      const allowedDates = [
        businessDayContext.today,
        businessDayContext.previousBusinessDate,
      ];

      if (!requestedBusinessDate) {
        return res.status(409).json({
          success: false,
          code: "OUTSIDE_SHIFT",
          shiftStartTime: businessDayContext.shiftStartTime,
          shiftEndTime: businessDayContext.shiftEndTime,
          today: businessDayContext.today,
          previousBusinessDate: businessDayContext.previousBusinessDate,
          message: "Choose which business day this out-of-shift sale belongs to",
        });
      }

      if (!allowedDates.includes(requestedBusinessDate)) {
        return res.status(400).json({
          success: false,
          message: "Choose today or the previous business day",
        });
      }

      businessDate = requestedBusinessDate;
    }

    /*
     * Use a transaction so bill number generation, the bill record,
     * and all bill items are saved atomically.
     */
    const createBillTransaction = db.transaction(() => {
      const closedDay = db
        .prepare(
          `
          SELECT date
          FROM daily_closings
          WHERE date = @businessDate
            AND status = 'CLOSED'
          `,
        )
        .get({ businessDate });

      if (closedDay) {
        const error = new Error("This day is already closed");
        error.code = "DAY_CLOSED";
        error.date = closedDay.date;
        throw error;
      }

      const billNumber = generateBillNumber();

      const billResult = db
        .prepare(
          `
                        INSERT INTO bills (
                            billNumber,
                            customerName,
                            subtotal,
                            discount,
                            total,
                            paymentMethod,
                            businessDate,
                            createdAt
                        )
                        VALUES (
                            @billNumber,
                            @customerName,
                            @subtotal,
                            @discount,
                            @total,
                            @paymentMethod,
                            @businessDate,
                            datetime('now', 'localtime')
                        )
                    `,
        )
        .run({
          billNumber,
          customerName: customerName?.trim() || null,
          subtotal,
          discount: numericDiscount,
          total,
          paymentMethod,
          businessDate,
        });

      const billId = billResult.lastInsertRowid;

      const insertItem = db.prepare(`
                        INSERT INTO bill_items (
                            billId,
                            productId,
                            productName,
                            price,
                            quantity,
                            total
                        )
                        VALUES (
                            @billId,
                            @productId,
                            @productName,
                            @price,
                            @quantity,
                            @total
                        )
                    `);

      for (const item of billItems) {
        insertItem.run({
          billId,
          ...item,
        });
      }

      return billId;
    });

    const billId = createBillTransaction.immediate();

    const bill = db
      .prepare(
        `
                SELECT *
                FROM bills
                WHERE id = ?
            `,
      )
      .get(billId);

    const savedItems = db
      .prepare(
        `
                SELECT *
                FROM bill_items
                WHERE billId = ?
                ORDER BY id ASC
            `,
      )
      .all(billId);

    res.status(201).json({
      success: true,
      message: "Bill created successfully",
      data: {
        ...bill,
        items: savedItems,
      },
    });
  } catch (error) {
    if (error.code === "DAY_CLOSED") {
      return res.status(409).json({
        success: false,
        code: "DAY_CLOSED",
        date: error.date,
        message: "This day is closed. Reopen it to record this sale.",
      });
    }

    console.error("createBill error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create bill",
    });
  }
};

const getBills = (req, res) => {
  try {
    const { search = "", date } = req.query;

    let query = `
            SELECT
                id,
                billNumber,
                customerName,
                subtotal,
                discount,
                total,
                paymentMethod,
                businessDate,
                createdAt
            FROM bills
            WHERE 1 = 1
        `;

    const params = {};

    if (search.trim()) {
      query += `
                AND (
                    billNumber LIKE @search
                    OR customerName LIKE @search
                )
            `;

      params.search = `%${search.trim()}%`;
    }

    if (date) {
      query += `
                AND businessDate = @date
            `;

      params.date = date;
    }

    query += `
            ORDER BY createdAt DESC, id DESC
        `;

    const bills = db.prepare(query).all(params);

    res.json({
      success: true,
      data: bills,
    });
  } catch (error) {
    console.error("getBills error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch bills",
    });
  }
};

const getBillById = (req, res) => {
  try {
    const { id } = req.params;

    const bill = db
      .prepare(
        `
                SELECT *
                FROM bills
                WHERE id = ?
            `,
      )
      .get(id);

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    const items = db
      .prepare(
        `
                SELECT *
                FROM bill_items
                WHERE billId = ?
                ORDER BY id ASC
            `,
      )
      .all(id);

    res.json({
      success: true,
      data: {
        ...bill,
        items,
      },
    });
  } catch (error) {
    console.error("getBillById error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch bill",
    });
  }
};

const deleteBill = (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid bill ID",
      });
    }

    const deleteBillTransaction = db.transaction((billId) => {
      const bill = db.prepare("SELECT id FROM bills WHERE id = ?").get(billId);

      if (!bill) {
        return false;
      }

      db.prepare("DELETE FROM bill_items WHERE billId = ?").run(billId);
      db.prepare("DELETE FROM bills WHERE id = ?").run(billId);

      return true;
    });

    const deleted = deleteBillTransaction(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    return res.json({
      success: true,
      message: "Bill deleted successfully",
    });
  } catch (error) {
    console.error("deleteBill error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete bill",
    });
  }
};

const getProductSalesByDate = (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    const productSales = db
      .prepare(
        `
        SELECT
          bi.productName,
          bi.price,
          SUM(bi.quantity) AS quantitySold,
          SUM(bi.total) AS totalSales
        FROM bill_items bi
        INNER JOIN bills b ON b.id = bi.billId
        WHERE b.businessDate = @date
        GROUP BY bi.productName, bi.price
        ORDER BY totalSales DESC
        `,
      )
      .all({ date });

    res.json({
      success: true,
      data: productSales,
    });
  } catch (error) {
    console.error("getProductSalesByDate error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch product sales",
    });
  }
};

module.exports = {
  createBill,
  getBills,
  getBillById,
  deleteBill,
  getProductSalesByDate,
};
