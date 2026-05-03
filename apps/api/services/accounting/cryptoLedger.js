import db from "../../db/index.js";
import {
resolveAudPricingSnapshot,
buildZeroAudPricingSnapshot,
} from "./fxPricing.js";

const ALLOWED_WALLET_TYPES = new Set([
"revenue",
"treasury",
"buyback",
"ops",
"burn",
"liquidity",
"builder_bond",
"unknown",
]);

const ALLOWED_EVENT_TYPES = new Set([
"receive",
"send",
"swap",
"buyback",
"burn",
"refund",
"fee",
"expense",
"internal_transfer",
"liquidity_add",
"liquidity_remove",
"builder_bond_receive",
"builder_bond_refund",
"builder_bond_forfeit",
]);

function toNumber(value, fallback = 0) {
if (value === null || value === undefined || value === "") return fallback;
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function cleanSymbol(value) {
return cleanText(value, 32).toUpperCase();
}

function normalizeWalletType(value) {
const normalized = cleanText(value, 32).toLowerCase();
return ALLOWED_WALLET_TYPES.has(normalized) ? normalized : "unknown";
}

function normalizeEventType(value) {
const normalized = cleanText(value, 64).toLowerCase();
if (!ALLOWED_EVENT_TYPES.has(normalized)) {
throw new Error(`Unsupported crypto ledger event_type: ${normalized || "empty"}`);
}
return normalized;
}

function normalizeNullableId(value) {
if (value === null || value === undefined || value === "") return null;
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : null;
}

function stringifyJson(value) {
if (value === null || value === undefined) return null;
try {
return JSON.stringify(value);
} catch {
return JSON.stringify({ error: "failed_to_serialize" });
}
}

export async function writeLedgerEntry({
walletType,
walletAddress = null,
txHash = null,
eventType,
assetSymbol,
assetAddress = null,
amount,

counterAssetSymbol = null,
counterAssetAddress = null,
counterAmount = null,

explicitAudUnitPrice = 0,
explicitUsdUnitPrice = 0,
solUsdPrice = null,
usdToAudRate = null,

audCounterValueAtTx = null,

sourceEvent = null,
sourceRefType = null,
sourceRefId = null,
launchId = null,
tradeId = null,

notes = null,
metadata = null,
} = {}) {
const normalizedWalletType = normalizeWalletType(walletType);
const normalizedEventType = normalizeEventType(eventType);
const normalizedAssetSymbol = cleanSymbol(assetSymbol);
const normalizedAmount = toNumber(amount, 0);

if (!normalizedAssetSymbol) {
throw new Error("cryptoLedger.writeLedgerEntry requires assetSymbol");
}

const pricing =
normalizedAmount > 0
? await resolveAudPricingSnapshot({
assetSymbol: normalizedAssetSymbol,
amount: normalizedAmount,
explicitAudUnitPrice,
explicitUsdUnitPrice,
solUsdPrice,
usdToAudRate,
})
: buildZeroAudPricingSnapshot({
assetSymbol: normalizedAssetSymbol,
amount: normalizedAmount,
});

const result = await db.run(
`
INSERT INTO crypto_accounting_ledger (
wallet_type,
wallet_address,
tx_hash,
event_type,
asset_symbol,
asset_address,
amount,
counter_asset_symbol,
counter_asset_address,
counter_amount,
aud_unit_price_at_tx,
aud_total_value_at_tx,
aud_counter_value_at_tx,
source_event,
source_ref_type,
source_ref_id,
launch_id,
trade_id,
notes,
metadata_json
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
[
normalizedWalletType,
cleanText(walletAddress, 120) || null,
cleanText(txHash, 200) || null,
normalizedEventType,
normalizedAssetSymbol,
cleanText(assetAddress, 120) || null,
normalizedAmount,
cleanSymbol(counterAssetSymbol) || null,
cleanText(counterAssetAddress, 120) || null,
counterAmount === null || counterAmount === undefined ? null : toNumber(counterAmount, 0),
pricing.audUnitPrice,
pricing.audTotalValue,
audCounterValueAtTx === null || audCounterValueAtTx === undefined
? null
: toNumber(audCounterValueAtTx, 0),
cleanText(sourceEvent, 120) || null,
cleanText(sourceRefType, 80) || null,
cleanText(sourceRefId, 120) || null,
normalizeNullableId(launchId),
normalizeNullableId(tradeId),
cleanText(notes, 2000) || null,
stringifyJson({
...(metadata && typeof metadata === "object" ? metadata : {}),
fx_context: {
sol_usd_price: pricing.solUsdPrice,
usd_to_aud_rate: pricing.usdToAudRate,
pricing_sources: pricing.sources,
},
}),
]
);

return {
ok: true,
id: result?.lastID ?? null,
walletType: normalizedWalletType,
eventType: normalizedEventType,
assetSymbol: normalizedAssetSymbol,
amount: normalizedAmount,
audUnitPriceAtTx: pricing.audUnitPrice,
audTotalValueAtTx: pricing.audTotalValue,
};
}

export async function writeSwapLedgerEntries({
fromWalletType,
fromWalletAddress = null,
txHash = null,
sourceEvent = "swap",
sourceRefType = null,
sourceRefId = null,
launchId = null,
tradeId = null,

disposedAssetSymbol,
disposedAssetAddress = null,
disposedAmount,
disposedExplicitAudUnitPrice = 0,
disposedExplicitUsdUnitPrice = 0,

receivedAssetSymbol,
receivedAssetAddress = null,
receivedAmount,
receivedExplicitAudUnitPrice = 0,
receivedExplicitUsdUnitPrice = 0,

solUsdPrice = null,
usdToAudRate = null,
notes = null,
metadata = null,
} = {}) {
const disposedPricing = await resolveAudPricingSnapshot({
assetSymbol: disposedAssetSymbol,
amount: disposedAmount,
explicitAudUnitPrice: disposedExplicitAudUnitPrice,
explicitUsdUnitPrice: disposedExplicitUsdUnitPrice,
solUsdPrice,
usdToAudRate,
});

const receivedPricing = await resolveAudPricingSnapshot({
assetSymbol: receivedAssetSymbol,
amount: receivedAmount,
explicitAudUnitPrice: receivedExplicitAudUnitPrice,
explicitUsdUnitPrice: receivedExplicitUsdUnitPrice,
solUsdPrice,
usdToAudRate,
});

const outEntry = await writeLedgerEntry({
walletType: fromWalletType,
walletAddress: fromWalletAddress,
txHash,
eventType: "swap",
assetSymbol: disposedAssetSymbol,
assetAddress: disposedAssetAddress,
amount: disposedAmount,
counterAssetSymbol: receivedAssetSymbol,
counterAssetAddress: receivedAssetAddress,
counterAmount: receivedAmount,
explicitAudUnitPrice: disposedPricing.audUnitPrice,
solUsdPrice,
usdToAudRate,
audCounterValueAtTx: receivedPricing.audTotalValue,
sourceEvent,
sourceRefType,
sourceRefId,
launchId,
tradeId,
notes,
metadata: {
...(metadata && typeof metadata === "object" ? metadata : {}),
swap_side: "disposed",
},
});

const inEntry = await writeLedgerEntry({
walletType: fromWalletType,
walletAddress: fromWalletAddress,
txHash,
eventType: "receive",
assetSymbol: receivedAssetSymbol,
assetAddress: receivedAssetAddress,
amount: receivedAmount,
counterAssetSymbol: disposedAssetSymbol,
counterAssetAddress: disposedAssetAddress,
counterAmount: disposedAmount,
explicitAudUnitPrice: receivedPricing.audUnitPrice,
solUsdPrice,
usdToAudRate,
audCounterValueAtTx: disposedPricing.audTotalValue,
sourceEvent,
sourceRefType,
sourceRefId,
launchId,
tradeId,
notes,
metadata: {
...(metadata && typeof metadata === "object" ? metadata : {}),
swap_side: "received",
},
});

return {
ok: true,
disposedEntryId: outEntry.id,
receivedEntryId: inEntry.id,
};
}

export async function listLedgerEntries({
walletType = null,
sourceRefType = null,
sourceRefId = null,
launchId = null,
tradeId = null,
txHash = null,
limit = 100,
} = {}) {
const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 100));
const filters = [];
const params = [];

if (walletType) {
filters.push("wallet_type = ?");
params.push(normalizeWalletType(walletType));
}

if (sourceRefType) {
filters.push("source_ref_type = ?");
params.push(cleanText(sourceRefType, 80));
}

if (sourceRefId) {
filters.push("source_ref_id = ?");
params.push(cleanText(sourceRefId, 120));
}

if (launchId !== null && launchId !== undefined && launchId !== "") {
filters.push("launch_id = ?");
params.push(normalizeNullableId(launchId));
}

if (tradeId !== null && tradeId !== undefined && tradeId !== "") {
filters.push("trade_id = ?");
params.push(normalizeNullableId(tradeId));
}

if (txHash) {
filters.push("tx_hash = ?");
params.push(cleanText(txHash, 200));
}

const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

return db.all(
`
SELECT
id,
wallet_type,
wallet_address,
tx_hash,
event_type,
asset_symbol,
asset_address,
amount,
counter_asset_symbol,
counter_asset_address,
counter_amount,
aud_unit_price_at_tx,
aud_total_value_at_tx,
aud_counter_value_at_tx,
source_event,
source_ref_type,
source_ref_id,
launch_id,
trade_id,
notes,
metadata_json,
created_at,
updated_at
FROM crypto_accounting_ledger
${whereClause}
ORDER BY id DESC
LIMIT ?
`,
[...params, safeLimit]
);
}

export default {
writeLedgerEntry,
writeSwapLedgerEntries,
listLedgerEntries,
};
