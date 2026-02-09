function StatusBanner({ kind, children }){
  const base = { padding:"10px 12px", borderRadius:12, border:"1px solid transparent", fontWeight:600 };
  const styles = {
    green: { ...base, background:"#ecfdf5", borderColor:"#10b98130", color:"#065f46" },
    orange:{ ...base, background:"#fff7ed", borderColor:"#f59e0b33", color:"#92400e" },
    red:   { ...base, background:"#fef2f2", borderColor:"#ef444430", color:"#991b1b" },
  };
  return (
    <div className={`pulse-${kind}`} style={styles[kind]}>
      {children}
      <style jsx global>{`
        @keyframes pulse-green { 0%{box-shadow:0 0 0 0 rgba(16,185,129,0.5)} 70%{box-shadow:0 0 0 10px rgba(16,185,129,0)} 100%{box-shadow:0 0 0 0 rgba(16,185,129,0)} }
        @keyframes pulse-orange{ 0%{box-shadow:0 0 0 0 rgba(245,158,11,0.5)} 70%{box-shadow:0 0 0 10px rgba(245,158,11,0)} 100%{box-shadow:0 0 0 0 rgba(245,158,11,0)} }
        @keyframes pulse-red   { 0%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)} 70%{box-shadow:0 0 0 10px rgba(239,68,68,0)} 100%{box-shadow:0 0 0 0 rgba(239,68,68,0)} }
        .pulse-green { animation: pulse-green 2.2s ease-out infinite; }
        .pulse-orange{ animation: pulse-orange 2.2s ease-out infinite; }
        .pulse-red   { animation: pulse-red 2.2s ease-out infinite; }
      `}</style>
    </div>
  );
}
