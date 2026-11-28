"use client";
import {useEffect,useState} from "react";
import {useParams} from "next/navigation";
import Link from "next/link";
import {ArrowLeft,Printer,ShieldCheck} from "lucide-react";
import apiClient from "@/lib/apiClient";
import {tsh} from "./eventHireTypes";

type Confirmation={reference:string;propertyTitle:string;organizer:string;startsAt:string;endsAt:string;status:string;total:number;deposit:number;paidAt:string|null;depositStatus:string};
export default function EventPaymentConfirmation({audience}:{audience:"owner"|"customer"|"admin"}){
  const params=useParams<{ref:string}>();
  const [record,setRecord]=useState<Confirmation|null>(null),[error,setError]=useState("");
  const base=audience==="admin"?"/api/admin/event-hire/operations":`/api/${audience}/event-hire`;
  const back=audience==="owner"?"/owner/properties/events?tab=payments":audience==="admin"?"/admin/event-hire/payments":"/account/event-requests?tab=payments";
  useEffect(()=>{const controller=new AbortController();void apiClient.get(`${base}/bookings/${encodeURIComponent(params.ref)}`,{signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setRecord(r.data);}).catch(e=>{if(!controller.signal.aborted)setError(e?.response?.data?.error||"Could not load this payment confirmation.");});return()=>controller.abort();},[base,params.ref]);
  const when=(value:string)=>new Date(value).toLocaleString("en-GB",{timeZone:"Africa/Dar_es_Salaam",dateStyle:"medium",timeStyle:"short"});
  return <section data-event-payment-confirmation className="mx-auto max-w-3xl rounded-xl border border-solid border-slate-200 bg-white p-6 text-slate-800 sm:p-9">
    <style>{`[data-event-payment-confirmation] dl>div{display:flex;justify-content:space-between;gap:24px;padding:13px 0;border-bottom:1px solid #e7eee9}[data-event-payment-confirmation] dt{color:#617267;font-size:13px}[data-event-payment-confirmation] dd{margin:0;text-align:right;font-size:13px;font-weight:600;overflow-wrap:anywhere}@media print{body:has([data-event-payment-confirmation]) *{visibility:hidden}[data-event-payment-confirmation],[data-event-payment-confirmation] *{visibility:visible!important}[data-event-payment-confirmation]{position:absolute;left:0;top:0;width:100%;max-width:none;border:0!important;padding:15mm!important;box-shadow:none!important}[data-event-payment-confirmation] [data-print-controls]{display:none!important}}`}</style>
    <div data-print-controls className="mb-7 flex items-center justify-between gap-3"><Link href={back} className="inline-flex items-center gap-2 text-sm text-teal-800 no-underline"><ArrowLeft size={15}/>Event payments</Link>{record?.paidAt&&<button onClick={()=>window.print()} className="inline-flex items-center gap-2 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><Printer size={15}/>Print / save</button>}</div>
    <p className="m-0 text-xl font-bold tracking-tight text-[#02665e]">NoLSAF</p><h1 className="mb-2 mt-6 text-2xl font-bold">Event payment confirmation</h1>
    {error?<p role="alert" className="text-sm text-rose-800">{error}</p>:!record?<p role="status">Loading verified payment…</p>:!record.paidAt?<p role="status" className="mt-5 text-sm text-amber-900">Payment has not been verified. A confirmation is available after NoLSAF receives a verified provider notice.</p>:<>
      <p className="flex items-center gap-2 text-sm text-teal-800"><ShieldCheck size={17}/>Payment verified by NoLSAF</p>
      <dl><div><dt>Booking reference</dt><dd>{record.reference}</dd></div><div><dt>Event venue</dt><dd>{record.propertyTitle}</dd></div><div><dt>Client / organiser</dt><dd>{record.organizer}</dd></div><div><dt>Event time (EAT)</dt><dd>{when(record.startsAt)}<br/>to {when(record.endsAt)}</dd></div><div><dt>Payment verified (EAT)</dt><dd>{when(record.paidAt)}</dd></div><div><dt>Total collected for this booking</dt><dd>{tsh(record.total)}</dd></div><div><dt>Included refundable security deposit</dt><dd>{tsh(record.deposit)}</dd></div><div><dt>Booking status</dt><dd>{record.status.toLowerCase().replace(/_/g," ")}</dd></div><div><dt>Deposit status</dt><dd>{record.depositStatus.toLowerCase().replace(/_/g," ")}</dd></div></dl>
      <p className="mt-6 text-xs leading-6 text-slate-600">The security deposit is held separately from venue earnings. Refunds and damage decisions appear in the booking's payment history. This confirmation records the verified collection; the booking status above shows whether the event reservation is confirmed or under review.</p>
    </>}
  </section>;
}
