const db = require("./database");

function initializeDatabase() {
  db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            image TEXT,
            category TEXT,
            isActive INTEGER NOT NULL DEFAULT 1,
            createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            billNumber TEXT NOT NULL UNIQUE,
            customerName TEXT,
            subtotal REAL NOT NULL DEFAULT 0,
            discount REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            paymentMethod TEXT NOT NULL DEFAULT 'CASH',
            businessDate TEXT,
            createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS bill_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            billId INTEGER NOT NULL,
            productId INTEGER NOT NULL,
            productName TEXT NOT NULL,
            price REAL NOT NULL,
            quantity INTEGER NOT NULL,
            total REAL NOT NULL,

            FOREIGN KEY (billId)
                REFERENCES bills(id)
        );

        CREATE TABLE IF NOT EXISTS daily_closings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            totalSales REAL NOT NULL DEFAULT 0,
            expectedCash REAL NOT NULL DEFAULT 0,
            actualCash REAL NOT NULL DEFAULT 0,
            difference REAL NOT NULL DEFAULT 0,
            note TEXT,
            status TEXT NOT NULL DEFAULT 'CLOSED',
            closedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS daily_closing_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            closingId INTEGER NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('CLOSED', 'REOPENED')),
            totalSales REAL NOT NULL DEFAULT 0,
            expectedCash REAL NOT NULL DEFAULT 0,
            actualCash REAL NOT NULL DEFAULT 0,
            difference REAL NOT NULL DEFAULT 0,
            note TEXT,
            changedBy TEXT,
            role TEXT,
            reason TEXT,
            createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (closingId) REFERENCES daily_closings(id) ON DELETE CASCADE
        );
    `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        shopName TEXT NOT NULL DEFAULT 'MY SHOP',
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        footerMessage TEXT NOT NULL DEFAULT 'Thank you! Please visit again.',
        receiptWidth TEXT NOT NULL DEFAULT '80mm',
        logoPath TEXT NOT NULL DEFAULT '',
        shiftStartTime TEXT NOT NULL DEFAULT '09:00',
        shiftEndTime TEXT NOT NULL DEFAULT '17:00'
    );
`);

  db.prepare(
    `
    INSERT OR IGNORE INTO settings (
        id,
        shopName,
        phone,
        address,
        footerMessage,
        receiptWidth
    )
    VALUES (1, 'MY SHOP', '', '',
        'Thank you! Please visit again.', '80mm')
`,
  ).run();

  addColumnIfNotExists("settings", "logoPath", "TEXT NOT NULL DEFAULT ''");
  addColumnIfNotExists(
    "settings",
    "shiftStartTime",
    "TEXT NOT NULL DEFAULT '09:00'",
  );
  addColumnIfNotExists(
    "settings",
    "shiftEndTime",
    "TEXT NOT NULL DEFAULT '17:00'",
  );
  addColumnIfNotExists("bills", "customerName", "TEXT");
  addColumnIfNotExists("bills", "businessDate", "TEXT");
  addColumnIfNotExists(
    "daily_closings",
    "status",
    "TEXT NOT NULL DEFAULT 'CLOSED'",
  );
  db.prepare(
    "UPDATE bills SET businessDate = DATE(createdAt) WHERE businessDate IS NULL",
  ).run();

  db.prepare(
    `
    INSERT INTO daily_closing_events (
        closingId,
        action,
        totalSales,
        expectedCash,
        actualCash,
        difference,
        note,
        createdAt
    )
    SELECT
        closing.id,
        'CLOSED',
        closing.totalSales,
        closing.expectedCash,
        closing.actualCash,
        closing.difference,
        closing.note,
        closing.closedAt
    FROM daily_closings AS closing
    WHERE NOT EXISTS (
        SELECT 1
        FROM daily_closing_events AS event
        WHERE event.closingId = closing.id
    )
    `,
  ).run();

  console.log("Database initialized");
}

function addColumnIfNotExists(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();

  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`
            ALTER TABLE ${tableName}
            ADD COLUMN ${columnName} ${columnDefinition}
        `);
  }
}

module.exports = initializeDatabase;
