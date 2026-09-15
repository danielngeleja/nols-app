import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawCode128Barcode } from './pdfDocuments.js';

export async function renderNrmsPaymentReceipt(row: any): Promise<Buffer> {
  const regular = process.env.RECEIPT_TREBUCHET_REGULAR_PATH || (process.platform === 'win32' ? 'C:/Windows/Fonts/trebuc.ttf' : '');
  const bold = process.env.RECEIPT_TREBUCHET_BOLD_PATH || (process.platform === 'win32' ? 'C:/Windows/Fonts/trebucbd.ttf' : '');
  if (!regular || !bold || !existsSync(regular) || !existsSync(bold)) throw new Error('RECEIPT_FONT_NOT_CONFIGURED');
  const logo = [process.env.RECEIPT_LOGO_PATH, resolve('apps/web/public/assets/NoLS2025-04.png'), resolve('../web/public/assets/NoLS2025-04.png')].find((path) => path && existsSync(path));
  if (!logo) throw new Error('RECEIPT_LOGO_NOT_CONFIGURED');
  const manual = row.payment.status === 'MANUALLY_VERIFIED' || row.payment.provider === 'ADMIN_MANUAL';
  const reference = `NRMS-${row.statementId}-${String(row.token).replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase().padStart(4, '0')}`;
  const date = (value: any) => value ? new Date(value).toLocaleString('en-GB', {timeZone:'Africa/Dar_es_Salaam',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) + ' EAT' : 'Not recorded';
  // ISO 216 A5 portrait, expressed exactly in millimetres (PDF uses points).
  const mm = (value: number) => value * 72 / 25.4;
  const doc = new PDFDocument({size:[mm(148),mm(210)],margin:mm(10), info:{Title:'NoLSAF NRMS payment receipt',Author:'NoLS Africa Co LTD'}});
  doc.registerFont('Receipt', regular);doc.registerFont('ReceiptBold', bold);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve,reject) => {doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const x=mm(10), width=doc.page.width-mm(20);
  // Branded stationery, not a simulated security seal or fiscal certificate.
  doc.rect(0,0,doc.page.width,doc.page.height).fill('#f7f5ef');
  doc.roundedRect(16,16,doc.page.width-32,doc.page.height-32,12).fillAndStroke('#ffffff','#d9dfd8');
  const barcodeWidth=mm(54), barcodeX=x+width-barcodeWidth;
  doc.save().rect(x,39,36,41).clip().image(logo!,x-19,23,{width:70}).restore();
  doc.font('ReceiptBold').fontSize(17).fillColor('#1c7975').text('NoLSAF',x+46,39,{width:145});
  doc.fontSize(9).fillColor('#213e38').text('NoLS Africa Co LTD',x+46,62,{width:145});
  doc.font('Receipt').fontSize(7).fillColor('#687c75').text('Quality Stay For Every Wallet',x+46,77,{width:145});
  doc.font('ReceiptBold').fontSize(7).fillColor('#526b63').text('PAYMENT RECEIPT',barcodeX,35,{width:barcodeWidth,align:'center'});
  // Code 128 includes ten-module quiet zones on each side. Keep it unscaled
  // when printing; print/scan quality still requires physical verification.
  drawCode128Barcode(doc, `NRMS-RCPT-${row.payment.id}`, barcodeX,49,barcodeWidth,mm(9));
  doc.font('Receipt').fontSize(7).fillColor('#526b63').text(`NRMS-RCPT-${row.payment.id}`,barcodeX,80,{width:barcodeWidth,align:'center'});
  doc.font('Receipt').fontSize(7).fillColor('#526b63').text('P.O BOX 23091',x,102,{width:190})
    .text('Dar es Salaam, Tanzania',x,114,{width:190});
  doc.text('support@nolsaf.com  |  info@nolsaf.com',barcodeX,102,{width:barcodeWidth,align:'right'});
  doc.font('ReceiptBold').fillColor('#1c7975').text('www.nolsaf.com',barcodeX,114,{width:barcodeWidth,align:'right'});
  doc.moveTo(x,131).lineTo(x+width,131).lineWidth(1).strokeColor('#1c7975').stroke();
  doc.roundedRect(x,143,width,64,8).fill('#eff5f1');
  // Repeating monogram fragment echoes the actual logo without implying verification.
  doc.save().rect(x+width-108,144,105,62).clip().opacity(0.06).image(logo!,x+width-195,86,{width:240}).restore();
  doc.font('Receipt').fontSize(7).fillColor('#59766b').text('NRMS / STATEMENT SETTLEMENT',x+12,153);
  doc.font('ReceiptBold').fontSize(20).fillColor('#163d35').text(`${row.payment.currency} ${Number(row.payment.amount).toLocaleString('en-TZ')}`,x+12,171,{width:width-92});
  doc.font('ReceiptBold').fontSize(9).fillColor('#02665e').text('PAID',x+width-61,160,{width:48,align:'center'});
  doc.font('Receipt').fontSize(6.5).text('SETTLED',x+width-61,174,{width:48,align:'center'});
  doc.font('Receipt').fontSize(7).fillColor('#526b63').text(`Receipt reference  NRMS-RCPT-${row.payment.id}`,x,218);
  let y=237;
  const section = (title: string, rows: [string,string][]) => {
    const heights = rows.map(([,value]) => Math.max(21, doc.font('Receipt').fontSize(8.5).heightOfString(value,{width:width-139})+10));
    const height=26+heights.reduce((sum,h)=>sum+h,0);
    if (y+height>doc.page.height-65) {doc.addPage();y=28;}
    doc.roundedRect(x,y,width,height,8).fillAndStroke('#ffffff','#cad9d3');
    doc.font('ReceiptBold').fontSize(9).fillColor('#02665e').text(title,x+12,y+9);
    let lineY=y+26;
    rows.forEach(([label,value],index)=>{
      doc.moveTo(x+10,lineY).lineTo(x+width-10,lineY).strokeColor('#e4ebe7').lineWidth(0.5).stroke();
      doc.font('Receipt').fontSize(8).fillColor('#60756f').text(label,x+12,lineY+6,{width:110});
      doc.font('Receipt').fontSize(8.5).fillColor('#1e3933').text(value,x+125,lineY+5,{width:width-139});
      lineY+=heights[index];
    });
    y+=height+12;
  };
  section('PAYMENT INFORMATION',[
    ['Settlement reference',reference],
    ['Payment method',row.method ? row.method.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(v:string)=>v.toUpperCase()) : 'Not recorded'],
    ['Verification',manual?'Manually reconciled':'Provider verified'],
    ['Paid at',manual?'Not recorded independently':date(row.statement.paidAt)],
    ['Verified / reconciled at',date(row.payment.verifiedAt)],
    ['Provider reference',row.payment.providerRef || 'Not recorded'],
  ]);
  section('STATEMENT DETAILS',[
    ['Statement ID',String(row.statementId)],['Property',row.statement.account.property.title],
  ]);
  if(y>doc.page.height-55){doc.addPage();y=28;}
  doc.font('ReceiptBold').fontSize(8).fillColor('#02665e').text('Quality Stay For Every Wallet',x,y);
  doc.font('Receipt').fontSize(7).fillColor('#60756f').text('Confirms NRMS statement settlement, not owner payout. This is not a fiscal tax receipt.',x,y+14,{width});
  doc.end();return completed;
}
