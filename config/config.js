require("dotenv").config();

module.exports = {
    development: {
        username: process.env.SUPABASE_DB_USER || "postgres",
        password: process.env.SUPABASE_DB_PASSWORD,
        database: process.env.SUPABASE_DB_NAME || "postgres",
        host: process.env.SUPABASE_DB_HOST,
        port: process.env.SUPABASE_DB_PORT || 5432,
        dialect: "postgres",
        logging: process.env.NODE_ENV === "development" ? console.log : false,
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false, // Important for Supabase
            },
        },
    },
    production: {
        username: process.env.SUPABASE_DB_USER,
        password: process.env.SUPABASE_DB_PASSWORD,
        database: process.env.SUPABASE_DB_NAME,
        host: process.env.SUPABASE_DB_HOST,
        port: process.env.SUPABASE_DB_PORT,
        dialect: "postgres",
        logging: false,
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false,
            },
        },
    },
};
