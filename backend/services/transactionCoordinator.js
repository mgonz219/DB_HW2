
const { randomUUID } = require("crypto");
const {
    supermarketPool,
    bankPool
} = require("../db");

// All GIDs are generated internally from UUIDs.
function quoteGid(gid) {
    if (!/^(store|bank)_[0-9a-f-]{36}$/.test(gid)) {
        throw new Error("Invalid prepared transaction ID");
    }
    return `'${gid}'`;
}

async function isPrepared(pool, gid) {
    const result = await pool.query(`
        SELECT 1
        FROM pg_prepared_xacts
        WHERE gid = $1
          AND database = current_database()
    `, [gid]);

    return result.rowCount > 0;
}

async function resolvePrepared(pool, gid, decision) {
    if (!(await isPrepared(pool, gid))) {
        return;
    }

    const command = decision === "COMMIT"
        ? "COMMIT PREPARED"
        : "ROLLBACK PREPARED";

    await pool.query(`${command} ${quoteGid(gid)}`);
}

// Recover one transaction using its durable decision.
async function recoverTransaction(transactionId) {
    const result = await supermarketPool.query(`
        SELECT *
        FROM public.distributed_transactions
        WHERE transaction_id = $1
    `, [transactionId]);

    if (result.rowCount !== 1) {
        throw new Error("Coordinator record not found");
    }

    const record = result.rows[0];

    if (record.completed) {
        return;
    }

    await resolvePrepared(
        supermarketPool,
        record.store_gid,
        record.decision
    );

    await resolvePrepared(
        bankPool,
        record.bank_gid,
        record.decision
    );

    await supermarketPool.query(`
        UPDATE public.distributed_transactions
        SET completed = TRUE,
            completed_at = CURRENT_TIMESTAMP
        WHERE transaction_id = $1
    `, [transactionId]);
}

// Run this during application startup, before
// accepting new checkout requests.
async function recoverPendingTransactions() {
    const result = await supermarketPool.query(`
        SELECT transaction_id
        FROM public.distributed_transactions
        WHERE completed = FALSE
        ORDER BY created_at
    `);

    for (const record of result.rows) {
        await recoverTransaction(record.transaction_id);
    }

    console.log(
        `Recovered ${result.rowCount} pending distributed transaction(s).`
    );
}

/**
 * Executes work in both databases using 2PC.
 *
 * The callbacks receive separate pg clients.
 * Do not commit or release those clients in callbacks.
 */
async function runDistributedTransaction({
    supermarketWork,
    bankWork
}) {
    if (typeof supermarketWork !== "function" ||
        typeof bankWork !== "function") {
        throw new Error("Both transaction callbacks are required");
    }

    const transactionId = randomUUID();
    const storeGid = `store_${transactionId}`;
    const bankGid = `bank_${transactionId}`;

    // Durable initial decision, BEFORE preparing either DB.
    await supermarketPool.query(`
        INSERT INTO public.distributed_transactions
            (transaction_id, store_gid, bank_gid, decision)
        VALUES ($1, $2, $3, 'ROLLBACK')
    `, [transactionId, storeGid, bankGid]);

    let supermarket = null;
    let bank = null;

    try {
        supermarket = await supermarketPool.connect();
        bank = await bankPool.connect();

        await supermarket.query("BEGIN");
        await bank.query("BEGIN");

        const supermarketResult =
            await supermarketWork(supermarket);

        const bankResult = await bankWork(
            bank,
            supermarketResult
        );

        // Phase 1: Both participants vote to prepare.
        await supermarket.query(
            `PREPARE TRANSACTION ${quoteGid(storeGid)}`
        );

        await bank.query(
            `PREPARE TRANSACTION ${quoteGid(bankGid)}`
        );

        // Durable COMMIT decision.
        // Neither participant commits before this succeeds.
        await supermarketPool.query(`
            UPDATE public.distributed_transactions
            SET decision = 'COMMIT'
            WHERE transaction_id = $1
              AND decision = 'ROLLBACK'
              AND completed = FALSE
        `, [transactionId]);

        // Phase 2: Apply the committed decision.
        await recoverTransaction(transactionId);

        return {
            success: true,
            transaction_id: transactionId,
            supermarketResult,
            bankResult
        };

    } catch (error) {
        // Cancel transactions that have not yet prepared.
        // ROLLBACK on an already-prepared session has no
        // effect on the prepared transaction.
        if (supermarket) {
            try {
                await supermarket.query("ROLLBACK");
            } catch (e) {
                console.error("Store rollback:", e.message);
            }
        }

        if (bank) {
            try {
                await bank.query("ROLLBACK");
            } catch (e) {
                console.error("Bank rollback:", e.message);
            }
        }

        // Read the durable decision instead of guessing.
        // If it was already changed to COMMIT, recovery
        // must finish committing, never roll it back.
        try {
            await recoverTransaction(transactionId);
        } catch (recoveryError) {
            console.error(
                "RECOVERY REQUIRED for",
                transactionId,
                recoveryError.message
            );
        }

        error.transactionId = transactionId;
        throw error;

    } finally {
        if (supermarket) supermarket.release();
        if (bank) bank.release();
    }
}

module.exports = {
    runDistributedTransaction,
    recoverPendingTransactions,
    recoverTransaction
};
