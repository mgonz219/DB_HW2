
const { testTwoPhaseCommit } =
    require("./services/transactionCoordinator");

const { supermarketPool, bankPool } = require("./db");

async function main() {
    try {
        await testTwoPhaseCommit();
    } catch (error) {
        console.error("Test unsuccessful:", error.message);
        process.exitCode = 1;
    } finally {
        await Promise.all([
            supermarketPool.end(),
            bankPool.end()
        ]);
    }
}

main();
