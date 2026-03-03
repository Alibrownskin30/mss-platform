import { Router } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const r = Router();
const RPC = "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");
function isPK(s){ try{ const p=new PublicKey(s); return p.toBase58()===s }catch{ return false } }

r.get("/:mint", async (req,res)=>{
const mint=(req.params.mint||"").trim();
if(!isPK(mint)) return res.status(400).json({error:"Invalid mint"});
try{
const pk=new PublicKey(mint);
const supply=await conn.getTokenSupply(pk);
const total=BigInt(supply.value.amount);
const largest=await conn.getTokenLargestAccounts(pk);
const rows=(largest?.value||[]).map(x=>{
const raw=BigInt(x.amount);
const pct= total>0n ? Number(raw)/Number(total)*100 : 0;
return { tokenAccount:x.address.toBase58(), pct:+pct.toFixed(4) };
});
const sum=n=>rows.slice(0,n).reduce((a,b)=>a+(b.pct||0),0);
res.json({
concentration:{ top1:+sum(1).toFixed(2), top5:+sum(5).toFixed(2), top10:+sum(10).toFixed(2) },
topAccounts: rows.slice(0,10)
});
}catch(e){
res.status(500).json({error:"holders failed", message:e?.message||String(e)});
}
});
export default r;