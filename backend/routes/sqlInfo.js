
const express = require("express");
const router = express.Router();

// Informational SQL templates matching checkoutService.js.
// These statements are displayed in the GUI, not executed here.
const checkoutSQL = [
    {
        database: "supermarket_db",
        operation: "Lock inventory and calculate checkout totals",
        sql: `
WITH requested AS (
    SELECT sku, requested_quantity
    FROM UNNEST(
        $2::varchar[],
        $3::numeric[]
    ) AS r(sku, requested_quantity)
),
locked_inventory AS (
    SELECT
        i.sku,
        i.quantity AS stock,
        r.requested_quantity,
        p.name,
        p.price,
        p.taxable,
        p.by_weight,
        st.tax_rate
    FROM public.inventory i
    JOIN requested r ON r.sku = i.sku
    JOIN public.product p ON p.sku = i.sku
    JOIN public.store s ON s.store_id = i.store_id
    JOIN public.state_tax st ON st.state = s.state
    WHERE i.store_id = $1
    ORDER BY i.sku
    FOR UPDATE OF i
),
line_amounts AS (
    SELECT
        *,
        ROUND(price * 100, 0) AS unit_cents,
        ROUND(
            ROUND(price * 100, 0) * requested_quantity,
            0
        ) AS line_subtotal_cents
    FROM locked_inventory
),
calculated AS (
    SELECT
        *,
        CASE
            WHEN taxable THEN
                ROUND(line_subtotal_cents * tax_rate, 0)
            ELSE 0
        END AS line_tax_cents
    FROM line_amounts
)
SELECT
    *,
    SUM(line_subtotal_cents) OVER ()
        AS subtotal_cents,
    SUM(line_tax_cents) OVER ()
        AS total_tax_cents
FROM calculated
ORDER BY sku;
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
        operation: "Deduct inventory",
        sql: `
UPDATE public.inventory
SET quantity = quantity - $1
WHERE store_id = $2
  AND sku = $3;
        `.trim()
    },
    {
        database: "bank_db",
        operation: "Verify customer ownership and lock bank account",
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
        operation: "Debit customer account when funds are sufficient",
        sql: `
UPDATE public.bank_account
SET balance = balance - $1
WHERE account_id = $2
  AND customer_id = $3
  AND balance >= $1
RETURNING account_id;
        `.trim()
    },
    {
        database: "bank_db",
        operation: "Credit supermarket company account",
        sql: `
UPDATE public.bank_account
SET balance = balance + $1
WHERE account_type = 'COMPANY'
RETURNING account_id;
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
