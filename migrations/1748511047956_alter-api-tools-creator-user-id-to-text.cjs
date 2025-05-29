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
  pgm.alterColumn('api_tools', 'creator_user_id', {
    type: 'TEXT',
    // If you need to ensure it's not null, you can add:
    // notNull: true, 
    // If there's a default UUID function, you might want to remove it or change it:
    // default: null, 
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Revert to UUID if needed, though this might fail if non-UUID data exists
  pgm.alterColumn('api_tools', 'creator_user_id', {
    type: 'UUID USING creator_user_id::uuid',
    // If it had a default before, you might want to restore it, e.g.:
    // default: pgm.func('uuid_generate_v4()'),
  });
};
