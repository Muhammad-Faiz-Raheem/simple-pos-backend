const express = require("express");

const {
  createBill,
  getBills,
  getBillById,
  deleteBill,
  getProductSalesByDate,
} = require("../controllers/billController");

const validate = require("../validators/validate");

const { billSchema } = require("../validators/billValidator");

const router = express.Router();

router.get("/", getBills);
router.get("/product-sales", getProductSalesByDate);
router.get("/:id", getBillById);
router.post("/", validate(billSchema), createBill);
router.delete("/:id", deleteBill);

module.exports = router;
