import { createIndexedDb } from '../../utils/idb.js';

export const { dbGetAll, dbPut, dbDelete } = createIndexedDb('forms_db', ['payees', 'vouchers']);
