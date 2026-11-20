
const {
    runDistributedTransaction,
    recoverPendingTransactions
} = require("./services/transactionCoordinator");

const {
    supermarketPool,
    bankPool
} = require("./db");

async function main() {
    try {
        // Resolve any previously interrupted test transactions.
        await recoverPendingTransactions();

        const result = await runDistributedTransaction({
            supermarketWork: async (client) => {
                const query = await client.query(`
                    UPDATE public.inventory
                    SET quantity = quantity
                    WHERE store_id = 1
                      AND sku = '1003'
                    RETURNING sku, quantity
                `);

                if (query.rowCount !== 1) {
                    throw new Error("Test inventory row missing");
                }

                return query.rows[0];
            },

            bankWork: async (client) => {
                const query = await client.query(`
                    UPDATE public.bank_account
                    SET balance = balance
                    WHERE account_id = 1
                    RETURNING account_id, balance
                `);

                if (query.rowCount !== 1) {
                    throw new Error("Test bank account missing");
                }

                return query.rows[0];
            }
        });

        console.log("Distributed transaction succeeded!");
        console.log("Transaction ID:", result.transaction_id);
        console.log("Inventory:", result.supermarketResult);
        console.log("Bank:", result.bankResult);

        const pending = await supermarketPool.query(`
            SELECT COUNT(*) AS count
            FROM public.distributed_transactions
            WHERE completed = FALSE
        `);

        console.log("Pending transactions:", pending.rows[0].count);

    } catch (error) {
        console.error("TEST FAILED:", error.message);
        if (error.transactionId) {
            console.error("Transaction ID:", error.transactionId);
        }
        process.exitCode = 1;
    } finally {
        await Promise.all([
            supermarketPool.end(),
            bankPool.end()
        ]);
    }
}

main();
