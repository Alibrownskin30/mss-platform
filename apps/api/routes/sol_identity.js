import { Router } from "express";
import { PublicKey } from "@solana/web3.js";

const r = Router();
function isPK(s){ try{ const p=new PublicKey(s); return p.toBase58()===s }catch{ return false } }

r.get("/:mint", async (req,res)=>{
const mint=(req.params.mint||"").trim();
if(!isPK(mint)) return res.status(400).json({error:"Invalid mint"});
try{
const j = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`).then(r=>r.json());
let best=null;
if(j?.pairs?.length) best=[...j.pairs].sort((a,b)=>(b?.liquidity?.usd||0)-(a?.liquidity?.usd||0))[0];
res.json({
mint,
name:best?.baseToken?.name||null,
symbol:best?.baseToken?.symbol||null,
logo:best?.baseToken?.logoURI||null,
links:{
website:best?.info?.links?.website||null,
x:best?.info?.socials?.twitter||null,
telegram:best?.info?.socials?.telegram||null,
discord:best?.info?.socials?.discord||null
},
metadata:{ found:Boolean(best), source: best?["dex"]:[] }
});
}catch(e){
res.status(500).json({error:"identity failed", message:e?.message||String(e)});
}
});
export default r;
