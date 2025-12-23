// db.js - storage + domain operations (Power Apps / Azure friendly model)
const KEY = "INV_MVP_V2";

export function uid() {
  return (crypto?.randomUUID?.() ?? (Math.random().toString(16).slice(2) + Date.now().toString(16)));
}
export function nowIso(){ return new Date().toISOString(); }

export function initDbIfEmpty() {
  const raw = localStorage.getItem(KEY);
  if (raw) return;
  const db = {
    meta: { version: 2, createdAt: nowIso() },

    users: [
      { id: "u_manager", username: "manager", password: "manager123", role: "manager" },
      { id: "u_tech", username: "tech", password: "tech123", role: "tech" },
      { id: "u_guest", username: "guest", password: "guest123", role: "guest" }
    ],

    warehouses: [],      // {id,name,createdAt,updatedAt}
    products: [],        // {id,name,barcode,unit,createdAt,updatedAt}
    lots: [],            // {id,productId,lotNo,expDate,createdAt,updatedAt}
    stockBalances: [],   // {id,warehouseId,lotId,qty,updatedAt}
    stockTransactions: []// {id,ts,type,warehouseId,productId,lotId,qtyDelta,note,createdBy}
  };
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function loadDb(){ return JSON.parse(localStorage.getItem(KEY)); }
export function saveDb(db){ localStorage.setItem(KEY, JSON.stringify(db)); }

export function exportDbJson(){ return JSON.stringify(loadDb(), null, 2); }
export function importDbJson(txt){
  const obj = JSON.parse(txt);
  // minimal schema check
  const required = ["warehouses","products","lots","stockBalances","stockTransactions","users","meta"];
  for(const k of required){
    if(!(k in obj)) throw new Error("Invalid schema: missing " + k);
  }
  localStorage.setItem(KEY, JSON.stringify(obj));
}

export function resetDb(){
  localStorage.removeItem(KEY);
  initDbIfEmpty();
}

// ---- master ops
export function addWarehouse(name, actor){
  const db = loadDb();
  const w = { id: uid(), name, createdAt: nowIso(), updatedAt: nowIso(), createdBy: actor.id };
  db.warehouses.push(w);
  saveDb(db);
  return w;
}

export function addProduct({name, barcode, unit}, actor){
  const db = loadDb();
  const p = { id: uid(), name, barcode: barcode || "", unit: unit || "", createdAt: nowIso(), updatedAt: nowIso(), createdBy: actor.id };
  db.products.push(p);
  saveDb(db);
  return p;
}

export function getOrCreateLot({productId, lotNo, expDate}, actor){
  const db = loadDb();
  const existing = db.lots.find(l => l.productId===productId && l.lotNo===lotNo && (l.expDate||"")===(expDate||""));
  if(existing) return existing;

  const lot = {
    id: uid(),
    productId, lotNo,
    expDate: expDate || "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: actor.id
  };
  db.lots.push(lot);
  saveDb(db);
  return lot;
}

// ---- transaction + balance ops
function getOrCreateBalance(db, warehouseId, lotId){
  let bal = db.stockBalances.find(b => b.warehouseId===warehouseId && b.lotId===lotId);
  if(!bal){
    bal = { id: uid(), warehouseId, lotId, qty: 0, updatedAt: nowIso() };
    db.stockBalances.push(bal);
  }
  return bal;
}

export function postTransaction({type, warehouseId, productId, lotNo, expDate, qty, note}, actor){
  const db = loadDb();

  const lot = getOrCreateLot({productId, lotNo, expDate}, actor);
  const bal = getOrCreateBalance(db, warehouseId, lot.id);

  const absQty = Math.abs(parseInt(qty, 10));
  if(!absQty) throw new Error("Qty must be non-zero integer.");

  let delta = 0;
  if(type === "IN") delta = absQty;
  else if(type === "OUT") delta = -absQty;
  else if(type === "ADJUST") {
    // ADJUST means set absolute quantity to qty (can be 0)
    const target = parseInt(qty, 10);
    if(Number.isNaN(target)) throw new Error("Invalid adjust qty.");
    delta = target - bal.qty;
  } else throw new Error("Unknown type.");

  if(type === "OUT" && bal.qty + delta < 0) {
    throw new Error(`Insufficient stock. Current=${bal.qty}, Out=${absQty}`);
  }

  bal.qty += delta;
  bal.updatedAt = nowIso();

  // remove zero balances (optional)
  db.stockBalances = db.stockBalances.filter(b => b.qty !== 0);

  const tx = {
    id: uid(),
    ts: nowIso(),
    type,
    warehouseId,
    productId,
    lotId: lot.id,
    qtyDelta: delta,
    note: note || "",
    createdBy: actor.id
  };
  db.stockTransactions.push(tx);

  saveDb(db);
  return tx;
}

// helper queries
export function findProductByBarcode(code){
  const db = loadDb();
  return db.products.find(p => (p.barcode||"").trim() === code.trim());
}

export function fefoOut({ warehouseId, productId, qtyOut, note }, actor){
  const db = loadDb();
  const need = Math.abs(parseInt(qtyOut, 10));
  if(!need) throw new Error("Qty must be non-zero integer.");

  // 找出此倉庫、此商品的所有 lot balances
  const candidates = db.stockBalances
    .map(b=>{
      const lot = db.lots.find(l=>l.id===b.lotId);
      if(!lot) return null;
      if(lot.productId !== productId) return null;
      if(b.warehouseId !== warehouseId) return null;
      return { bal: b, lot };
    })
    .filter(Boolean)
    .filter(x => x.bal.qty > 0);

  if(candidates.length === 0){
    throw new Error("No stock available for this product in this warehouse.");
  }

  // FEFO排序：有日期者先比日期，沒日期者排最後；同日再用 lotNo
  candidates.sort((a,b)=>{
    const ae = a.lot.expDate || "9999-12-31";
    const be = b.lot.expDate || "9999-12-31";
    if(ae !== be) return ae.localeCompare(be);
    return (a.lot.lotNo || "").localeCompare(b.lot.lotNo || "");
  });

  // 檢查總量是否足夠
  const total = candidates.reduce((s,x)=>s+x.bal.qty,0);
  if(total < need){
    throw new Error(`Insufficient stock (total=${total}, need=${need}).`);
  }

  // 逐批扣帳，寫入多筆交易
  let remaining = need;
  const created = [];

  for(const c of candidates){
    if(remaining <= 0) break;
    const take = Math.min(c.bal.qty, remaining);

    c.bal.qty -= take;
    c.bal.updatedAt = nowIso();

    const tx = {
      id: uid(),
      ts: nowIso(),
      type: "OUT",
      warehouseId,
      productId,
      lotId: c.lot.id,
      qtyDelta: -take,
      note: note ? `${note} (FEFO)` : "(FEFO)",
      createdBy: actor.id
    };
    db.stockTransactions.push(tx);
    created.push(tx);

    remaining -= take;
  }

  // 移除 0 balance
  db.stockBalances = db.stockBalances.filter(b => b.qty !== 0);

  saveDb(db);
  return created; // 多筆
}
