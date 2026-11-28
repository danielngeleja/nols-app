"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadOwnerPropertyRefs, ownerPropertyRefOrId } from "@/lib/ownerPropertyRefs";
export default function OwnerEventRequestsPage() {
  const router=useRouter();
  useEffect(() => {
    let active=true;
    void (async()=>{const id=Number(new URLSearchParams(window.location.search).get("propertyId"));let venue="";if(Number.isSafeInteger(id)&&id>0){await loadOwnerPropertyRefs();const ref=ownerPropertyRefOrId(id);if(ref.startsWith("pp_"))venue=`&venue=${encodeURIComponent(ref)}`;}if(active)router.replace(`/owner/properties/events?tab=requests${venue}`);})();
    return()=>{active=false;};
  }, [router]);
  return <p role="status" className="text-sm text-slate-500">Opening event requests…</p>;
}
