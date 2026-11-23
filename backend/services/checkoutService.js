
const {
    runDistributedTransaction
} = require("./transactionCoordinator");

async function processCheckout({
    storeId,
    customerId = null,
    accountId = null,
    paymentMethod,
    items
}) {

    const startTime = process.hrtime.bigint();


    // Validate inputs before opening distributed transactions.
    if (!Number.isSafeInteger(storeId) || storeId <= 0) {
        throw new Error("Invalid store ID");
    }

    if (!["CASH", "CARD"].includes(paymentMethod)) {
        throw new Error("Invalid payment method");
    }

    if (!Array.isArray(items) ||
        items.length < 1 || items.length > 100) {
        throw new Error("Checkout requires 1-100 items");
    }

    if (
        paymentMethod === "CARD" &&
        (!Number.isSafeInteger(customerId) ||
         !Number.isSafeInteger(accountId) ||
         customerId <= 0 ||
         accountId <= 0)
    ) {
        throw new Error("Card payment requires customer and account");
    }

    const quantities = new Map();

    for (const item of items) {
        if (
            typeof item.sku !== "string" ||
            !/^[A-Za-z0-9_-]{1,30}$/.test(item.sku) ||
            typeof item.quantity !== "number" ||
            !Number.isFinite(item.quantity) ||
            item.quantity <= 0 ||
            Math.abs(
                Math.round(item.quantity * 100) -
                item.quantity * 100
            ) > 1e-7
        ) {
            throw new Error("Invalid product or quantity");
        }

        const newQuantity =
            (quantities.get(item.sku) || 0) + item.quantity;

        if (!Number.isFinite(newQuantity) ||
            Math.abs(
                Math.round(newQuantity * 100) -
                newQuantity * 100
            ) > 1e-7) {
            throw new Error("Invalid combined quantity");
        }

        quantities.set(item.sku, newQuantity);
    }

    const skus = [...quantities.keys()].sort();
	const requestedQuantities = skus.map(
		sku => quantities.get(sku)
	);

    const result = await runDistributedTransaction({

        // ==========================================
        // SUPERMARKET DATABASE TRANSACTION
        // ==========================================
        supermarketWork: async (client) => {

            // Lock inventory rows in consistent SKU order.
           const inventoryResult = await client.query(`
				WITH requested AS (
					SELECT sku, requested_quantity
					FROM UNNEST(
						$2::varchar[],
						$3::numeric[]
					) AS r(sku, requested_quantity)
				),
				locked_inventory AS (
					SELECT
						i.sku,
						i.quantity AS stock,
						r.requested_quantity,
						p.name,
						p.price,
						p.taxable,
						p.by_weight,
						st.tax_rate
					FROM public.inventory i
					JOIN requested r ON r.sku = i.sku
					JOIN public.product p ON p.sku = i.sku
					JOIN public.store s ON s.store_id = i.store_id
					JOIN public.state_tax st ON st.state = s.state
					WHERE i.store_id = $1
					ORDER BY i.sku
					FOR UPDATE OF i
				),
				line_amounts AS (
					SELECT
						*,
						ROUND(price * 100, 0) AS unit_cents,
						ROUND(
							ROUND(price * 100, 0) * requested_quantity,
							0
						) AS line_subtotal_cents
					FROM locked_inventory
				),
				calculated AS (
					SELECT
						*,
						CASE
							WHEN taxable THEN
								ROUND(line_subtotal_cents * tax_rate, 0)
							ELSE 0
						END AS line_tax_cents
					FROM line_amounts
				)
				SELECT
					*,
					SUM(line_subtotal_cents) OVER ()
						AS subtotal_cents,
					SUM(line_tax_cents) OVER ()
						AS total_tax_cents
				FROM calculated
				ORDER BY sku
				`, [storeId, skus, requestedQuantities]);

            if (inventoryResult.rows.length !== skus.length) {
                throw new Error("One or more products unavailable");
            }

            const receiptItems = [];

			const subtotalCents = Number(
				inventoryResult.rows[0].subtotal_cents
			);

			const taxCents = Number(
				inventoryResult.rows[0].total_tax_cents
			);

            for (const product of inventoryResult.rows) {
                const quantity = quantities.get(product.sku);

                if (quantity > Number(product.stock)) {
                    throw new Error(
                        `Insufficient inventory for ${product.name}`
                    );
                }

                if (!product.by_weight &&
                    !Number.isInteger(quantity)) {
                    throw new Error(
                        `${product.name} requires a whole-unit quantity`
                    );
                }

                // Preserve original cents-based calculation.
                // Make Financial amounts calculated by PostgreSQL.
				const unitCents = Number(product.unit_cents);
				const lineTaxCents = Number(product.line_tax_cents);

                receiptItems.push({
                    sku: product.sku,
                    name: product.name,
                    quantity,
                    unit_price: (unitCents / 100).toFixed(2),
                    tax_amount: (lineTaxCents / 100).toFixed(2)
                });
            }

            const subtotal =
                (subtotalCents / 100).toFixed(2);

            const total =
                ((subtotalCents + taxCents) / 100).toFixed(2);

            // Create purchase header.
            const purchaseResult = await client.query(`
                INSERT INTO public.purchase
                    (store_id, customer_id, purchase_date,
                     total, payment_method, account_id)
                VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5)
                RETURNING purchase_id
            `, [
                storeId,
                customerId,
                total,
                paymentMethod,
                paymentMethod === "CARD" ? accountId : null
            ]);

            const purchaseId =
                purchaseResult.rows[0].purchase_id;

            // Insert receipt lines and deduct inventory.
            for (let i = 0; i < receiptItems.length; i++) {
                const item = receiptItems[i];

                await client.query(`
                    INSERT INTO public.purchase_item
                        (purchase_id, line_number, sku,
                         quantity, unit_price, tax_amount)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    purchaseId,
                    i + 1,
                    item.sku,
                    item.quantity,
                    item.unit_price,
                    item.tax_amount
                ]);

                await client.query(`
                    UPDATE public.inventory
                    SET quantity = quantity - $1
                    WHERE store_id = $2
                      AND sku = $3
                `, [
                    item.quantity,
                    storeId,
                    item.sku
                ]);
            }

            return {
                purchase_id: purchaseId,
                store_id: storeId,
                customer_id: customerId,
                account_id:
                    paymentMethod === "CARD" ? accountId : null,
                payment_method: paymentMethod,
                items: receiptItems,
                subtotal,
                total
            };
        },

        // ==========================================
        // BANK DATABASE TRANSACTION
        // ==========================================
        bankWork: async (client, purchase) => {

            // Cash payments don't require a bank deduction.
            if (paymentMethod === "CASH") {
                return { payment_method: "CASH" };
            }

            // Lock the bank account and verify ownership.
            const accountResult = await client.query(`
                SELECT balance
                FROM public.bank_account
                WHERE account_id = $1
                  AND customer_id = $2
                FOR UPDATE
            `, [accountId, customerId]);

            if (accountResult.rows.length === 0) {
                throw new Error("Account not found for customer");
            }


			const paymentResult = await client.query(`
				UPDATE public.bank_account
				SET balance = balance - $1
				WHERE account_id = $2
				  AND customer_id = $3
				  AND balance >= $1
				RETURNING account_id
			`, [
				purchase.total,
				accountId,
				customerId
			]);

			if (paymentResult.rowCount !== 1) {
				throw new Error("Insufficient bank balance");
			}
			// Credit the supermarket company's bank account.
			// This runs inside the same banking transaction as the debit.
			const companyResult = await client.query(`
				UPDATE public.bank_account
				SET balance = balance + $1
				WHERE account_type = 'COMPANY'
				RETURNING account_id
			`, [purchase.total]);

			if (companyResult.rowCount !== 1) {
				throw new Error(
					"Expected exactly one company receiving account"
				);
			}


            return {
                payment_method: "CARD",
                account_id: accountId
            };
        }
    });

    // Return the original receipt structure.
    // Calculate total checkout execution time in milliseconds.
    const executionTimeMs =
        Number(process.hrtime.bigint() - startTime) / 1_000_000;

    return {
        success: true,
        ...result.supermarketResult,
        execution_time_ms: Number(executionTimeMs.toFixed(2))
    };
}

module.exports = { processCheckout };
