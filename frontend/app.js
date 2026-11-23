
const BASE = "http://localhost:3000/api";

// ==========================================
// API HELPERS
// ==========================================

async function sendRequest(
    endpoint,
    method = "GET",
    payload = null,
    signal = undefined
) {
    const options = {
        method,
        headers: { "Content-Type": "application/json" },
        signal
    };

    if (payload !== null && method !== "GET") {
        options.body = JSON.stringify(payload);
    }

    const response = await fetch(`${BASE}/${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            data.error ||
            data.message ||
            `Request failed (${response.status})`
        );
    }

    return data;
}

async function checkHealth() {
    return sendRequest("health");
}

async function checkDB() {
    return sendRequest("db-test");
}

// ==========================================
// TABLE RENDERING
// ==========================================

function renderTable($head, $body, rows = []) {
    $head.empty();
    $body.empty();

    if (!Array.isArray(rows) || rows.length === 0) {
        $body.append(
            $("<tr>").append(
                $("<td>")
                    .attr("colspan", 100)
                    .text("No data returned")
            )
        );
        return;
    }

    const headers = Object.keys(rows[0]);

    for (const header of headers) {
        $head.append($("<th>").text(header));
    }

    for (const row of rows) {
        const $tr = $("<tr>");

        for (const header of headers) {
            const value = row[header];

            $tr.append(
                $("<td>").text(
                    value === null || value === undefined
                        ? "NULL"
                        : typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value)
                )
            );
        }

        $body.append($tr);
    }
}

const tableEndpoints = {
    stateTax: "state_tax",
    store: "store",
    aisle: "aisle",
    inventory: "inventory",
    customer: "customer",
    product: "product",
    purchaseItem: "purchase_item",
    purchase: "purchase",
    bankAccount: "bank_account"
};

// ==========================================
// PAGE INITIALIZATION
// ==========================================

$(function () {
    const $outputLog = $("#outputLog");
    const $simFeed = $("#simLogContainer");

    let activeSimulation = null;

    // ======================================
    // TAB NAVIGATION
    // ======================================

    $(".tabBtn").on("click", function () {
        const targetTab = $(this).data("tab");

        $(".tabBtn").removeClass("active");
        $(".tabContent").removeClass("active");

        $(this).addClass("active");
        $(`#${targetTab}`).addClass("active");

        if (targetTab === "tabHistory") {
            loadTransactionHistory();
        }
    });

    // ======================================
    // HEALTH AND DATABASE CONNECTION
    // ======================================

    $("#healthCheck").on("click", async () => {
        $outputLog.text("Checking backend connection...");

        try {
            const result = await checkHealth();
            $outputLog.text(JSON.stringify(result, null, 2));
        } catch (error) {
            $outputLog.text(
                `Server unreachable: ${error.message}`
            );
        }
    });

    $("#dbCheck").on("click", async () => {
        $outputLog.text("Checking database connections...");

        try {
            const result = await checkDB();
            $outputLog.text(JSON.stringify(result, null, 2));
        } catch (error) {
            $outputLog.text(
                `Database connection error: ${error.message}`
            );
        }
    });

    // ======================================
    // DATABASE INITIALIZATION
    // ======================================


	$("#initTables").on("click", async () => {
		const confirmed = window.confirm(
			"WARNING: This will delete and recreate all tables in BOTH databases.\n\nContinue?"
		);

		if (!confirmed) {
			$outputLog.text("Initialization canceled.");
			return;
		}

		$outputLog.text("Initializing tables...");

		try {
			const result = await sendRequest(
				"db/init",
				"POST"
			);

			$outputLog.text(JSON.stringify(result, null, 2));
		} catch (error) {
			$outputLog.text(
				`Initialization error: ${error.message}`
			);
		}
	});


    $("#randomInit").on("click", async () => {
        const confirmed = window.confirm(
            "Initialize the database with baseline seed data?"
        );

        if (!confirmed) return;

        $outputLog.text("Seeding database...");

        try {
            const result = await sendRequest(
                "db/seed",
                "POST"
            );

            $outputLog.text(JSON.stringify(result, null, 2));
        } catch (error) {
            $outputLog.text(
                `Seed error: ${error.message}`
            );
        }
    });

    $("#dropTables").on("click", async () => {
        const confirmed = window.confirm(
            "DANGER: This operation clears database data.\n\n" +
            "Are you sure?"
        );

        if (!confirmed) {
            $outputLog.text("Reset canceled.");
            return;
        }

        $outputLog.text("Resetting database...");

        try {
            const result = await sendRequest(
                "db/reset",
                "POST",
                { confirm: true }
            );

            $outputLog.text(JSON.stringify(result, null, 2));

            renderTable(
                $("#inspectHeadRow"),
                $("#inspectBody")
            );
        } catch (error) {
            $outputLog.text(
                `Reset error: ${error.message}`
            );
        }
    });

    // ======================================
    // TABLE INSPECTION
    // ======================================

    $("#viewTable").on("change", async () => {
        const selected = $("#viewTable").val();
        const endpoint = tableEndpoints[selected];

        const $head = $("#inspectHeadRow");
        const $body = $("#inspectBody");

        $head.empty();
        $body.empty();

        if (!endpoint) return;

        try {
            const result = await sendRequest(
                `tables/${endpoint}`
            );

            renderTable($head, $body, result.data);
        } catch (error) {
            $outputLog.text(
                `Table inspection error: ${error.message}`
            );

            $body.append(
                $("<tr>").append(
                    $("<td>")
                        .attr("colspan", 100)
                        .text(error.message)
                )
            );
        }
    });

    // ======================================
    // SIMULATION CONTROLS
    // ======================================

    function setSimulationRunning(running) {
        $("#btnRunOneSim").prop("disabled", running);
        $("#btnStopSim").prop("disabled", !running);
    }

    $("#btnStopSim").on("click", () => {
        if (!activeSimulation) return;

        const run = activeSimulation;
        run.stopped = true;

        $("#simRunStatus").text(
            "Stop requested. Outstanding browser requests " +
            "have been canceled. Check Transaction History " +
            "to verify final database outcomes."
        );

        for (const controller of run.controllers) {
            controller.abort();
        }

        $("#btnStopSim").prop("disabled", true);
    });

    // ======================================
    // CONCURRENT CHECKOUT SIMULATION
    // ======================================


