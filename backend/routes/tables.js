
const express = require("express");
const router = express.Router();
const { supermarketPool: pool, bankPool } = require("../db");

// Map frontend names to actual PostgreSQL tables
const allowedTables = {
    state_tax: "public.state_tax",
    store: "public.store",
    aisle: "public.aisle",
    inventory: "public.inventory",
    customer: "public.customer",
    product: "public.product",
    purchase_item: "public.purchase_item",
    purchase: "public.purchase",
    bank_account: "public.bank_account"
};

// GET /api/tables/:selectedTable
router.get("/:selectedTable", async (req, res) => {
    const selectedTable = req.params.selectedTable;
    const tableName = allowedTables[selectedTable];

    if (!tableName) {
        return res.status(400).json({
            success: false,
            message: "Invalid table selection"
        });
    }

    try {
        // Bank accounts live in the separate banking database.
        const selectedPool =
            selectedTable === "bank_account" ? bankPool : pool;

        const result = await selectedPool.query(
            `SELECT * FROM ${tableName} LIMIT 20`
        );

        res.json({
            success: true,
            table: selectedTable,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error("Table browsing error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve table"
        });
    }
});

module.exports = router;
