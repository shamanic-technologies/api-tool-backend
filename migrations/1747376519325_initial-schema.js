/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = {
  // Timestamps shorthand removed
};

// Helper function to create a trigger that automatically updates the updated_at column
const createUpdatedAtTrigger = (pgm, tableName) => {
  // Create a function to update the updated_at column
  pgm.createFunction(
    'trigger_set_timestamp',
    [],
    {
      returns: 'TRIGGER',
      language: 'plpgsql',
      replace: true, // Replace if function already exists, useful for updates
    },
    `
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
`
  );

  // Create a trigger on the specified table
  pgm.createTrigger(tableName, 'set_timestamp_trigger', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'trigger_set_timestamp',
    // args: [], // No arguments needed for this function
  });
};

// Helper function to drop the updated_at trigger and function
const dropUpdatedAtTrigger = (pgm, tableName) => {
  pgm.dropTrigger(tableName, 'set_timestamp_trigger', { ifExists: true });
  // Optionally drop the function if it's no longer needed by other tables.
  // For simplicity, we might leave it, or ensure it's dropped if this is the last table using it.
  // pgm.dropFunction('trigger_set_timestamp', [], { ifExists: true });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Enable pgcrypto extension for gen_random_uuid()
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  // --- api_tools table ---
  pgm.dropTable('api_tools', { ifExists: true }); 

  pgm.createTable('api_tools', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    utility_provider: { type: 'varchar(255)', notNull: true },
    openapi_specification: { type: 'jsonb', notNull: true },
    security_option: { type: 'varchar(255)', notNull: true },
    security_secrets: { type: 'jsonb', notNull: true },
    is_verified: { type: 'boolean', notNull: true, default: false },
    creator_user_id: { type: 'uuid', notNull: true },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
  createUpdatedAtTrigger(pgm, 'api_tools');

  // --- user_api_tools table ---
  pgm.createTable('user_api_tools', {
    user_id: { type: 'uuid', notNull: true }, 
    api_tool_id: {
      type: 'uuid',
      notNull: true,
      references: 'api_tools(id)',
      onDelete: 'CASCADE',
    },
    status: { type: 'varchar(50)', notNull: true }, 
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
  // Add composite primary key constraint
  pgm.addConstraint('user_api_tools', 'user_api_tools_pkey', {
    primaryKey: ['user_id', 'api_tool_id']
  });
  createUpdatedAtTrigger(pgm, 'user_api_tools');
  pgm.createIndex('user_api_tools', 'api_tool_id');

  // --- api_tool_executions table ---
  pgm.createTable('api_tool_executions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    api_tool_id: {
      type: 'uuid',
      notNull: true,
      references: 'api_tools(id)',
      onDelete: 'CASCADE', 
    },
    user_id: { type: 'uuid', notNull: true }, 
    input: { type: 'jsonb' },
    output: { type: 'jsonb' },
    status_code: { type: 'integer', notNull: true },
    error: { type: 'text' },
    error_details: { type: 'text' },
    hint: { type: 'text' },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
  createUpdatedAtTrigger(pgm, 'api_tool_executions');
  pgm.createIndex('api_tool_executions', 'api_tool_id');
  pgm.createIndex('api_tool_executions', 'user_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  dropUpdatedAtTrigger(pgm, 'api_tool_executions');
  dropUpdatedAtTrigger(pgm, 'user_api_tools');
  dropUpdatedAtTrigger(pgm, 'api_tools');

  // Drop constraints before tables if they were added separately
  pgm.dropConstraint('user_api_tools', 'user_api_tools_pkey', { ifExists: true });

  pgm.dropTable('api_tool_executions', { ifExists: true });
  pgm.dropTable('user_api_tools', { ifExists: true });
  pgm.dropTable('api_tools', { ifExists: true });
};
