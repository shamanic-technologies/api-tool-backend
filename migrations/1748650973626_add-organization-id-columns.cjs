/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add organization_id to user_api_tools table
  pgm.addColumn('user_api_tools', {
    organization_id: {
      type: 'text', // Assuming UUIDs are stored as text
      notNull: true,
      default: 'default',
    },
  });

  // Add creator_organization_id to api_tools table
  pgm.addColumn('api_tools', {
    creator_organization_id: {
      type: 'text', // Assuming UUIDs are stored as text
      notNull: true,
      default: 'default',
    },
  });

  // Add organization_id to api_tool_executions table
  pgm.addColumn('api_tool_executions', {
    organization_id: {
      type: 'text', // Assuming UUIDs are stored as text
      notNull: true,
      default: 'default',
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Remove organization_id from user_api_tools table
  pgm.dropColumn('user_api_tools', 'organization_id');

  // Remove creator_organization_id from api_tools table
  pgm.dropColumn('api_tools', 'creator_organization_id');

  // Remove organization_id from api_tool_executions table
  pgm.dropColumn('api_tool_executions', 'organization_id');
}; 