import { createIndexedDb } from '../../utils/idb.js';

export const { dbGetAll, dbPut, dbDelete } = createIndexedDb('vendor_bills_db', ['vendors', 'batches']);
