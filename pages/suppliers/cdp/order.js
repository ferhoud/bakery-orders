// pages/suppliers/cdp/order.js
import { useEffect } from "react";
import { useRouter } from "next/router";

function pad2(n){ return String(n).padStart(2,"0"); }
function toISODate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function nextWeekdayISO(targetDay, fromDate = new Date(), includeToday = true){
  const d = new Date(fromDate);
  d.setHours(0,0,0,0);
  const cur = d.getDay();
  let delta = (targetDay - cur + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  d.setDate(d.getDate()+delta);
  return toISODate(d);
}
function pickDefaultDateISO(){
  const now = new Date();
  const w = nextWeekdayISO(3, now, true);
  const f = nextWeekdayISO(5, now, true);
  return (new Date(w) <= new Date(f)) ? w : f;
}

export default function CdpOrderRedirect(){
  const router = useRouter();
  useEffect(() => {
    const q = router.query || {};
    const delivery = typeof q.delivery === "string" && q.delivery ? q.delivery : pickDefaultDateISO();
    router.replace({ pathname: "/orders", query: { supplier: "coupdepates", delivery } }, undefined, { shallow: true });
  }, [router]);
  return null;
}
