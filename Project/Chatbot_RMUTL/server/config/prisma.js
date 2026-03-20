const {
  PrismaClient
} = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
const {
  markDbWrite
} = require('../utils/requestContext');

// ฟังก์ชันสำหรับ buildConnectionString
const buildConnectionString = () => {
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    return connectionString;
  }

  try {
    const url = new URL(connectionString);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', process.env.DB_CONNECTION_LIMIT || '10');
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', process.env.DB_POOL_TIMEOUT || '20');
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', process.env.DB_CONNECT_TIMEOUT || '10');
    }
    return url.toString();
  } catch (err) {
    console.warn('DATABASE_URL is invalid, using raw value:', err?.message || err);
    return connectionString;
  }
};

const adapter = new PrismaPg(buildConnectionString());

let prisma;
let prismaBase;

if (process.env.NODE_ENV === 'production') {
  prismaBase = new PrismaClient({
    adapter,

    transactionOptions: {
      timeout: 120000
    }
  });
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      adapter,
      log: ['error', 'warn'],

      transactionOptions: {
        timeout: 120000
      }
    });
  }
  prismaBase = global.__prisma;
}

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert'
]);

// Prisma v7 removed `$use` middleware; use Client Extensions instead.
// Track whether the current request performed a DB mutation so we can log only real changes.
const prismaExtended = prismaBase.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);
        if (WRITE_OPERATIONS.has(operation)) {
          markDbWrite({
            model: model || null,
            action: operation || null
          });
        }
        return result;
      }
    }
  }
});

prisma = prismaExtended;

module.exports = prisma;
