
const {
    recoverPendingTransactions
} = require("./services/transactionCoordinator");

const {
    supermarketPool,
    bankPool
} = require("./db");

async function main() {
    try {
        await recoverPendingTransactions();
        console.log("Recovery completed successfully.");
    } catch (error) {
        console.error("Recovery failed:", error);
        process.exitCode = 1;
    } finally {
        await Promise.all([
            supermarketPool.end(),
            bankPool.end()
        ]);
    }
}

main();
