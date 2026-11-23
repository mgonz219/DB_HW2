
const { supermarketPool, bankPool } = require("./db");

async function testConnections() {
    try {
        const supermarket = await supermarketPool.query(
            "SELECT current_database() AS db"
        );

        const bank = await bankPool.query(
            "SELECT current_database() AS db"
        );

        console.log("Supermarket:", supermarket.rows[0].db);
        console.log("Bank:", bank.rows[0].db);

        const accounts = await bankPool.query(
            "SELECT COUNT(*) AS total FROM public.bank_account"
        );

        console.log("Bank accounts:", accounts.rows[0].total);

    } catch (error) {
        console.error("Database connection error:", error.message);
        process.exitCode = 1;
    } finally {
        await Promise.all([
            supermarketPool.end(),
            bankPool.end()
        ]);
    }
}

testConnections();
