const express = require("express");
const cors = require("cors");
const pool = require("./db");
const { bankPool } = require("./db");

const {
    initializeCoordinator,
    shutdownCoordinator
} = require("./services/transactionCoordinator");

// route imports
const storeRoutes = require("./routes/stores");
const productRoutes = require("./routes/products");
const inventoryRoutes = require("./routes/inventory");
const reportRoutes = require("./routes/reports");
const adminRoutes = require("./routes/admin");
const tableRoutes = require("./routes/tables");
const simulationRoutes = require("./routes/simulation");
const checkoutRoutes = require("./routes/checkout");
const transactionRoutes = require("./routes/transactions");
const sqlInfoRoutes = require("./routes/sqlInfo");

// create app that handles http req's
const app = express();


// middleware: enables express to interpret frontend JSONs
app.use(cors());
app.use(express.json());

// endpoint: enables express to return JSON response to...
// GET request to /api/health
app.get("/api/health", (req, res) => {
	res.json({
		success: true,
		message: "Supermarket backend running."
	
	});
});

// test PostgreSQL connection
app.get("/api/db-test", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT current_database(), NOW() AS server_time"
        );

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error("Database error:", error.message);

        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});

const PORT = 3000;


if (process.env.DB_MAINTENANCE_MODE === "true") {
    app.use("/api", (req, res, next) => {
        // Allow database administration and diagnostics.
        if (
            req.path.startsWith("/db/") ||
            req.path === "/health" ||
            req.path === "/db-test"
        ) {
            return next();
        }

        return res.status(503).json({
            success: false,
            message: "Application is in database maintenance mode"
        });
    });
}


// route registrations
app.use("/api/stores", storeRoutes);
app.use("/api/products", productRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/db", adminRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/simulation", simulationRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/sql", sqlInfoRoutes);


let server;
let shuttingDown = false;

async function startServer() {
    try {
        // Recover unfinished distributed transactions
        // before accepting HTTP requests.
        if (process.env.DB_MAINTENANCE_MODE !== "true") {
		await initializeCoordinator();
	} else {
		console.log(
			"Maintenance mode: transaction coordinator disabled"
		);
	}

        server = app.listen(PORT, () => {
            console.log(
                `Server running at http://localhost:${PORT}`
            );
        });

        server.on("error", async (error) => {
            console.error("HTTP server error:", error);
            await shutdown("HTTP server error");
        });

    } catch (error) {
        console.error("Server startup failed:", error);

        await shutdownCoordinator();
        await Promise.all([
            pool.end(),
            bankPool.end()
        ]);

        process.exitCode = 1;
    }
}

async function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`Shutting down: ${reason}`);

    try {
        // Stop accepting requests and wait for existing
        // HTTP requests to finish.
        if (server) {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        }

        // Release lock only after requests have finished.
        await shutdownCoordinator();

        await Promise.all([
            pool.end(),
            bankPool.end()
        ]);

        console.log("Server shutdown complete.");

    } catch (error) {
        console.error("Shutdown failed:", error);
        process.exitCode = 1;
    }
}

process.on("SIGINT", () => {
    shutdown("SIGINT");
});

process.on("SIGTERM", () => {
    shutdown("SIGTERM");
});

startServer();
