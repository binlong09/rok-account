const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function debugSupabaseConnection() {
    console.log("Starting Supabase Connection Debugging...");

    // Collect connection details
    const connectionDetails = {
        host: process.env.SUPABASE_DB_HOST,
        port: process.env.SUPABASE_DB_PORT || 5432,
        database: process.env.SUPABASE_DB_NAME || "postgres",
        user: process.env.SUPABASE_DB_USER,
        // Mask password for security
        password: process.env.SUPABASE_DB_PASSWORD ? "********" : "NOT SET",
    };

    console.log(
        "Connection Details:",
        JSON.stringify(connectionDetails, null, 2)
    );

    // Perform DNS lookup
    try {
        const dnsResult = require("dns").lookup(
            connectionDetails.host,
            (err, address, family) => {
                if (err) {
                    console.error("DNS Lookup Error:", err);
                } else {
                    console.log(
                        `DNS Lookup: ${connectionDetails.host} resolves to ${address} (IPv${family})`
                    );
                }
            }
        );
    } catch (dnsError) {
        console.error("DNS Lookup Failed:", dnsError);
    }

    const client = new Client({
        host: connectionDetails.host,
        port: connectionDetails.port,
        database: connectionDetails.database,
        user: connectionDetails.user,
        password: process.env.SUPABASE_DB_PASSWORD,
        ssl: {
            rejectUnauthorized: false,
            // Optionally, you can add a CA cert if needed
            // ca: fs.readFileSync(path.resolve(__dirname, 'path/to/ca-certificate.crt')).toString()
        },
    });

    try {
        console.log("Attempting to connect to Supabase...");
        await client.connect();
        console.log("✅ Connection successful!");

        // Perform a simple query
        const res = await client.query("SELECT NOW()");
        console.log("🕒 Server time:", res.rows[0].now);

        // Optional: Additional diagnostic queries
        const versionRes = await client.query("SELECT version()");
        console.log("📦 PostgreSQL Version:", versionRes.rows[0].version);
    } catch (err) {
        console.error("❌ Connection FAILED:", err);

        // Detailed error analysis
        console.error("\n--- Detailed Error Analysis ---");
        console.error("Error Name:", err.name);
        console.error("Error Code:", err.code);
        console.error("Error Message:", err.message);

        // Specific error type hints
        if (err.code === "ENOTFOUND") {
            console.error(
                "❗ Hostname could not be resolved. Check your host URL."
            );
        } else if (err.code === "ECONNREFUSED") {
            console.error(
                "❗ Connection refused. Check port and firewall settings."
            );
        } else if (err.code === "28P01") {
            console.error(
                "❗ Authentication failed. Verify username and password."
            );
        }
    } finally {
        await client.end();
    }
}

debugSupabaseConnection().catch(console.error);
