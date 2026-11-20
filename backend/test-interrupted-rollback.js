
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
        // Record the initial durable ROLLBACK decision.
        await supermarketPool.query(`
            INSERT INTO public.distributed_transactions
                (transaction_id, store_gid, bank_gid, decision)
            VALUES ($1, $2, $3, 'ROLLBACK')
        `, [id, storeGid, bankGid]);

        storeClient = await supermarketPool.connect();
        bankClient = await bankPool.connect();

        await storeClient.query("BEGIN");
        await bankClient.query("BEGIN");

        // Harmless update to exercise inventory locking.
        const inventory = await storeClient.query(`
            UPDATE public.inventory
            SET quantity = quantity
            WHERE store_id = 1 AND sku = '1003'
        `);

        if (inventory.rowCount !== 1) {
            throw new Error("Test inventory record missing");
        }

        // Prepare ONLY the supermarket transaction.
        await storeClient.query(
            `PREPARE TRANSACTION '${storeGid}'`
        );

        // The bank transaction never prepares.
        await bankClient.query("ROLLBACK");

        console.log("SIMULATED INTERRUPTION");
        console.log("Transaction ID:", id);
        console.log("Supermarket: PREPARED");
        console.log("Bank: ROLLED BACK");
        console.log("Coordinator decision: ROLLBACK");
        console.log("Recovery required.");

    } catch (error) {
        console.error("Test setup failed:", error.message);
        console.error("Transaction ID:", id);
        console.error("Inspect prepared transactions before retrying.");
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
