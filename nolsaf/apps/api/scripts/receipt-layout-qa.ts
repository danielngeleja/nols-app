import {renderNrmsPaymentReceipt} from '../src/lib/nrmsPaymentReceipt.js';
import {mkdirSync,writeFileSync} from 'node:fs';
async function main(){
const longCase=process.argv.includes('--long');
const row={token:'NRMS-SAMPLE-ABCD',statementId:182,status:'PAID',method:'MOBILE_MONEY',payment:{id:75,status:longCase?'VERIFIED':'MANUALLY_VERIFIED',provider:longCase?'TEST_PROVIDER':'ADMIN_MANUAL',currency:'TZS',amount:58000,providerRef:longCase?'TEST-REFERENCE-'.repeat(8).slice(0,120):'BANK-TEST-20260915',verifiedAt:'2026-09-15T09:00:00Z'},statement:{status:'PAID',paidAt:'2026-09-15T09:00:00Z',account:{property:{title:longCase?'Sample Long Property Name International Accommodation and Conference Centre':'SHERATON HOTEL'}}}};
const pdf=await renderNrmsPaymentReceipt(row);
mkdirSync('artifacts/receipt-qa',{recursive:true});writeFileSync(`artifacts/receipt-qa/${longCase?'nrms-long-provider':'nrms-manual'}.pdf`,pdf);
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
