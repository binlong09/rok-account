const DiscordBotService = require("./services/discordBot");
const dotenv = require("dotenv");
const winston = require("winston");

// Load environment variables
dotenv.config();

// Configure logger
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple(),
        }),
        new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
        }),
        new winston.transports.File({
            filename: "logs/combined.log",
        }),
    ],
});

async function startApplication() {
    try {
        // Initialize Discord bot service
        const discordBot = new DiscordBotService();

        // Graceful shutdown handlers
        const gracefulShutdown = async (signal) => {
            logger.info(`Received ${signal}. Shutting down gracefully...`);
            await discordBot.shutdown();
            process.exit(0);
        };

        process.on("SIGINT", () => gracefulShutdown("SIGINT"));
        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

        // Start the bot
        await discordBot.login();

        logger.info("Governor Tracker Bot started successfully");
    } catch (error) {
        logger.error("Failed to start application:", error);
        process.exit(1);
    }
}

// Run the application
startApplication();
