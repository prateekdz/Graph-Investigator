const express = require("express");
const { executeQuery, askLlm } = require("../controllers/queryController");

const router = express.Router();

router.post("/execute", executeQuery);
router.post("/ask", askLlm);

module.exports = { router };

