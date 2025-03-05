const { Client, GatewayIntentBits, Events } = require("discord.js");
const dotenv = require("dotenv");
const winston = require("winston");
const { DatabaseService, models } = require("../models/sequelize");
const Papa = require("papaparse");
const path = require("path");
const fs = require("fs").promises;

// Load environment variables
dotenv.config();

// Configure Winston logger
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

class DiscordBotService {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Ready event
        this.client.once(Events.ClientReady, () => {
            logger.info(`Logged in as ${this.client.user.tag}`);
        });

        // Error handling
        this.client.on(Events.Error, (error) => {
            logger.error("Discord client error:", error);
        });

        // Message create event (for command handling)
        this.client.on(Events.MessageCreate, async (message) => {
            // Basic command handling can be implemented here
            if (message.content.startsWith("!governor")) {
                await this.handleGovernorCommand(message);
            }
        });
    }

    async handleGovernorCommand(message) {
        try {
            const args = message.content.split(" ");

            switch (args[1]) {
                case "add":
                    await this.addGovernor(message, args);
                    break;
                case "link":
                    await this.linkAccounts(message, args);
                    break;
                case "unlink":
                    await this.unlinkAccounts(message, args);
                    break;
                case "farms":
                    await this.listFarmAccounts(message, args);
                    break;
                case "stats":
                    await this.fetchGovernorStats(message, args);
                    break;
                case "checkfarm":
                    await this.findFarmAccountOwners(message, args);
                    break;
                case "import":
                    await this.importGovernorsFromCSV(message, args);
                    break;
                case "help":
                    this.showHelp(message);
                    break;
                default:
                    message.reply(
                        "Invalid governor command. Use !governor help for usage."
                    );
            }
        } catch (error) {
            logger.error("Error handling governor command:", error);
            message.reply("An error occurred while processing your command.");
        }
    }

    async addGovernor(message, args) {
        try {
            // Example: !governor add 12345 "Governor Name"
            const governorId = parseInt(args[2]);
            const governorName = args.slice(3).join(" ").replace(/"/g, "");

            // Validate inputs
            if (!governorId || isNaN(governorId)) {
                return message.reply(
                    'Please provide a valid Governor ID. Usage: !governor add <GovernorId> "Governor Name"'
                );
            }

            if (!governorName) {
                return message.reply(
                    'Please provide a governor name. Usage: !governor add <GovernorId> "Governor Name"'
                );
            }

            // Check if GovernorId already exists
            const existingGovernor = await models.Account.findByPk(governorId);
            if (existingGovernor) {
                return message.reply(
                    `Governor with ID ${governorId} already exists. Choose a different ID.`
                );
            }

            // Create new governor with specified ID
            const newGovernor = await DatabaseService.create(models.Account, {
                GovernorId: governorId,
                GovernorName: governorName,
            });

            message.reply(
                `Governor ${governorName} added with ID ${governorId}`
            );
        } catch (error) {
            // Handle unique constraint violations
            if (error.name === "SequelizeUniqueConstraintError") {
                message.reply(
                    `Governor ID ${governorId} is already in use. Please choose a different ID.`
                );
            } else {
                logger.error("Error adding governor:", error);
                message.reply("Failed to add governor. Please try again.");
            }
        }
    }

    async linkAccounts(message, args) {
        try {
            // Example: !governor link 12345 67890 89012
            // Support multiple farm accounts
            const mainGovernorId = parseInt(args[2]);
            const farmGovernorIds = args
                .slice(3)
                .map((id) => parseInt(id))
                .filter((id) => !isNaN(id));

            if (!mainGovernorId || farmGovernorIds.length === 0) {
                return message.reply(
                    "Please provide a main governor ID and at least one farm governor ID. Usage: !governor link <MainGovernorId> <FarmGovernorId1> [<FarmGovernorId2> ...]"
                );
            }

            // Check if main account exists
            const mainAccount = await models.Account.findByPk(mainGovernorId);
            if (!mainAccount) {
                return message.reply(
                    `Main governor with ID ${mainGovernorId} does not exist.`
                );
            }

            // Validate farm accounts
            const invalidFarmAccounts = [];
            const validFarmAccounts = [];
            const alreadyLinkedFarmIds = [];

            for (const farmId of farmGovernorIds) {
                const farmAccount = await models.Account.findByPk(farmId);
                if (!farmAccount) {
                    invalidFarmAccounts.push({ id: farmId, name: "Unknown" });
                    continue;
                }

                // Check if this farm account is already linked to another main account
                const existingLink = await models.AccountLink.findOne({
                    where: { FarmGovernorId: farmId },
                });

                if (existingLink) {
                    // If already linked, add to already linked list
                    alreadyLinkedFarmIds.push({
                        farmId,
                        currentMainId: existingLink.MainGovernorId,
                    });
                } else {
                    validFarmAccounts.push({
                        id: farmId,
                        name: farmAccount.GovernorName,
                    });
                }
            }

            // Create links for valid farm accounts
            const links = await Promise.all(
                validFarmAccounts.map((farmAccount) =>
                    DatabaseService.create(models.AccountLink, {
                        MainGovernorId: mainGovernorId,
                        FarmGovernorId: farmAccount.id,
                    })
                )
            );

            // Prepare response message
            let responseMessage = `Linked ${validFarmAccounts.length} farm account(s) to main account ${mainAccount.GovernorName} (ID: ${mainGovernorId}):\n`;
            validFarmAccounts.forEach((farmAccount) => {
                responseMessage += `- Farm Governor: ${farmAccount.name} (ID: ${farmAccount.id})\n`;
            });

            // Add warning for invalid farm IDs if any
            if (invalidFarmAccounts.length > 0) {
                responseMessage += `\nWarning: The following farm IDs are invalid and were not linked:\n`;
                invalidFarmAccounts.forEach((farmAccount) => {
                    responseMessage += `- ID: ${farmAccount.id}\n`;
                });
            }

            if (alreadyLinkedFarmIds.length > 0) {
                responseMessage += `\nNote: The following farm accounts were already linked from another main account:\n`;
                alreadyLinkedFarmIds.forEach((linkInfo) => {
                    responseMessage += `- Farm Governor ID: ${linkInfo.farmId} (Already linked to Main Governor ID: ${linkInfo.currentMainId})\n`;
                });
            }

            message.reply(responseMessage);
        } catch (error) {
            logger.error("Error linking accounts:", error);
            message.reply(`Failed to link accounts. ${error}`);
        }
    }

    async unlinkAccounts(message, args) {
        try {
            // Example: !governor unlink 12345 67890
            const mainGovernorId = parseInt(args[2]);
            const farmGovernorIds = args
                .slice(3)
                .map((id) => parseInt(id))
                .filter((id) => !isNaN(id));

            if (!mainGovernorId || farmGovernorIds.length === 0) {
                return message.reply(
                    "Please provide a main governor ID and at least one farm governor ID. Usage: !governor unlink <MainGovernorId> <FarmGovernorId1> [<FarmGovernorId2> ...]"
                );
            }

            // Remove specific farm links
            const unlinkedCount = await models.AccountLink.destroy({
                where: {
                    MainGovernorId: mainGovernorId,
                    FarmGovernorId: farmGovernorIds,
                },
            });

            message.reply(
                `Unlinked ${unlinkedCount} farm account(s) from main account ${mainGovernorId}`
            );
        } catch (error) {
            logger.error("Error unlinking accounts:", error);
            message.reply(
                "Failed to unlink accounts. Please check the governor IDs and try again."
            );
        }
    }

    async listFarmAccounts(message, args) {
        try {
            // Example: !governor farms 12345
            const mainGovernorId = parseInt(args[2]);

            if (!mainGovernorId) {
                return message.reply(
                    "Please provide a main governor ID. Usage: !governor farms <MainGovernorId>"
                );
            }

            // Find all farm accounts linked to the main account
            const links = await models.AccountLink.findAll({
                where: { MainGovernorId: mainGovernorId },
                include: [
                    {
                        model: models.Account,
                        as: "FarmAccount",
                        attributes: ["GovernorId", "GovernorName"],
                    },
                ],
            });

            if (links.length === 0) {
                return message.reply(
                    `No farm accounts found for main governor ID ${mainGovernorId}`
                );
            }

            // Prepare response message
            let responseMessage = `Farm Accounts for Main Governor ID ${mainGovernorId}:\n`;
            links.forEach((link) => {
                responseMessage += `- Farm Governor ID: ${link.FarmAccount.GovernorId}, Name: ${link.FarmAccount.GovernorName}\n`;
            });

            message.reply(responseMessage);
        } catch (error) {
            logger.error("Error listing farm accounts:", error);
            message.reply(
                "Failed to retrieve farm accounts. Please try again."
            );
        }
    }

    async fetchGovernorStats(message, args) {
        try {
            // Example: !governor stats 12345
            const governorId = parseInt(args[2]);

            if (!governorId) {
                return message.reply(
                    "Please provide a governor ID. Usage: !governor stats <GovernorId>"
                );
            }

            // Fetch the latest stats for the governor
            const stats = await models.AccountStats.findOne({
                where: { GovernorId: governorId },
                include: [
                    {
                        model: models.Account,
                        attributes: ["GovernorName"],
                    },
                ],
            });

            if (!stats) {
                return message.reply(
                    `No stats found for governor ID ${governorId}`
                );
            }

            // Fetch linked farm accounts for context
            const farmLinks = await models.AccountLink.findAll({
                where: { MainGovernorId: governorId },
                include: [
                    {
                        model: models.Account,
                        as: "FarmAccount",
                        attributes: ["GovernorId", "GovernorName"],
                    },
                ],
            });

            // Prepare response message
            let statsMessage = `
**Governor Stats**
Name: ${stats.Account.GovernorName}
Governor ID: ${governorId}
Last Updated: ${stats.SnapshotTime})

**Combat Stats**
- Power: ${stats.Power}
- Kill Points: ${stats.TotalKillPoints}
- Total Deaths: ${stats.Dead}

**Kill Breakdown**
- T1 Kills: ${addDelimiter(stats.T1Kills)}
- T2 Kills: ${addDelimiter(stats.T2Kills)}
- T3 Kills: ${addDelimiter(stats.T3Kills)}
- T4 Kills: ${addDelimiter(stats.T4Kills)}
- T5 Kills: ${addDelimiter(stats.T5Kills)}

**Support**
- RSS Assistance: ${addDelimiter(stats.Assistance)}
- Alliance Helps: ${stats.Helps}
            `;

            // Add farm accounts information if available
            if (farmLinks.length > 0) {
                statsMessage += "\n**Linked Farm Accounts:**\n";
                farmLinks.forEach((link) => {
                    statsMessage += `- Farm Governor ID: ${link.FarmAccount.GovernorId}, Name: ${link.FarmAccount.GovernorName}\n`;
                });
            }

            message.reply(statsMessage);
        } catch (error) {
            logger.error("Error fetching governor stats:", error);
            message.reply(
                "Failed to retrieve governor stats. Please try again."
            );
        }
    }

    async findFarmAccountOwners(message, args) {
        try {
            // Example: !governor checkfarm 67890
            const farmGovernorId = parseInt(args[2]);

            if (!farmGovernorId) {
                return message.reply(
                    "Please provide a farm governor ID. Usage: !governor checkfarm <FarmGovernorId>"
                );
            }

            // Check if the governor exists
            const farmAccount = await models.Account.findByPk(farmGovernorId);
            if (!farmAccount) {
                return message.reply(
                    `No governor found with ID ${farmGovernorId}`
                );
            }

            // Find all main accounts this farm account is linked to
            const links = await models.AccountLink.findAll({
                where: { FarmGovernorId: farmGovernorId },
                include: [
                    {
                        model: models.Account,
                        as: "MainAccount",
                        attributes: ["GovernorId", "GovernorName"],
                    },
                ],
            });

            // Prepare response message
            if (links.length === 0) {
                return message.reply(
                    `Governor ${farmGovernorId} (${farmAccount.GovernorName}) is not linked as a farm account to any main accounts.`
                );
            }

            // Construct detailed response
            let responseMessage = `Farm Account Details:\n`;
            responseMessage += `- Farm Governor ID: ${farmGovernorId}\n`;
            responseMessage += `- Farm Governor Name: ${farmAccount.GovernorName}\n\n`;
            responseMessage += `Linked Main Accounts:\n`;

            links.forEach((link) => {
                responseMessage += `- Main Governor ID: ${link.MainAccount.GovernorId}\n`;
                responseMessage += `  Main Governor Name: ${link.MainAccount.GovernorName}\n`;
            });

            message.reply(responseMessage);
        } catch (error) {
            logger.error("Error finding farm account owners:", error);
            message.reply(
                "Failed to retrieve farm account information. Please try again."
            );
        }
    }

    async importGovernorsFromCSV(message, args) {
        const allowedRoles = ["R4", "Council", "King"];

        // Check if user has any of the allowed roles
        const hasAllowedRole = message.member.roles.cache.some((role) =>
            allowedRoles.includes(role.name)
        );

        // If user doesn't have an allowed role, deny access
        if (!hasAllowedRole) {
            return message.reply(
                `Sorry, you do not have permission to import governors. Only members with ${allowedRoles.join(
                    ", "
                )} roles can use this command.`
            );
        }

        try {
            // Check if a file is attached
            const attachment = message.attachments.first();
            if (!attachment) {
                return message.reply(
                    "Please attach a CSV file when using the import command. Usage: !governor import"
                );
            }

            // Download the file
            const response = await fetch(attachment.url);
            const csvText = await response.text();

            // Parse CSV
            const parsedData = Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: true,
            });

            // Validate CSV structure
            const requiredColumns = [
                "Governor ID",
                "Governor Name",
                "Snapshot Time (UTC)",
            ];

            const missingColumns = requiredColumns.filter(
                (col) => !parsedData.meta.fields.includes(col)
            );

            if (missingColumns.length > 0) {
                return message.reply(
                    `Missing required columns: ${missingColumns.join(", ")}`
                );
            }

            // Track import results
            const importResults = {
                total: parsedData.data.length,
                added: 0,
                updated: 0,
                failed: 0,
                errors: [],
            };

            // Process each governor
            for (const row of parsedData.data) {
                try {
                    // Ensure the governor account exists
                    const [account, accountCreated] =
                        await models.Account.findOrCreate({
                            where: { GovernorId: row["Governor ID"] },
                            defaults: {
                                GovernorId: row["Governor ID"],
                                GovernorName: row["Governor Name"],
                            },
                        });

                    // Prepare stats data
                    const statsData = {
                        GovernorId: row["Governor ID"],
                        GovernorName: row["Governor Name"],
                        SnapshotTime: row["Snapshot Time (UTC)"]
                            ? new Date(row["Snapshot Time (UTC)"])
                            : new Date(),
                        CH: row["CH"],
                        Domain: row["Domain"],
                        Clickable: row["Clickable"],
                        Alliance: row["Alliance"],
                        Power: row["Power"],
                        HighestPower: row["Highest Power"],
                        TroopPower: row["Troop Power"],
                        Victory: row["Victory"],
                        Defeat: row["Defeat"],
                        Helps: row["Helps"],
                        ScoutTimes: row["Scout Times"],
                        Gathered: row["Gathered"],
                        Assistance: row["Assistance"],
                        TotalKillPoints: row["Total Kill Points"],
                        TotalKills: row["Total Kills"],
                        T1Kills: row["T1"],
                        T2Kills: row["T2"],
                        T3Kills: row["T3"],
                        T4Kills: row["T4"],
                        T5Kills: row["T5"],
                        RangedKills: row["Ranged"],
                        Dead: row["Dead"],
                        Healed: row["Healed"],
                        MostUnitsKilled: row["Most Units Killed"],
                        MostUnitsLost: row["Most Units Lost"],
                        MostUnitsHealed: row["Most Units Healed"],
                        Autarch: row["Autarch"],
                        Participated: row["Participated"],
                        Civilization: row["Civilization"],
                    };

                    // Upsert stats
                    await models.AccountStats.upsert(statsData);

                    // Update import results
                    if (accountCreated) {
                        importResults.added++;
                    } else {
                        importResults.updated++;
                    }
                } catch (rowError) {
                    importResults.failed++;
                    importResults.errors.push({
                        governorId: row["Governor ID"],
                        error: rowError.message,
                    });
                }
            }

            // Prepare detailed response
            let responseMessage = `CSV Import Results:\n`;
            responseMessage += `- Total Governors: ${importResults.total}\n`;
            responseMessage += `- Added: ${importResults.added}\n`;
            responseMessage += `- Updated: ${importResults.updated}\n`;
            responseMessage += `- Failed: ${importResults.failed}\n`;

            // Include errors if any
            if (importResults.errors.length > 0) {
                responseMessage += `\nErrors:\n`;
                importResults.errors.forEach((err) => {
                    responseMessage += `- Governor ID ${err.governorId}: ${err.error}\n`;
                });
            }

            message.reply(responseMessage);
        } catch (error) {
            logger.error("Error importing governors:", error);
            message.reply(
                "Failed to import governors. Please check the CSV file and try again."
            );
        }
    }

    showHelp(message) {
        var helpMessage = `
**Governor Tracker Bot Commands**
- \`!governor add <GovernorId> "Governor Name"\`: Add a new governor with a specific ID
- \`!governor link <MainGovernorId> <FarmGovernorId1> [<FarmGovernorId2> ...]\`: Link multiple farm accounts to a main account
- \`!governor unlink <MainGovernorId> <FarmGovernorId1> [<FarmGovernorId2> ...]\`: Unlink farm accounts from a main account
- \`!governor farms <MainGovernorId>\`: List all farm accounts for a main account
- \`!governor checkfarm <FarmGovernorId>\`: Find main account(s) that own a specific farm account
- \`!governor stats <GovernorId>\`: View latest stats for a governor
- \`!governor import\`: Import governors and their stats from a CSV file
- \`!governor help\`: Show this help message

    `;
        const allowedRoles = ["R4", "Council", "King"];

        // Check if user has any of the allowed roles
        const hasAllowedRole = message.member.roles.cache.some((role) =>
            allowedRoles.includes(role.name)
        );

        // If user does have special roles, add help message
        if (hasAllowedRole) {
            helpMessage += `
**CSV Import Guide (Visible to Officers Only)**
🔒 **Import Restrictions**
- Only users with \`R4\`, \`Council\`, or \`King\` roles can import governors
- Unauthorized role attempts will be denied
1. Prepare Your CSV File:
- Use comma-separated values (.csv)
- Include required columns: Governor ID, Governor Name, Snapshot Time (UTC)
- Optional columns include: Alliance, Power, Kills, etc.

2. How to Import:
   a) Open Discord
   b) Navigate to the bot's channel
   c) Click the "+" button to attach a file
   d) Select your prepared CSV file
   e) Type \`!governor import\` in the message
   f) Send the message with the attached CSV

**Troubleshooting**
- Ensure all required columns are present
- Check that GovernorId is unique
- Verify date format is correct
- No special characters in column names
            `;
        }

        message.reply(helpMessage);
    }

    async login() {
        try {
            // Initialize database connection
            await DatabaseService.initialize();

            // Login to Discord
            await this.client.login(process.env.DISCORD_BOT_TOKEN);
            logger.info("Bot logged in successfully");
        } catch (error) {
            logger.error("Failed to log in:", error);
            process.exit(1);
        }
    }

    async shutdown() {
        try {
            // Close database connection
            await DatabaseService.close();

            // Destroy Discord client
            await this.client.destroy();
            logger.info("Bot shut down successfully");
        } catch (error) {
            logger.error("Error during bot shutdown:", error);
        }
    }
}

function addDelimiter(number, delimiter = ",") {
    return number.toLocaleString().replace(/\B(?=(\d{3})+(?!\d))/g, delimiter);
}

module.exports = DiscordBotService;
