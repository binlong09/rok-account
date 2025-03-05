"use strict";

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Create a transaction for safety
        const transaction = await queryInterface.sequelize.transaction();

        try {
            // First, check if the table exists and what its actual name is
            const tableQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name ILIKE 'accountlinks'
        AND table_schema = current_schema();
      `;
            const [tableResult] = await queryInterface.sequelize.query(
                tableQuery,
                { transaction }
            );

            if (tableResult.length === 0) {
                throw new Error(
                    'Could not find a table matching "accountlinks" (case insensitive). Please check your database.'
                );
            }

            // Get the actual table name with correct casing
            const tableName = tableResult[0].table_name;
            console.log(`Found table with name: ${tableName}`);

            // Get constraints with the correct table name
            const constraintQuery = `
        SELECT con.conname AS constraint_name
        FROM pg_constraint con
        INNER JOIN pg_class rel ON rel.oid = con.conrelid
        INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = '${tableName}' AND con.contype = 'p';
      `;

            const [constraints] = await queryInterface.sequelize.query(
                constraintQuery,
                { transaction }
            );

            // Remove primary key constraint(s)
            if (constraints && constraints.length > 0) {
                for (const constraint of constraints) {
                    await queryInterface.sequelize.query(
                        `ALTER TABLE "${tableName}" DROP CONSTRAINT "${constraint.constraint_name}"`,
                        { transaction }
                    );
                }
            }

            // Add a new ID column to serve as the primary key
            await queryInterface.addColumn(
                tableName,
                "Id",
                {
                    type: Sequelize.BIGINT,
                    autoIncrement: true,
                },
                { transaction }
            );

            // Make this column the primary key
            await queryInterface.sequelize.query(
                `ALTER TABLE "${tableName}" ADD PRIMARY KEY ("Id")`,
                { transaction }
            );

            // Find and handle foreign key constraints for FarmGovernorId
            await queryInterface.sequelize.query(
                `
        DO $$
        DECLARE
          fk_constraint TEXT;
        BEGIN
          SELECT conname INTO fk_constraint
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = '${tableName}'
          AND conname ILIKE '%farmgovernorid%';

          IF fk_constraint IS NOT NULL THEN
            EXECUTE 'ALTER TABLE "' || '${tableName}' || '" DROP CONSTRAINT "' || fk_constraint || '"';
          END IF;
        END $$;
      `,
                { transaction }
            );

            // Find and handle foreign key constraints for MainGovernorId
            await queryInterface.sequelize.query(
                `
        DO $$
        DECLARE
          fk_constraint TEXT;
        BEGIN
          SELECT conname INTO fk_constraint
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = '${tableName}'
          AND conname ILIKE '%maingovernorid%';

          IF fk_constraint IS NOT NULL THEN
            EXECUTE 'ALTER TABLE "' || '${tableName}' || '" DROP CONSTRAINT "' || fk_constraint || '"';
          END IF;
        END $$;
      `,
                { transaction }
            );

            // Find the correct accounts table name
            const accountsTableQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name ILIKE 'accounts'
        AND table_schema = current_schema();
      `;
            const [accountsTableResult] = await queryInterface.sequelize.query(
                accountsTableQuery,
                { transaction }
            );

            if (accountsTableResult.length === 0) {
                throw new Error(
                    'Could not find a table matching "accounts" (case insensitive). Please check your database.'
                );
            }

            const accountsTableName = accountsTableResult[0].table_name;
            console.log(`Found accounts table with name: ${accountsTableName}`);

            // Add unique constraint to FarmGovernorId - this ensures each account can only be a farm once
            await queryInterface.addConstraint(tableName, {
                fields: ["FarmGovernorId"],
                type: "unique",
                name: "unique_farm_governor",
                transaction,
            });

            // Re-add foreign keys with correct accounts table name
            await queryInterface.addConstraint(tableName, {
                fields: ["FarmGovernorId"],
                type: "foreign key",
                name: "fk_farm_governor",
                references: {
                    table: accountsTableName,
                    field: "GovernorId",
                },
                transaction,
            });

            await queryInterface.addConstraint(tableName, {
                fields: ["MainGovernorId"],
                type: "foreign key",
                name: "fk_main_governor",
                references: {
                    table: accountsTableName,
                    field: "GovernorId",
                },
                transaction,
            });

            // Add index for faster lookups
            await queryInterface.addIndex(tableName, ["MainGovernorId"], {
                name: "idx_main_governor",
                transaction,
            });

            // Create check constraint that prevents an account from being both a main account and a farm account
            await queryInterface.sequelize.query(
                `
        CREATE OR REPLACE FUNCTION prevent_main_as_farm()
        RETURNS TRIGGER AS $$
        BEGIN
          -- Check if the farm account ID exists as a main account ID in any row
          IF EXISTS (
            SELECT 1 FROM "${tableName}"
            WHERE "MainGovernorId" = NEW."FarmGovernorId"
          ) THEN
            RAISE EXCEPTION 'An account that is already a main account cannot be used as a farm account';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `,
                { transaction }
            );

            // Create the trigger
            await queryInterface.sequelize.query(
                `
        DROP TRIGGER IF EXISTS check_farm_not_main ON "${tableName}";
        CREATE TRIGGER check_farm_not_main
        BEFORE INSERT OR UPDATE ON "${tableName}"
        FOR EACH ROW
        EXECUTE FUNCTION prevent_main_as_farm();
      `,
                { transaction }
            );

            // Commit transaction
            await transaction.commit();
            console.log("Migration completed successfully");
        } catch (error) {
            // Rollback transaction in case of error
            await transaction.rollback();
            console.error("Migration failed:", error);
            throw error;
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Revert changes if needed
        const transaction = await queryInterface.sequelize.transaction();

        try {
            // Find the actual table name first
            const tableQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name ILIKE 'accountlinks'
        AND table_schema = current_schema();
      `;
            const [tableResult] = await queryInterface.sequelize.query(
                tableQuery,
                { transaction }
            );

            if (tableResult.length === 0) {
                throw new Error(
                    'Could not find a table matching "accountlinks" (case insensitive). Please check your database.'
                );
            }

            // Get the actual table name with correct casing
            const tableName = tableResult[0].table_name;
            console.log(`Found table with name: ${tableName}`);

            // Drop the trigger and function
            await queryInterface.sequelize.query(
                `
        DROP TRIGGER IF EXISTS check_farm_not_main ON "${tableName}";
      `,
                { transaction }
            );

            await queryInterface.sequelize.query(
                `
        DROP FUNCTION IF EXISTS prevent_main_as_farm();
      `,
                { transaction }
            );

            // Remove the unique constraint on FarmGovernorId
            try {
                await queryInterface.removeConstraint(
                    tableName,
                    "unique_farm_governor",
                    { transaction }
                );
            } catch (error) {
                console.warn(
                    "Could not remove unique_farm_governor constraint, it may not exist:",
                    error.message
                );
            }

            // Remove the foreign key constraints
            try {
                await queryInterface.removeConstraint(
                    tableName,
                    "fk_farm_governor",
                    { transaction }
                );
            } catch (error) {
                console.warn(
                    "Could not remove fk_farm_governor constraint, it may not exist:",
                    error.message
                );
            }

            try {
                await queryInterface.removeConstraint(
                    tableName,
                    "fk_main_governor",
                    { transaction }
                );
            } catch (error) {
                console.warn(
                    "Could not remove fk_main_governor constraint, it may not exist:",
                    error.message
                );
            }

            // Remove the index
            try {
                await queryInterface.removeIndex(
                    tableName,
                    "idx_main_governor",
                    { transaction }
                );
            } catch (error) {
                console.warn(
                    "Could not remove idx_main_governor index, it may not exist:",
                    error.message
                );
            }

            // Get primary key constraint name
            const constraintQuery = `
        SELECT con.conname AS constraint_name
        FROM pg_constraint con
        INNER JOIN pg_class rel ON rel.oid = con.conrelid
        INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = '${tableName}' AND con.contype = 'p';
      `;

            const [constraints] = await queryInterface.sequelize.query(
                constraintQuery,
                { transaction }
            );

            // Remove primary key constraint(s)
            if (constraints && constraints.length > 0) {
                for (const constraint of constraints) {
                    await queryInterface.sequelize.query(
                        `ALTER TABLE "${tableName}" DROP CONSTRAINT "${constraint.constraint_name}"`,
                        { transaction }
                    );
                }
            }

            // Remove the Id column
            await queryInterface.removeColumn(tableName, "Id", { transaction });

            // Find the accounts table name
            const accountsTableQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name ILIKE 'accounts'
        AND table_schema = current_schema();
      `;
            const [accountsTableResult] = await queryInterface.sequelize.query(
                accountsTableQuery,
                { transaction }
            );
            const accountsTableName = accountsTableResult[0].table_name;

            // Add back composite primary key
            await queryInterface.addConstraint(tableName, {
                fields: ["MainGovernorId", "FarmGovernorId"],
                type: "primary key",
                name: `${tableName.toLowerCase()}_pkey`,
                transaction,
            });

            // Re-add the foreign key constraints
            await queryInterface.addConstraint(tableName, {
                fields: ["MainGovernorId"],
                type: "foreign key",
                name: "fk_main_governor",
                references: {
                    table: accountsTableName,
                    field: "GovernorId",
                },
                transaction,
            });

            await queryInterface.addConstraint(tableName, {
                fields: ["FarmGovernorId"],
                type: "foreign key",
                name: "fk_farm_governor",
                references: {
                    table: accountsTableName,
                    field: "GovernorId",
                },
                transaction,
            });

            // Commit transaction
            await transaction.commit();
            console.log("Rollback completed successfully");
        } catch (error) {
            // Rollback transaction in case of error
            await transaction.rollback();
            console.error("Migration rollback failed:", error);
            throw error;
        }
    },
};
