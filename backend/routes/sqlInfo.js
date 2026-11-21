
const express = require("express");
const router = express.Router();

// SQL statements used by checkout.
// These are informational templates, not executed here.
const checkoutSQL = [
    {
        database: "supermarket_db",
        operation: "Lock inventory and retrieve product information",
        sql: `
SELECT i.sku, i.quantity AS stock,
       p.name, p.price, p.taxable,
       p.by_weight, st.tax_rate
FROM public.inventory i
JOIN public.product p ON p.sku = i.sku
JOIN public.store s ON s.store_id = i.store_id
JOIN public.state_tax st ON st.state = s.state
WHERE i.store_id = $1
  AND i.sku = ANY($2::varchar[])
ORDER BY i.sku
FOR UPDATE OF i;
        `.trim()
    },
    {
        database: "supermarket_db",
        operation: "Create purchase",
        sql: `
INSERT INTO public.purchase
    (store_id, customer_id, purchase_date,
     total, payment_method, account_id)
VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5)
RETURNING purchase_id;
        `.trim()
    },
    {
        database: "supermarket_db",
        operation: "Insert purchased items",
        sql: `
INSERT INTO public.purchase_item
    (purchase_id, line_number, sku,
     quantity, unit_price, tax_amount)
VALUES ($1, $2, $3, $4, $5, $6);
        `.trim()
    },
    {
        database: "supermarket_db",
        operation: "Update inventory",
        sql: `
UPDATE public.inventory
SET quantity = quantity - $1
WHERE store_id = $2 AND sku = $3;
        `.trim()
    },
    {
        database: "bank_db",
        operation: "Verify account and lock balance",
        sql: `
SELECT balance
FROM public.bank_account
WHERE account_id = $1
  AND customer_id = $2
FOR UPDATE;
        `.trim()
    },
    {
        database: "bank_db",
        operation: "Deduct bank payment",
        sql: `
UPDATE public.bank_account
SET balance = balance - $1
WHERE account_id = $2
  AND customer_id = $3;
        `.trim()
    }
];

// GET /api/sql/checkout
router.get("/checkout", (req, res) => {
    res.json({
        success: true,
        operation: "checkout",
        count: checkoutSQL.length,
        queries: checkoutSQL
    });
});

module.exports = router;
