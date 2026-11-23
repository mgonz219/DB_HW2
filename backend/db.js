
require("dotenv").config();

const { Pool } = require("pg");

// Existing supermarket database connection
const supermarketPool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "supermarket_db",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD
});

// New separate banking database connection
const bankPool = new Pool({
    host: process.env.BANK_DB_HOST || "localhost",
    port: Number(process.env.BANK_DB_PORT || 5432),
    database: process.env.BANK_DB_NAME || "bank_db",
    user: process.env.BANK_DB_USER || "postgres",
    password: process.env.BANK_DB_PASSWORD
});

// Preserve existing backend imports that expect a pool.
module.exports = supermarketPool;

// Allow routes and services to access both pools.
module.exports.supermarketPool = supermarketPool;
module.exports.bankPool = bankPool;
