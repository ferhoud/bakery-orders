export default function Ping(){
  return (
    <main style={{padding:20,fontFamily:"system-ui"}}>
      <h1>OK ✅</h1>
      <p>Client time: {new Date().toLocaleTimeString()}</p>
    </main>
  );
}
