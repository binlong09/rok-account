const { Sequelize, DataTypes, Model } = require("sequelize");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Create Sequelize instance
const sequelize = new Sequelize(
    process.env.SUPABASE_DB_NAME || "postgres",
    process.env.SUPABASE_DB_USER || "postgres",
    process.env.SUPABASE_DB_PASSWORD,
    {
        host: process.env.SUPABASE_DB_HOST,
        port: process.env.SUPABASE_DB_PORT || 5432,
        dialect: "postgres",
        logging: process.env.NODE_ENV === "development" ? console.log : false,
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false,
            },
        },
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000,
        },
    }
);

// Define models
class Account extends Model {}
Account.init(
    {
        GovernorId: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true,
        },
        GovernorName: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        OldGovernorNames: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            defaultValue: [],
        },
    },
    {
        sequelize,
        modelName: "Account",
        tableName: "Accounts",
        timestamps: false,
    }
);

const accountLinkingErrorMsg =
    "An account that is already a main account cannot be used as a farm account. Please unlink all farm accounts associated with this account first";
class AccountLink extends Model {}
AccountLink.init(
    {
        Id: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true,
        },
        MainGovernorId: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: Account,
                key: "GovernorId",
            },
        },
        FarmGovernorId: {
            type: DataTypes.BIGINT,
            allowNull: false,
            unique: true, // Ensure a farm can only belong to one main account
            references: {
                model: Account,
                key: "GovernorId",
            },
        },
    },
    {
        sequelize,
        modelName: "AccountLink",
        tableName: "AccountLinks",
        timestamps: false,
        indexes: [
            {
                fields: ["MainGovernorId"],
                name: "idx_main_governor",
            },
        ],
        hooks: {
            beforeCreate: async (accountLink, options) => {
                // Check if the farm account is already a main account somewhere
                const existingMainAccount = await AccountLink.findOne({
                    where: {
                        MainGovernorId: accountLink.FarmGovernorId,
                    },
                    transaction: options.transaction,
                });

                if (existingMainAccount) {
                    throw new Error(accountLinkingErrorMsg);
                }
            },
            beforeUpdate: async (accountLink, options) => {
                // Only run this check if FarmGovernorId is being updated
                if (accountLink.changed("FarmGovernorId")) {
                    const existingMainAccount = await AccountLink.findOne({
                        where: {
                            MainGovernorId: accountLink.FarmGovernorId,
                        },
                        transaction: options.transaction,
                    });

                    if (existingMainAccount) {
                        throw new Error(accountLinkingErrorMsg);
                    }
                }
            },
        },
    }
);

class AccountStats extends Model {}
AccountStats.init(
    {
        Id: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true,
        },
        GovernorId: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: Account,
                key: "GovernorId",
            },
        },
        GovernorName: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        SnapshotTime: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        CH: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        Domain: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Clickable: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        Alliance: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        Power: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        HighestPower: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        TroopPower: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Victory: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Defeat: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Helps: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        ScoutTimes: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Gathered: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Assistance: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        TotalKillPoints: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        TotalKills: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        T1Kills: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        T2Kills: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        T3Kills: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        T4Kills: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        T5Kills: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        RangedKills: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Dead: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Healed: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        MostUnitsKilled: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        MostUnitsLost: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        MostUnitsHealed: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Autarch: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Participated: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        Civilization: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
    },
    {
        sequelize,
        modelName: "AccountStats",
        tableName: "AccountStats",
        timestamps: false,
        indexes: [
            {
                fields: ["GovernorId", "SnapshotTime"],
                unique: true,
            },
        ],
    }
);

// Define associations
Account.hasMany(AccountLink, {
    foreignKey: "MainGovernorId",
    as: "FarmAccounts",
});

Account.hasOne(AccountLink, {
    foreignKey: "FarmGovernorId",
    as: "MainAccount",
});

AccountLink.belongsTo(Account, {
    foreignKey: "MainGovernorId",
    as: "MainAccount",
});

AccountLink.belongsTo(Account, {
    foreignKey: "FarmGovernorId",
    as: "FarmAccount",
});

Account.hasMany(AccountStats, {
    foreignKey: "GovernorId",
});
AccountStats.belongsTo(Account, {
    foreignKey: "GovernorId",
});

// Database service class
class DatabaseService {
    static async initialize() {
        try {
            await sequelize.authenticate();
            console.log("Database connection established successfully.");

            // Sync models
            await sequelize.sync({
                // force: process.env.NODE_ENV === 'development'
            });

            return sequelize;
        } catch (error) {
            console.error("Unable to connect to the database:", error);
            throw error;
        }
    }

    static async close() {
        await sequelize.close();
    }

    // Generic create method
    static async create(model, data) {
        try {
            return await model.create(data);
        } catch (error) {
            console.error(`Error creating ${model.name}:`, error);
            throw error;
        }
    }

    // Generic find method
    static async find(model, query = {}) {
        try {
            return await model.findAll({
                where: query,
                raw: false,
            });
        } catch (error) {
            console.error(`Error finding ${model.name}:`, error);
            throw error;
        }
    }

    // Generic update method
    static async update(model, query, updateData) {
        try {
            const [updatedCount] = await model.update(updateData, {
                where: query,
            });
            return updatedCount;
        } catch (error) {
            console.error(`Error updating ${model.name}:`, error);
            throw error;
        }
    }

    // Generic delete method
    static async delete(model, query) {
        try {
            return await model.destroy({
                where: query,
            });
        } catch (error) {
            console.error(`Error deleting from ${model.name}:`, error);
            throw error;
        }
    }
}

module.exports = {
    sequelize,
    DatabaseService,
    models: {
        Account,
        AccountLink,
        AccountStats,
    },
};
