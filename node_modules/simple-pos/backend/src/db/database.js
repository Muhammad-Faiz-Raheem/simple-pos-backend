const Database = require("better-sqlite3");
const { databasePath: dbPath } = require("../config/dataPaths");

let currentDb = createConnection();

function createConnection() {
  const connection = new Database(dbPath);

  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");

  return connection;
}

const helpers = {
  getDatabasePath() {
    return dbPath;
  },

  closeConnection() {
    if (currentDb && currentDb.open) {
      currentDb.close();
    }
  },

  reopenConnection() {
    if (currentDb && currentDb.open) {
      currentDb.close();
    }

    currentDb = createConnection();

    return currentDb;
  },
};

const db = new Proxy(helpers, {
  get(target, property) {
    if (property in target) {
      return target[property];
    }

    const value = currentDb[property];

    return typeof value === "function" ? value.bind(currentDb) : value;
  },
});

module.exports = db;
