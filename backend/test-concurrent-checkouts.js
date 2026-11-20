
const { processCheckout } =
    require("./services/checkoutService");

const {
    initializeCoordinator,
    shutdownCoordinator
} = require("./services/transactionCoordinator");

const { supermarketPool, bankPool } = require("./db");

async function main() {
    try {
        await initializeCoordinator();

        // Change this to the account_id returned by PostgreSQL.
        const accountId = 7;

        const checkout = () => processCheckout({
            storeId: 1,
            customerId: 1,
            accountId,
            paymentMethod: "CARD",
            items: [
                { sku: "1003", quantity: 1 },
                { sku: "1009", quantity: 2 }
            ]
        });

        console.log("Launching two simultaneous checkouts...");

        const results = await Promise.allSettled([
            checkout(),
            checkout()
        ]);

        results.forEach((result, index) => {
            if (result.status === "fulfilled") {
                console.log(
                    `Checkout ${index + 1}: SUCCESS`,
                    result.value.purchase_id,
                    result.value.total
                );
            } else {
                console.log(
                    `Checkout ${index + 1}: REJECTED`,
                    result.reason.message
                );
            }
        });

        const successes = results.filter(
            result => result.status === "fulfilled"
        ).length;

        const insufficientFunds = results.filter(
            result =>
                result.status === "rejected" &&
                result.reason.message ===
                    "Insufficient bank balance"
        ).length;

        if (successes === 1 && insufficientFunds === 1) {
            console.log("TEST PASSED: Double spending prevented.");
        } else {
            console.error("TEST FAILED: Unexpected outcomes.");
            process.exitCode = 1;
        }

    } catch (error) {
        console.error("Test error:", error.message);
        process.exitCode = 1;

    } finally {
        await shutdownCoordinator();

        await Promise.all([
            supermarketPool.end(),
            bankPool.end()
        ]);
    }
}

main();
