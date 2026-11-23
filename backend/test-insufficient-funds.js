


const { processCheckout } =
    require("./services/checkoutService");

const {
    initializeCoordinator,
    shutdownCoordinator
} = require("./services/transactionCoordinator");

const {
    supermarketPool,
    bankPool
} = require("./db");

async function main() {
    try {
        await initializeCoordinator();

        // We deliberately request a purchase far larger
        // than the customer's current account balance.
        await processCheckout({
            storeId: 1,
            customerId: 1,
            accountId: 6,
            paymentMethod: "CARD",
            items: [
			{ sku: "1003", quantity: 1 }
		]
        });

        console.error("TEST FAILED: Purchase was accepted.");
        process.exitCode = 1;

    } catch (error) {
        console.log("Checkout rejected:", error.message);

        if (error.message === "Insufficient bank balance") {
            console.log("TEST PASSED: Insufficient funds rejected.");
        } else {
            console.log("Unexpected rejection reason.");
            process.exitCode = 1;
        }

    } finally {
        await shutdownCoordinator();

        await Promise.all([
            supermarketPool.end(),
            bankPool.end()
        ]);
    }
}

main();
