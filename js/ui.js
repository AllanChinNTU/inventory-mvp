// ui.js - DOM render + events binding (with camera barcode scan)
import {
  loadDb,
  addWarehouse,
  addProduct,
  postTransaction,
  fefoOut,
  exportDbJson,
  importDbJson,
  resetDb,
  findProductByBarcode
} from "./db.js";

import { can, Roles } from "./auth.js";
import { startScan, stopScan, isBarcodeDetectorSupported } from "./scanner.js";

const $ = (id) => document.getElementById(id);

function fmtDate(d) {
  if (!d) return "";
  // If already in YYYY-MM-DD format, return as-is to avoid timezone shifts
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  const diff = t - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function typeLabel(t) {
  return t === "IN" ? "入庫" : t === "OUT" ? "出庫" : "盤點調整";
}

function setMsg(id, msg, ok = true) {
  $(id).innerHTML = ok
    ? `<span class="okText">${msg}</span>`
    : `<span class="dangerText">${msg}</span>`;
}

export function applyRoleToUI(actor) {
  // Disable/enable controls according to role
  const masterDisabled = !can(actor, "MASTER_WRITE");
  const txDisabled = !can(actor, "TX_WRITE");
  const ioDisabled = !can(actor, "IO");
  const resetDisabled = !can(actor, "RESET");

  // master
  $("whName").disabled = masterDisabled;
  $("addWhBtn").disabled = masterDisabled;
  $("prodName").disabled = masterDisabled;
  $("prodBarcode").disabled = masterDisabled;
  $("prodUnit").disabled = masterDisabled;
  $("addProdBtn").disabled = masterDisabled;

  // tx
  [
    "txType",
    "txWh",
    "txProd",
    "txScan",
    "scanBtn",
    "stopScanBtn",
    "txLot",
    "txExp",
    "txQty",
    "txNote",
    "commitTxBtn"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = txDisabled;
  });

  // IO/reset
  $("exportBtn").disabled = ioDisabled;
  $("importBtn").disabled = ioDisabled;
  $("ioArea").disabled = ioDisabled;
  $("resetBtn").disabled = resetDisabled;

  // Informational message
  if (actor.role === Roles.GUEST) {
    setMsg("txMsg", "你目前是 guest：僅可查看資料。", false);
  } else {
    $("txMsg").innerHTML = "";
  }
}

export function renderAll() {
  const db = loadDb();

  // lists
  $("whList").innerHTML = db.warehouses.length
    ? db.warehouses.map((w) => `<span class="pill">${w.name}</span>`).join(" ")
    : `<span class="muted">尚無倉庫</span>`;

  $("prodList").innerHTML = db.products.length
    ? db.products
        .map(
          (p) =>
            `<span class="pill">${p.name}${p.barcode ? `｜${p.barcode}` : ""}</span>`
        )
        .join(" ")
    : `<span class="muted">尚無商品</span>`;

  // selects
  $("txWh").innerHTML = db.warehouses
    .map((w) => `<option value="${w.id}">${w.name}</option>`)
    .join("");
  $("txProd").innerHTML = db.products
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");

  // inventory balance view
  const q = ($("search").value || "").trim().toLowerCase();
  const warnDays = parseInt($("expWarnDays").value || "30", 10);

  const rows = db.stockBalances
    .map((b) => {
      const wh = db.warehouses.find((w) => w.id === b.warehouseId);
      const lot = db.lots.find((l) => l.id === b.lotId);
      const prod = db.products.find((p) => p.id === lot?.productId);

      const expDays = daysUntil(lot?.expDate || "");
      let status = `<span class="muted">未填效期</span>`;
      if (expDays !== null) {
        if (expDays < 0) status = `<span class="dangerText">已過期 (${expDays}天)</span>`;
        else if (expDays <= warnDays)
          status = `<span class="dangerText">快到期 (${expDays}天)</span>`;
        else status = `<span class="okText">正常 (${expDays}天)</span>`;
      }

      const hay = [wh?.name, prod?.name, prod?.barcode, lot?.lotNo, lot?.expDate]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return { b, wh, lot, prod, status, hay };
    })
    .filter((r) => !q || r.hay.includes(q))
    .sort((a, b) => {
      const ae = a.lot?.expDate || "9999-12-31";
      const be = b.lot?.expDate || "9999-12-31";
      if (ae !== be) return ae.localeCompare(be);
      return (a.prod?.name || "").localeCompare(b.prod?.name || "");
    });

  $("invBody").innerHTML = rows.length
    ? rows
        .map(
          (r) => `
    <tr>
      <td>${r.wh?.name || "-"}</td>
      <td>${r.prod?.name || "-"}</td>
      <td>${r.prod?.barcode || "-"}</td>
      <td>${r.lot?.lotNo || "-"}</td>
      <td>${fmtDate(r.lot?.expDate) || "-"}</td>
      <td>${r.b.qty}</td>
      <td>${r.status}</td>
    </tr>
  `
        )
        .join("")
    : `<tr><td colspan="7" class="muted">沒有符合條件的庫存資料</td></tr>`;

  // ledger view
  const tx = db.stockTransactions
    .slice()
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 50);

  $("txBody").innerHTML = tx.length
    ? tx
        .map((t) => {
          const wh = db.warehouses.find((w) => w.id === t.warehouseId);
          const prod = db.products.find((p) => p.id === t.productId);
          const lot = db.lots.find((l) => l.id === t.lotId);
          const user = db.users.find((u) => u.id === t.createdBy);
          return `
      <tr>
        <td>${t.ts.replace("T", " ").slice(0, 19)}</td>
        <td>${user?.username || "-"}</td>
        <td>${typeLabel(t.type)}</td>
        <td>${wh?.name || "-"}</td>
        <td>${prod?.name || "-"}</td>
        <td>${lot?.lotNo || "-"}</td>
        <td>${fmtDate(lot?.expDate) || "-"}</td>
        <td>${t.qtyDelta}</td>
        <td>${t.note || ""}</td>
      </tr>
    `;
        })
        .join("")
    : `<tr><td colspan="9" class="muted">尚無異動紀錄</td></tr>`;
}

