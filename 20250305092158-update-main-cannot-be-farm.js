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

            // Find all constraints on the table to avoid recreating existing ones
            const allConstraintsQuery = `
        SELECT con.conname AS constraint_name, con.contype AS constraint_type
        FROM pg_constraint con
        INNER JOIN pg_class rel ON rel.oid = con.conrelid
        INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = '${tableName}';
      `;

            const [allConstraints] = await queryInterface.sequelize.query(
                allConstraintsQuery,
                { transaction }
            );
            console.log(
                "Existing constraints:",
                allConstraints.map((c) => c.constraint_name)
            );

            const constraintExists = (name) => {
                return allConstraints.some((c) => c.constraint_name === name);
            };

            // Get primary key constraints
            const pkConstraints = allConstraints.filter(
                (c) => c.constraint_type === "p"
            );

            // Check if 'Id' column already exists
            const columnsQuery = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = '${tableName}'
        AND column_name = 'Id';
      `;
            const [idColumnResult] = await queryInterface.sequelize.query(
                columnsQuery,
                { transaction }
            );
            const idColumnExists = idColumnResult.length > 0;

            // Remove primary key constraint(s) if we need to add Id column
            if (!idColumnExists && pkConstraints.length > 0) {
                for (const constraint of pkConstraints) {
                    await queryInterface.sequelize.query(
                        `ALTER TABLE "${tableName}" DROP CONSTRAINT "${constraint.constraint_name}"`,
                        { transaction }
                    );
                }
            }

            // Add a new ID column to serve as the primary key if it doesn't exist
            if (!idColumnExists) {
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
            }

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

            // Add unique constraint to FarmGovernorId if it doesn't exist
            if (!constraintExists("unique_farm_governor")) {
                await queryInterface.addConstraint(tableName, {
                    fields: ["FarmGovernorId"],
                    type: "unique",
                    name: "unique_farm_governor",
                    transaction,
                });
            }

            // Check if foreign key constraints exist before adding them
            if (!constraintExists("fk_farm_governor")) {
                // Re-add foreign key for FarmGovernorId with the correct accounts table name
                await queryInterface.sequelize.query(
                    `
          ALTER TABLE "${tableName}" ADD CONSTRAINT "fk_farm_governor"
          FOREIGN KEY ("FarmGovernorId") REFERENCES "${accountsTableName}" ("GovernorId")
          ON DELETE NO ACTION ON UPDATE NO ACTION;
        `,
                    { transaction }
                );
            }

            if (!constraintExists("fk_main_governor")) {
                // Re-add foreign key for MainGovernorId with the correct accounts table name
                await queryInterface.sequelize.query(
                    `
          ALTER TABLE "${tableName}" ADD CONSTRAINT "fk_main_governor"
          FOREIGN KEY ("MainGovernorId") REFERENCES "${accountsTableName}" ("GovernorId")
          ON DELETE NO ACTION ON UPDATE NO ACTION;
        `,
                    { transaction }
                );
            }

            // Check if index exists before adding it
            const indexQuery = `
        SELECT indexname FROM pg_indexes
        WHERE tablename = '${tableName}' AND indexname = 'idx_main_governor';
      `;
            const [indexResult] = await queryInterface.sequelize.query(
                indexQuery,
                { transaction }
            );

            if (indexResult.length === 0) {
                // Add index for faster lookups
                await queryInterface.addIndex(tableName, ["MainGovernorId"], {
                    name: "idx_main_governor",
                    transaction,
                });
            }

            // Check if function exists before creating it
            const functionQuery = `
        SELECT proname FROM pg_proc
        WHERE proname = 'prevent_main_as_farm';
      `;
            const [functionResult] = await queryInterface.sequelize.query(
                functionQuery,
                { transaction }
            );

            // Create the function if it doesn't exist
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

            // Check if trigger exists before creating it
            const triggerQuery = `
        SELECT trigger_name FROM information_schema.triggers
        WHERE event_object_table = '${tableName}' AND trigger_name = 'check_farm_not_main';
      `;
            const [triggerResult] = await queryInterface.sequelize.query(
                triggerQuery,
                { transaction }
            );

            // Drop the trigger if it exists
            await queryInterface.sequelize.query(
                `
        DROP TRIGGER IF EXISTS check_farm_not_main ON "${tableName}";
      `,
                { transaction }
            );

            // Create the trigger
            await queryInterface.sequelize.query(
                `
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

            // Commit transaction - we're only removing the new constraints, not reverting the entire structure
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
