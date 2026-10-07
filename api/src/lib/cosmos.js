const { CosmosClient } = require('@azure/cosmos');

const DATABASE_NAME = process.env.COSMOS_DATABASE || 'fidrive';

/**
 * Container dipartisi agar semua query dan cek izin menjadi
 * single-partition / point read. Emulator Cosmos belum mengimplementasikan
 * query partitioned collection in parallel, jadi desain ini bukan pilihan gaya.
 */
const CONTAINERS = [
  { name: 'users', partitionKey: '/email' },
  { name: 'files', partitionKey: '/ownerEmail' },
  { name: 'publicLinks', partitionKey: '/token' },
];

let client = null;
let database = null;
let schemaReady = false;

function getClient() {
  if (!client) {
    client = new CosmosClient(process.env.COSMOS_CONNECTION);
  }
  return client;
}

function getDatabase() {
  if (!database) {
    database = getClient().database(DATABASE_NAME);
  }
  return database;
}

function getContainer(name) {
  return getDatabase().container(name);
}

/**
 * Idempoten. Murah setelah container ada, sehingga aman dipanggil di awal
 * setiap handler.
 */
async function ensureSchema() {
  if (schemaReady) {
    return;
  }

  // Di @azure/cosmos v4 pembuatan resource dilakukan lewat koleksi
  // (`databases` / `containers`), bukan lewat objek `database`/`container`.
  await getClient().databases.createIfNotExists({ id: DATABASE_NAME });

  const db = getDatabase();

  for (const container of CONTAINERS) {
    await db.containers.createIfNotExists({
      id: container.name,
      partitionKey: container.partitionKey,
    });
  }

  schemaReady = true;
}

module.exports = { getContainer, ensureSchema };