export function bindAppEvents(actor) {
  // --- master
  $("addWhBtn").addEventListener("click", () => {
    const name = $("whName").value.trim();
    if (!name) return;
    addWarehouse(name, actor);
    $("whName").value = "";
    renderAll();
  });

  $("addProdBtn").addEventListener("click", () => {
    const name = $("prodName").value.trim();
    if (!name) return;
    addProduct(
      {
        name,
        barcode: $("prodBarcode").value.trim(),
        unit: $("prodUnit").value.trim()
      },
      actor
    );
    $("prodName").value = "";
    $("prodBarcode").value = "";
    $("prodUnit").value = "";
    renderAll();
  });

  // --- barcode lookup (manual)
  $("txScan").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const code = $("txScan").value.trim();
    if (!code) return;

    const p = findProductByBarcode(code);
    if (!p) return setMsg("txMsg", "找不到條碼對應商品（請先在商品主檔填條碼）", false);

    $("txProd").value = p.id;
    setMsg("txMsg", `已選取商品：${p.name}`, true);
  });

  // --- camera scan
  const scanBtn = $("scanBtn");
  const stopScanBtn = $("stopScanBtn");
  const scanPanel = $("scanPanel");
  const scanVideo = $("scanVideo");

  const setScanMsg = (msg, ok = true) => {
    $("scanMsg").innerHTML = ok
      ? `<span class="okText">${msg}</span>`
      : `<span class="dangerText">${msg}</span>`;
  };

  // Show support hint once (does not block)
  if (!isBarcodeDetectorSupported()) {
    setScanMsg("提示：此瀏覽器可能不支援相機條碼掃描。建議用 Chrome，或改用手動輸入。", false);
  }

  scanBtn.addEventListener("click", async () => {
    try {
      scanPanel.style.display = "block";
      scanBtn.disabled = true;
      stopScanBtn.disabled = false;

      await startScan({
        videoEl: scanVideo,
        onStatus: (msg, ok) => setScanMsg(msg, ok),
        onDetected: (code) => {
          $("txScan").value = code;
          setScanMsg(`已掃到：${code}（已填入條碼欄位）`, true);

          // Trigger existing barcode lookup logic (simulate Enter)
          const evt = new KeyboardEvent("keydown", { key: "Enter" });
          $("txScan").dispatchEvent(evt);

          scanPanel.style.display = "none";
          scanBtn.disabled = false;
          stopScanBtn.disabled = true;
        }
      });
    } catch (err) {
      setScanMsg("相機啟動失敗：請允許相機權限，並確認使用 HTTPS 或 localhost。", false);
      scanPanel.style.display = "none";
      scanBtn.disabled = false;
      stopScanBtn.disabled = true;
      try {
        stopScan(scanVideo);
      } catch {}
    }
  });

  stopScanBtn.addEventListener("click", () => {
    stopScan(scanVideo);
    setScanMsg("已停止掃描。", true);
    scanPanel.style.display = "none";
    scanBtn.disabled = false;
    stopScanBtn.disabled = true;
  });

  // --- tx commit
  $("commitTxBtn").addEventListener("click", () => {
    try {
      const db = loadDb();
      if (db.warehouses.length === 0) return setMsg("txMsg", "請先新增至少一個倉庫", false);
      if (db.products.length === 0) return setMsg("txMsg", "請先新增至少一個商品", false);

      const type = $("txType").value;
      const warehouseId = $("txWh").value;
      const productId = $("txProd").value;
      const lotNo = $("txLot").value.trim();
      const expDate = $("txExp").value || "";
      const qty = $("txQty").value;
      const note = $("txNote").value.trim();

      if(type === "OUT" && !lotNo){
        // FEFO出庫：lot留空時自動扣帳
        const created = fefoOut({
          warehouseId,
          productId,
          qtyOut: qty,
          note
        }, actor);

        setMsg("txMsg", `FEFO 出庫完成：已產生 ${created.length} 筆批號扣帳紀錄`, true);
      } else {
        if (!lotNo) return setMsg("txMsg", "請輸入批號（Lot）", false);
        postTransaction({ type, warehouseId, productId, lotNo, expDate, qty, note }, actor);
        setMsg("txMsg", "異動已寫入", true);
      }
      
      setMsg("txMsg", "異動已寫入", true);
      $("txLot").value = "";
      $("txExp").value = "";
      $("txQty").value = "";
      $("txNote").value = "";
      renderAll();
    } catch (err) {
      setMsg("txMsg", err.message || "異動失敗", false);
    }
  });

  // --- filters
  $("search").addEventListener("input", renderAll);
  $("expWarnDays").addEventListener("input", renderAll);

  // --- IO
  $("exportBtn").addEventListener("click", () => {
    $("ioArea").value = exportDbJson();
    setMsg("txMsg", "已匯出 JSON 到下方文字框", true);
  });

  $("importBtn").addEventListener("click", () => {
    try {
      importDbJson($("ioArea").value.trim());
      setMsg("txMsg", "匯入完成", true);
      renderAll();
    } catch (err) {
      setMsg("txMsg", "匯入失敗：" + (err.message || "JSON 解析錯誤"), false);
    }
  });

  $("resetBtn").addEventListener("click", () => {
    resetDb();
    setMsg("txMsg", "已清空資料", true);
    renderAll();
  });
}