$("#btnRunOneSim").on("click", async () => {
    if (activeSimulation) return;

    const storeId = Number($("#simStoreId").val());
    const itemCount = Number($("#simItemCount").val() || 12);
    const paymentMethod = $("#simPaymentMethod").val();
    const concurrentClients = Number($("#simConClients").val());
    const totalCustomers = Number($("#simTotalCustomers").val());

    if (
        !Number.isSafeInteger(storeId) || storeId < 1 ||
        !Number.isSafeInteger(itemCount) || itemCount < 10 || itemCount > 20 ||
        !Number.isSafeInteger(concurrentClients) ||
        concurrentClients < 1 || concurrentClients > 10 ||
        !Number.isSafeInteger(totalCustomers) ||
        totalCustomers < 1 || totalCustomers > 1000 ||
        !["CARD", "CASH"].includes(paymentMethod)
    ) {
        $("#simRunStatus").text("Invalid simulation settings.");
        return;
    }

    const run = {
        stopped: false,
        controllers: []
    };

    activeSimulation = run;
    setSimulationRunning(true);
    $simFeed.empty();

    let completed = 0;
    let committed = 0;
    let failed = 0;
    let stoppedRequests = 0;

    $("#simRunStatus").text(
        `Running 0/${totalCustomers} customers...`
    );

    async function checkoutCustomer(customerNumber) {
        if (run.stopped) return;

        const controller = new AbortController();
        run.controllers.push(controller);

        const $card = $("<div>")
            .addClass("simCard pending")
            .append(
                $("<h4>").text(
                    `Customer #${customerNumber} — Processing`
                )
            );

        $simFeed.prepend($card);

        try {
            const result = await sendRequest(
                "simulation/checkout",
                "POST",
                {
                    store_id: storeId,
                    item_count: itemCount,
                    payment_method: paymentMethod
                },
                controller.signal
            );

            const receipt = Array.isArray(result.simulations)
                ? result.simulations[0]
                : result;

            if (!receipt || !receipt.success || !receipt.purchase_id) {
                throw new Error(
                    result.message || "Invalid checkout response"
                );
            }

            committed++;

            $card.removeClass("pending").addClass("committed").empty();

            $card.append(
                $("<h4>").text(
                    `Transaction #${receipt.purchase_id} — Committed`
                )
            );

            $card.append(
                $("<p>").text(
                    `Customer: ${receipt.customer_id ?? "Guest"} | ` +
                    `Payment: ${receipt.payment_method} | ` +
                    `Account: ${receipt.account_id ?? "N/A"}`
                )
            );

            const $items = $("<ul>");

            for (const item of receipt.items || []) {
                const lineTotal =
                    Number(item.quantity) * Number(item.unit_price);

                $items.append(
                    $("<li>").text(
                        `${item.name || item.sku} — ` +
                        `${item.quantity} × $${item.unit_price} = ` +
                        `$${lineTotal.toFixed(2)}`
                    )
                );
            }

            $card.append($items);

            const subtotal = Number(receipt.subtotal);
            const total = Number(receipt.total);

            $card.append(
                $("<div>")
                    .addClass("totals")
                    .text(
                        `Subtotal: $${subtotal.toFixed(2)} | ` +
                        `Tax: $${(total - subtotal).toFixed(2)} | ` +
                        `Total: $${total.toFixed(2)} | ` +
                        `Time: ${receipt.execution_time_ms ?? "N/A"} ms`
                    )
            );

        } catch (error) {
            $card.removeClass("pending").empty();

            if (error.name === "AbortError") {
                stoppedRequests++;
                $card.addClass("stopped");

                $card.append(
                    $("<h4>").text(
                        `Customer #${customerNumber} — Request stopped`
                    )
                );

                $card.append(
                    $("<p>").text(
                        "Database outcome unknown. Check Transaction History."
                    )
                );
            } else {
                failed++;
                $card.addClass("aborted");

                $card.append(
                    $("<h4>").text(
                        `Customer #${customerNumber} — Checkout failed`
                    )
                );

                $card.append(
                    $("<p>").text(error.message)
                );
            }
        } finally {
            completed++;

            if (activeSimulation === run) {
                $("#simRunStatus").text(
                    `${completed}/${totalCustomers} requests finished | ` +
                    `${committed} committed | ${failed} failed | ` +
                    `${stoppedRequests} stopped`
                );
            }
        }
    }

    try {
        // Process customers in batches, with concurrent checkouts.
        for (
            let start = 1;
            start <= totalCustomers && !run.stopped;
            start += concurrentClients
        ) {
            const batch = [];

            const lastCustomer = Math.min(
                start + concurrentClients - 1,
                totalCustomers
            );

            for (
                let customer = start;
                customer <= lastCustomer && !run.stopped;
                customer++
            ) {
                batch.push(checkoutCustomer(customer));
            }

            await Promise.allSettled(batch);

            // Give the browser an opportunity to process Stop.
            if (start + concurrentClients <= totalCustomers) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        $("#simRunStatus").text(
            `${run.stopped ? "Stopped" : "Finished"} | ` +
            `${completed}/${totalCustomers} requests finished | ` +
            `${committed} committed | ${failed} failed | ` +
            `${stoppedRequests} stopped`
        );
    } finally {
        activeSimulation = null;
        setSimulationRunning(false);
    }
});


    // ======================================
    // DETERMINISTIC INTEGRATION TEST
    // ======================================

    $("#btnTestHardcodedCheckout").on("click", async () => {
        const $card = $("<div>")
            .addClass("simCard pending");

        $card.append(
            $("<h4>").text(
                "Deterministic Test — Processing"
            )
        );

        $simFeed.prepend($card);

        try {
            const result = await sendRequest(
                "checkout/test",
                "POST",
                { account_id: 1 }
            );

            const receipt = Array.isArray(result.simulations)
                ? result.simulations[0]
                : result;

            if (!receipt || !receipt.success) {
                throw new Error(
                    result.message || "Checkout failed"
                );
            }

            $card
                .removeClass("pending")
                .addClass("committed")
                .empty();

            $card.append(
                $("<h4>").text(
                    `Transaction #${receipt.purchase_id} — Committed`
                )
            );

            const $items = $("<ul>");

            for (const item of receipt.items || []) {
                $items.append(
                    $("<li>").text(
                        `${item.name || item.sku} — ` +
                        `Quantity: ${item.quantity} | ` +
                        `Unit price: $${item.unit_price}`
                    )
                );
            }

            $card.append($items);

            $card.append(
                $("<div>")
                    .addClass("totals")
                    .text(
                        `Total: $${receipt.total} | ` +
                        `Time: ${receipt.execution_time_ms ?? "N/A"} ms`
                    )
            );
        } catch (error) {
            $card
                .removeClass("pending")
                .addClass("aborted")
                .empty();

            $card.append(
                $("<h4>").text("Deterministic test failed")
            );

            $card.append(
                $("<p>").text(error.message)
            );
        }
    });
	 // ======================================
    // CHECKOUT SQL DISPLAY
    // ======================================

    $("#btnShowCheckoutSQL").on("click", async () => {
        const $display = $("#checkoutSQLDisplay");

        $display.text("Loading checkout SQL...");

        try {
            const result = await sendRequest("sql/checkout");

            if (!Array.isArray(result.queries)) {
                throw new Error("Invalid SQL response");
            }

            const formatted = result.queries.map((query, index) => {
                return (
                    `QUERY ${index + 1}\n` +
                    `Database: ${query.database}\n` +
                    `Operation: ${query.operation}\n\n` +
                    `${query.sql}\n` +
                    "----------------------------------------"
                );
            }).join("\n\n");

            $display.text(formatted);

        } catch (error) {
            $display.text(
                `Unable to retrieve SQL queries: ${error.message}`
            );
        }
    });

    // ======================================
    // ANALYTICAL REPORTS
    // ======================================

    async function loadReport(endpoint) {
        const $head = $("#tableHeadRow");
        const $body = $("#tableBody");

        $head.empty();
        $body.empty();

        $body.append(
            $("<tr>").append(
                $("<td>")
                    .attr("colspan", 100)
                    .text("Loading analytical report...")
            )
        );

        try {
            const result = await sendRequest(
                `reports/${endpoint}`
            );

            renderTable(
                $head,
                $body,
                result.data || []
            );

            $outputLog.text(
                `Report completed. Retrieved ` +
                `${result.data?.length ?? 0} rows.`
            );
        } catch (error) {
            $head.empty();
            $body.empty();

            $body.append(
                $("<tr>").append(
                    $("<td>")
                        .attr("colspan", 100)
                        .text(
                            `Report failed: ${error.message}`
                        )
                )
            );
        }
    }

    $("#btnReportStoreSales").on("click", () => {
        loadReport("store-sales");
    });

    $("#btnReportTopProducts").on("click", () => {
        loadReport("top-products");
    });

    $("#btnReportInventoryLevels").on("click", () => {
        loadReport("low-stock");
    });

    // ======================================
    // TRANSACTION HISTORY
    // ======================================

    async function loadTransactionHistory() {
        const $body = $("#historyBody");

        $body.empty();
        $body.append(
            $("<tr>").append(
                $("<td>")
                    .attr("colspan", 7)
                    .text("Loading transaction history...")
            )
        );

        try {
            const start = $("#historyStart").val();
			const end = $("#historyEnd").val();

			if (start && end && start > end) {
				throw new Error("Start date must be before end date.");
			}

			const params = new URLSearchParams();

			if (start) params.set("start", start);
			if (end) params.set("end", end);

			const query = params.toString();

			const result = await sendRequest(
				`transactions/history${query ? `?${query}` : ""}`
			);

            $body.empty();

            if (!result.data || result.data.length === 0) {
                $body.append(
                    $("<tr>").append(
                        $("<td>")
                            .attr("colspan", 7)
                            .text("No transaction records available.")
                    )
                );
                return;
            }

            for (const tx of result.data) {
                const $row = $("<tr>");

                const values = [
                    tx.purchase_id,
                    tx.store_id,
                    tx.customer_id ?? "Guest",
                    new Date(tx.purchase_date).toLocaleString(),
                    tx.payment_method,
                    tx.account_id ?? "N/A",
                    `$${Number(tx.total).toFixed(2)}`
                ];

                for (const value of values) {
                    $row.append(
                        $("<td>").text(value)
                    );
                }

                $body.append($row);
            }
        } catch (error) {
            $body.empty();

            $body.append(
                $("<tr>").append(
                    $("<td>")
                        .attr("colspan", 7)
                        .text(
                            `Unable to retrieve history: ${error.message}`
                        )
                )
            );
        }
    }

    $("#btnRefreshHistory").on(
        "click",
        loadTransactionHistory
    );
	$("#btnClearHistoryFilters").on("click", () => {
		$("#historyStart").val("");
		$("#historyEnd").val("");
		loadTransactionHistory();
	});

});
