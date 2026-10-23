const path = require("path");
// require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { uploadsDir } = require("./config/dataPaths");

const initializeDatabase = require("./db/schema");
const productRoutes = require("./routes/productRoutes");
const billRoutes = require("./routes/billRoutes");
const dailyClosingRoutes = require("./routes/dailyClosingRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const authorizeLocalApi = require("./middleware/authorizeLocalApi");

const app = express();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5000);

initializeDatabase();

// const allowedOrigins = process.env.CORS_ORIGIN
//   ? process.env.CORS_ORIGIN.split(",")
//       .map((origin) => origin.trim())
//       .filter(Boolean)
//   : null;

// app.use(
//   cors(
//     allowedOrigins && allowedOrigins.length > 0
//       ? {
//           origin: (origin, callback) => {
//             // Allow requests with no origin (e.g. file:// in packaged Electron or curl/fetch health checks)
//             if (!origin || allowedOrigins.includes(origin)) {
//               return callback(null, true);
//             }
//             return callback(null, true);
//           },
//         }
//       : undefined,
//   ),
// );

const allowedOrigins =
  process.env.POS_PACKAGED === "1"
    ? []
    : (
        process.env.CORS_ORIGIN ||
        "http://127.0.0.1:5173,http://localhost:5173"
      )
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Packaged Electron loads the renderer from file://, which sends Origin: null.
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        (process.env.POS_PACKAGED === "1" && origin === "null")
      ) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
  }),
);

app.use(express.json());

/*
 * Health check
 */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "POS API is running",
  });
});

// Protect application API routes
app.use("/api", authorizeLocalApi);

/*
 * Routes
 */
app.use("/api/products", productRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/daily-closing", dailyClosingRoutes);
app.use("/api/settings", settingsRoutes);

// Static uploaded files
app.use("/uploads", express.static(uploadsDir));

// Global Error Handler (handles Multer upload limits and fileFilter errors)
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Uploaded file exceeds the maximum allowed size."
        : err.message || "File upload error.";

    return res.status(400).json({
      success: false,
      message,
    });
  }

  if (err) {
    console.error("API error:", err);

    return res.status(err.status || 400).json({
      success: false,
      message: err.message || "An unexpected error occurred.",
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`POS backend running on http://${HOST}:${PORT}`);
});
