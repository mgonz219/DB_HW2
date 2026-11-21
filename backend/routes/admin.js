
const express = require("express");
const router = express.Router();

const fs = require("fs/promises");
const path = require("path");

const {
    supermarketPool,
    bankPool
} = require("../db");

const DATABASE_DIR = path.join(__dirname, "../../database");

// Only our supermarket application tables.
// Drop child tables before their parents.
const DROP_STORE_TABLES_SQL = `
    DROP TABLE IF EXISTS
        public.purchase_item,
        public.purchase,
        public.inventory,
        public.aisle,
        public.product,
        public.store,
        public.customer,
        public.state_tax,
        public.distributed_transactions,
        public.distributed_participant_commits
    CASCADE;
`;

const CLEAR_STORE_DATA_SQL = `
    TRUNCATE TABLE
        public.purchase_item,
        public.purchase,
        public.inventory,
        public.aisle,
        public.product,
        public.store,
        public.customer,
        public.state_tax,
        public.distributed_transactions,
        public.distributed_participant_commits
    RESTART IDENTITY CASCADE;
`;

const DROP_BANK_TABLES_SQL = `
    DROP TABLE IF EXISTS
        public.distributed_participant_commits,
        public.bank_account
    CASCADE;
`;

const CLEAR_BANK_DATA_SQL = `
    TRUNCATE TABLE
        public.distributed_participant_commits,
        public.bank_account
    RESTART IDENTITY CASCADE;
`;

async function readScript(filename) {
    return fs.readFile(
        path.join(DATABASE_DIR, filename),
        "utf8"
    );
}

// Admin actions are permitted only in maintenance mode.
// The server must also block checkout traffic in this mode.
router.use((req, res, next) => {
    if (process.env.DB_MAINTENANCE_MODE !== "true") {
        return res.status(503).json({
            success: false,
            message: "Database administration requires maintenance mode"
        });
    }

    next();
});

// Prevent destructive operations while PostgreSQL has
// unresolved prepared transactions or coordinator records.

async function assertSafeToRebuild() {
    // Check both databases for unresolved prepared transactions.
    for (const pool of [supermarketPool, bankPool]) {
        const prepared = await pool.query(`
            SELECT gid
            FROM pg_prepared_xacts
            WHERE database = current_database()
        `);

        if (prepared.rowCount > 0) {
            throw new Error(
                "Cannot administer databases with prepared transactions"
            );
        }
    }

    // A brand-new database won't have this table yet.
    const tableCheck = await supermarketPool.query(`
        SELECT to_regclass(
            'public.distributed_transactions'
        ) AS table_name
    `);

    if (tableCheck.rows[0].table_name === null) {
        // Safe to proceed with initialization.
        return;
    }

    // If the coordinator table exists, ensure that
    // no distributed transactions remain unresolved.
    const pending = await supermarketPool.query(`
        SELECT COUNT(*)::integer AS count
        FROM public.distributed_transactions
        WHERE completed = FALSE
    `);

    if (pending.rows[0].count > 0) {
        throw new Error(
            "Cannot administer databases with pending distributed transactions"
        );
    }
}


// One PostgreSQL transaction, within one database.
// This does not make changes across both databases atomic.
async function executeInTransaction(pool, work) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await work(client);
        await client.query("COMMIT");
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Admin rollback failed:", rollbackError);
        }

        throw error;
    } finally {
        client.release();
    }
}

// POST /api/db/init
router.post("/init", async (req, res) => {
    try {
        await assertSafeToRebuild();

        const storeSchema = await readScript("schema.sql");
        const bankSchema = await readScript("bank_schema.sql");

        await executeInTransaction(supermarketPool, async (client) => {
            await client.query(DROP_STORE_TABLES_SQL);
            await client.query(storeSchema);
        });

        await executeInTransaction(bankPool, async (client) => {
            await client.query(DROP_BANK_TABLES_SQL);
            await client.query(bankSchema);
        });

        res.json({
            success: true,
            message: "Both database schemas recreated successfully"
        });

    } catch (error) {
        console.error("Database init error:", error);

        res.status(500).json({
            success: false,
            message: "Database initialization failed",
            error: error.message
        });
    }
});

// POST /api/db/seed
router.post("/seed", async (req, res) => {
    try {
        await assertSafeToRebuild();

        const storeSeed = await readScript("seed.sql");
        const bankSeed = await readScript("bank_seed.sql");

        await executeInTransaction(supermarketPool, async (client) => {
            await client.query(CLEAR_STORE_DATA_SQL);
            await client.query(storeSeed);
        });

        await executeInTransaction(bankPool, async (client) => {
            await client.query(CLEAR_BANK_DATA_SQL);
            await client.query(bankSeed);
        });

        res.json({
            success: true,
            message: "Both databases seeded successfully"
        });

    } catch (error) {
        console.error("Database seed error:", error);

        res.status(500).json({
            success: false,
            message: "Database seeding failed",
            error: error.message
        });
    }
});

// POST /api/db/reset
router.post("/reset", async (req, res) => {
    if (req.body?.confirm !== true) {
        return res.status(400).json({
            success: false,
            message: "Explicit confirmation required"
        });
    }

    try {
        await assertSafeToRebuild();

        await executeInTransaction(supermarketPool, async (client) => {
            await client.query(CLEAR_STORE_DATA_SQL);
        });

        await executeInTransaction(bankPool, async (client) => {
            await client.query(CLEAR_BANK_DATA_SQL);
        });

        res.json({
            success: true,
            message: "Both databases cleared successfully"
        });

    } catch (error) {
        console.error("Database reset error:", error);

        res.status(500).json({
            success: false,
            message: "Database reset failed",
            error: error.message
        });
    }
});

module.exports = router;
