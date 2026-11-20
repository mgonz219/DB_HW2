
const { randomUUID } = require("crypto");
const {
    supermarketPool,
    bankPool
} = require("./db");

async function main() {
    const id = randomUUID();
    const storeGid = `store_${id}`;
    const bankGid = `bank_${id}`;

    let storeClient;
    let bankClient;

    try {
        // Record initial recovery decision.
        await supermarketPool.query(`
            INSERT INTO public.distributed_transactions
                (transaction_id, store_gid, bank_gid, decision)
            VALUES ($1, $2, $3, 'ROLLBACK')
        `, [id, storeGid, bankGid]);

        storeClient = await supermarketPool.connect();
        bankClient = await bankPool.connect();

        await storeClient.query("BEGIN");
        await bankClient.query("BEGIN");

        // No-op changes; existing values remain unchanged.
        const inventory = await storeClient.query(`
            UPDATE public.inventory
            SET quantity = quantity
            WHERE store_id = 1 AND sku = '1003'
        `);

        const account = await bankClient.query(`
            UPDATE public.bank_account
            SET balance = balance
            WHERE account_id = 1
        `);

        if (inventory.rowCount !== 1 || account.rowCount !== 1) {
            throw new Error("Required test records not found");
        }

        // Prepare both database transactions.
        await storeClient.query(
            `PREPARE TRANSACTION '${storeGid}'`
        );

        await bankClient.query(
            `PREPARE TRANSACTION '${bankGid}'`
        );

        // Record the durable commit decision.
        await supermarketPool.query(`
            UPDATE public.distributed_transactions
            SET decision = 'COMMIT'
            WHERE transaction_id = $1
        `, [id]);

        // Commit ONLY the supermarket transaction.
        await supermarketPool.query(
            `COMMIT PREPARED '${storeGid}'`
        );

        console.log("SIMULATED INTERRUPTION");
        console.log("Transaction ID:", id);
        console.log("Supermarket: COMMITTED");
        console.log("Bank: PREPARED but not committed");
        console.log("Recovery required.");

    } catch (error) {
        console.error("Test setup failed:", error.message);
        console.error("Transaction ID:", id);
        console.error("Check pg_prepared_xacts before proceeding.");
        process.exitCode = 1;

    } finally {
        if (storeClient) {
            try { await storeClient.query("ROLLBACK"); }
            catch (_) {}
            storeClient.release();
        }

        if (bankClient) {
            try { await bankClient.query("ROLLBACK"); }
            catch (_) {}
            bankClient.release();
        }

        await Promise.all([
            supermarketPool.end(),
            bankPool.end()
        ]);
    }
}

main();
