import { Router } from "express";
import { PublicKey } from "@solana/web3.js";

const r = Router();
function isPK(s){ try{ const p=new PublicKey(s); return p.toBase58()===s }catch{ return false } }

r.get("/:mint", async (req,res)=>{
const mint=(req.params.mint||"").trim();
if(!isPK(mint)) return res.status(400).json({error:"Invalid mint"});
try{
const j = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`).then(r=>r.json());
if(!j?.pairs?.length) return res.json({ found:false });
const best=[...j.pairs].sort((a,b)=>(b?.liquidity?.usd||0)-(a?.liquidity?.usd||0))[0];
res.json({
found:true,
dex:best?.dexId||null,
pairAddress:best?.pairAddress||null,
liquidityUsd:Number(best?.liquidity?.usd)||0,
lock:{ status:"unverified" }
});
}catch(e){
res.status(500).json({error:"lp failed", message:e?.message||String(e)});
}
});
export default r;