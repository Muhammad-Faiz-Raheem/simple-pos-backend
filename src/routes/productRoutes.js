const express = require("express");
const upload = require("../config/upload");

const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  exportProducts,
  downloadProductSample,
  importProducts,
} = require("../controllers/productController");

const multer = require("multer");

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB maximum
  },
  fileFilter: (req, file, callback) => {
    if (
      file.mimetype === "text/csv" ||
      file.originalname.toLowerCase().endsWith(".csv")
    ) {
      return callback(null, true);
    }

    callback(new Error("Please upload a CSV file."));
  },
});

const validate = require("../validators/validate");
const { productSchema } = require("../validators/productValidator");

const router = express.Router();

router.get("/", getProducts);
router.post("/upload-image", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Image is required",
      });
    }

    const imageUrl = `/uploads/products/${req.file.filename}`;

    res.status(201).json({
      success: true,
      message: "Image uploaded successfully",
      data: {
        image: imageUrl,
      },
    });
  } catch (error) {
    console.error("Image upload error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to upload image",
    });
  }
});

// Export and import routes
router.get("/export", exportProducts);
router.get("/sample", downloadProductSample);
router.post("/bulk-import", csvUpload.single("file"), importProducts);

// Product CRUD routes
router.get("/:id", getProductById);
router.post("/", validate(productSchema), createProduct);
router.put("/:id", validate(productSchema), updateProduct);
router.delete("/:id", deleteProduct);

module.exports = router;
