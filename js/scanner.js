// scanner.js - camera barcode scanning (BarcodeDetector API with fallback notice)

let stream = null;
let rafId = null;

export function isBarcodeDetectorSupported(){
  return ("BarcodeDetector" in window);
}

export async function startScan({ videoEl, onDetected, onStatus }){
  if(!videoEl) throw new Error("videoEl is required");

  if(!isBarcodeDetectorSupported()){
    onStatus?.("此瀏覽器不支援 BarcodeDetector。建議用 Chrome（iOS/Android）或改用手動輸入。", false);
    throw new Error("BarcodeDetector not supported");
  }

  // Request camera
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });

  videoEl.srcObject = stream;
  await videoEl.play();

  const detector = new BarcodeDetector({
    formats: ["ean_13","ean_8","code_128","code_39","qr_code","upc_a","upc_e","itf","codabar","data_matrix"]
  });

  onStatus?.("相機已開啟，正在掃描…", true);

  const tick = async () => {
    try{
      const barcodes = await detector.detect(videoEl);
      if(barcodes && barcodes.length){
        // pick first
        const raw = barcodes[0].rawValue || "";
        if(raw){
          onDetected?.(raw);
          // Stop after first detection to avoid repeated triggers
          stopScan(videoEl);
          return;
        }
      }
    }catch(e){
      // ignore detection errors
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}

export function stopScan(videoEl){
  if(rafId){
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if(videoEl){
    try { videoEl.pause(); } catch {}
    videoEl.srcObject = null;
  }
  if(stream){
    for(const t of stream.getTracks()) t.stop();
    stream = null;
  }
}
