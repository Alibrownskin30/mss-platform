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
const info=await conn.getParsedAccountInfo(new PublicKey(mint));
if(!info?.value) return res.status(404).json({error:"Mint not found"});
const p=info.value.data?.parsed?.info;
res.json({
mint,
supply:p?.supply ?? null,
decimals:p?.decimals ?? null,
mintAuthority:p?.mintAuthority ?? null,
freezeAuthority:p?.freezeAuthority ?? null,
safety:{
mintRevoked:p?.mintAuthority===null,
freezeRevoked:p?.freezeAuthority===null
}
});
}catch(e){
res.status(500).json({error:"scan failed", message:e?.message||String(e)});
}
});
export default r;