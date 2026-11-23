
const express = require("express");
const router = express.Router();
const pool = require("../db");

// Accept local date or date/time values without timezone offsets.
// Examples:
// 2026-11-21
// 2026-11-21T09:30
// 2026-11-21T09:30:45
function parseDateFilter(value, isEnd = false) {
    if (value === undefined) return null;

    if (typeof value !== "string") {
        throw new Error("Invalid date format");
    }

    const match = value.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/
    );

    if (!match) {
        throw new Error(
            "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss"
        );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] ?? 0);
    const minute = Number(match[5] ?? 0);
    const second = Number(match[6] ?? 0);

    const parsed = new Date(Date.UTC(
        year, month - 1, day,
        hour, minute, second
    ));

    if (
        year < 100 ||
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day ||
        parsed.getUTCHours() !== hour ||
        parsed.getUTCMinutes() !== minute ||
        parsed.getUTCSeconds() !== second
    ) {
        throw new Error("Invalid calendar date or time");
    }

    const dateOnly = match[4] === undefined;

    // An end date covers the entire selected calendar day.
    // Use an exclusive upper bound at the next midnight.
    if (isEnd && dateOnly) {
        parsed.setUTCDate(parsed.getUTCDate() + 1);
    }

    return {
        value: parsed.toISOString()
            .replace("T", " ")
            .slice(0, 19),
        exclusive: isEnd && dateOnly
    };
}

// GET /api/transactions/history
// Optional query parameters: start, end
router.get("/history", async (req, res) => {
    let start;
    let end;

    try {
        start = parseDateFilter(req.query.start);
        end = parseDateFilter(req.query.end, true);

        if (start && end) {
            const startMs = Date.parse(start.value + "Z");
            const endMs = Date.parse(end.value + "Z");

            if (
                startMs > endMs ||
                (startMs === endMs && end.exclusive)
            ) {
                throw new Error(
                    "Start date must be before or equal to end date"
                );
            }
        }
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    try {
        const conditions = [];
        const params = [];

        if (start) {
            params.push(start.value);
            conditions.push(
                `p.purchase_date >= $${params.length}::timestamp`
            );
        }

        if (end) {
            params.push(end.value);
            const operator = end.exclusive ? "<" : "<=";

            conditions.push(
                `p.purchase_date ${operator} $${params.length}::timestamp`
            );
        }

        const whereClause = conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const result = await pool.query(`
            SELECT
                p.purchase_id,
                p.store_id,
                s.name AS store_name,
                p.customer_id,
                c.first_name,
                c.last_name,
                p.purchase_date,
                p.payment_method,
                p.account_id,
                p.total
            FROM public.purchase p
            JOIN public.store s
                ON p.store_id = s.store_id
            LEFT JOIN public.customer c
                ON p.customer_id = c.customer_id
            ${whereClause}
            ORDER BY p.purchase_date DESC, p.purchase_id DESC
            LIMIT 100
        `, params);

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error(
            "Transaction history error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Unable to retrieve transaction history"
        });
    }
});

module.exports = router;
