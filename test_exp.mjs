// test_exp.mjs - reproduce expiration storage
global.localStorage = (function(){
  let store = {};
  return {
    getItem(k){ return store[k] ?? null },
    setItem(k,v){ store[k] = v+"" },
    removeItem(k){ delete store[k] },
    _dump(){ return store }
  }
})();

import * as db from './js/db.js';

(async ()=>{
  db.initDbIfEmpty();
  const actor = { id: 'u_manager', username: 'manager', role: 'manager' };
  const wh = db.addWarehouse('W1', actor);
  const p = db.addProduct({ name: 'P1', barcode: '0001', unit: 'box' }, actor);

  // Post IN with expDate
  const tx = db.postTransaction({ type: 'IN', warehouseId: wh.id, productId: p.id, lotNo: 'L1', expDate: '2025-12-24', qty: 10, note: 'test' }, actor);

  const dbObj = db.loadDb();
  console.log('lots:', JSON.stringify(dbObj.lots, null, 2));
  console.log('balances:', JSON.stringify(dbObj.stockBalances, null, 2));
  console.log('txs:', JSON.stringify(dbObj.stockTransactions, null, 2));
})();
