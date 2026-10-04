export type NrmsReceipt = {
  reference: string; settlementReference: string; statementId: number; propertyTitle: string;
  amount: number; currency: string; method: string | null; manual: boolean;
  paidAt: string | null; verifiedAt: string | null; providerReference: string | null;
};

export async function downloadNrmsReceipt(receipt: NrmsReceipt): Promise<void> {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
  const date = (value: string | null) => value ? new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) + ' EAT' : 'Not recorded';
  const {default: JsBarcode} = await import('jsbarcode');
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, receipt.reference, {format:'CODE128',width:2,height:58,margin:20,displayValue:false});
  const rows = (items: [string, unknown][]) => items.map(([label,value]) => `<div class="row"><span>${escape(label)}</span><span>${escape(value)}</span></div>`).join('');
  const logo = new URL('/assets/NoLS2025-04.png', window.location.origin).href;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:white;font-family:"Trebuchet MS",Trebuchet,Arial,sans-serif;color:#213e38}
    .sheet{width:128mm;min-height:189mm;padding:5mm;background:#fff;border:1px solid #d9dfd8;border-radius:4mm;display:flex;flex-direction:column}
    .masthead{display:flex;justify-content:space-between;gap:4mm;align-items:center}.brand{display:flex;align-items:center;gap:3mm}.logo{width:13mm;height:15mm;overflow:hidden;position:relative}.logo img{position:absolute;width:30mm;max-width:none;left:-8mm;top:-6mm}
    h1{font-size:21px;margin:0;color:#1c7975}.company{font-size:10px;margin:3px 0}.tagline{font-size:8px;color:#687c75;margin:0}.barcode{width:48mm;text-align:center;font-size:8px}.barcode img{width:48mm;height:13mm;object-fit:contain}.barcode p{margin:2px 0}
    .contacts{display:flex;justify-content:space-between;gap:3mm;font-size:8px;line-height:1.6;margin:5mm 0 3mm;padding-bottom:3mm;border-bottom:1px solid #1c7975}.contacts div:last-child{text-align:right}
    .amount{position:relative;overflow:hidden;background:#eff5f1;border-radius:3mm;padding:4mm;display:flex;justify-content:space-between;align-items:center}.amount small{font-size:8px;color:#59766b}.amount h2{font-size:24px;margin:2mm 0 0}.paid{font-size:11px;color:#02665e;text-align:right}.paid small{display:block;margin-top:2mm}.ref{font-size:9px;margin:4mm 0}
    section{border:1px solid #cad9d3;border-radius:3mm;margin-bottom:3mm;padding:3mm;break-inside:avoid}h3{font-size:10px;color:#02665e;margin:0 0 2mm}.row{display:grid;grid-template-columns:38% 62%;padding:2mm 0;border-top:1px solid #e4ebe7;font-size:9px;line-height:1.4;break-inside:avoid}.row span:first-child{color:#60756f;padding-right:2mm}.row span:last-child{overflow-wrap:anywhere}
    footer{margin-top:auto;padding-top:3mm;border-top:1px solid #cad9d3;text-align:center;font-size:8px;color:#60756f}footer strong{color:#02665e;font-size:9px}footer p{margin:2mm 0 0}
  </style></head><body><main class="sheet"><header><div class="masthead"><div class="brand"><div class="logo"><img src="${escape(logo)}" alt="NoLSAF"></div><div><h1>NoLSAF</h1><p class="company">NoLS Africa Co LTD</p><p class="tagline">Quality Stay For Every Wallet</p></div></div><div class="barcode">PAYMENT RECEIPT<img src="${canvas.toDataURL('image/png')}" alt="Receipt reference barcode"><p>${escape(receipt.reference)}</p></div></div><div class="contacts"><div>P.O BOX 23091<br>Dar es Salaam, Tanzania</div><div>payments@nolsaf.com<br>www.nolsaf.com</div></div></header>
    <div class="amount"><div><small>NRMS / STATEMENT SETTLEMENT</small><h2>${escape(receipt.currency)} ${escape(receipt.amount.toLocaleString('en-TZ'))}</h2></div><div class="paid">PAID<small>SETTLED</small></div></div><p class="ref">Receipt reference ${escape(receipt.reference)}</p>
    <section><h3>PAYMENT INFORMATION</h3>${rows([['Settlement reference',receipt.settlementReference],['Payment method',receipt.method?.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(char)=>char.toUpperCase()) || 'Not recorded'],['Verification',receipt.manual?'Manually reconciled':'Provider verified'],['Paid at',receipt.manual?'Not recorded independently':date(receipt.paidAt)],['Verified / reconciled at',date(receipt.verifiedAt)],['Provider reference',receipt.providerReference || 'Not recorded']])}</section>
    <section><h3>STATEMENT DETAILS</h3>${rows([['Statement ID',receipt.statementId],['Property',receipt.propertyTitle]])}</section>
    <footer><strong>Quality Stay For Every Wallet</strong><p>Confirms NRMS statement settlement, not owner payout. This is not a fiscal tax receipt.</p></footer></main></body></html>`;
  const frame = document.createElement('iframe');
  frame.title='Receipt PDF renderer';frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:-10000px;top:0;width:128mm;height:2000px;border:0;pointer-events:none;';
  try {
    const ready = new Promise<void>((resolve,reject)=>{frame.onload=()=>resolve();frame.onerror=()=>reject(new Error('Receipt renderer could not load'));});
    frame.srcdoc=html;document.body.appendChild(frame);await ready;
    const documentNode=frame.contentDocument, view=frame.contentWindow;
    const sheet=documentNode?.querySelector<HTMLElement>('.sheet');
    if(!documentNode || !view || !sheet) throw new Error('Receipt template unavailable');
    await documentNode.fonts.ready;
    await Promise.all(Array.from(documentNode.images).map((image)=>image.decode()));
    for(const element of [sheet,...Array.from(sheet.querySelectorAll<HTMLElement>('*'))]) {
      const computed=view.getComputedStyle(element);
      for(const property of Array.from(computed)) element.style.setProperty(property,computed.getPropertyValue(property),'important');
    }
    const pdfModule=await import('html2pdf.js');const html2pdf=pdfModule.default || pdfModule;
    await html2pdf().from(sheet).set({filename:`nrms-receipt-${receipt.statementId}.pdf`,margin:10,jsPDF:{unit:'mm',format:'a5',orientation:'portrait'},html2canvas:{scale:Math.max(2,window.devicePixelRatio||2),useCORS:true,logging:false,backgroundColor:'#ffffff'}}).save();
  } finally {frame.remove();}
}
