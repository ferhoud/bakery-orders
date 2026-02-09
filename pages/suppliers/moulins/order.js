// pages/suppliers/moulins/order.js
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

export default function MoulinsOrderRedirect(){
  const router = useRouter();
  useEffect(() => {
    const q = router.query || {};
    const delivery = typeof q.delivery === "string" && q.delivery ? q.delivery : nextWeekdayISO(4, new Date(), true);
    router.replace({ pathname: "/orders", query: { supplier: "moulins", delivery } }, undefined, { shallow: true });
  }, [router]);
  return null;
}
