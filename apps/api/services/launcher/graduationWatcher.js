import db from "../../db/index.js";

const GRADUATION_MARKETCAP_SOL = 2500; // placeholder for ~$250k at $100/SOL
const REMAINING_POOL_THRESHOLD = 0.10; // 10% remaining = 90% sold

async function getActivePools() {
return db.all(
`
SELECT
p.*,
t.supply as token_supply,
t.name as token_name,
t.symbol as token_symbol,
l.status as launch_status
FROM pools p
JOIN tokens t ON t.id = p.token_id
JOIN launches l ON l.id = p.launch_id
WHERE p.status = 'active'
AND l.status IN ('live', 'active')
`
);
}

function calculateMarketCapInSol(pool) {
const tokenReserve = Number(pool.token_reserve);
const solReserve = Number(pool.sol_reserve);
const supply = Number(pool.token_supply);

if (!tokenReserve || !solReserve || !supply) return 0;

const priceInSol = solReserve / tokenReserve;
return priceInSol * supply;
}

function hasReachedPoolSoldThreshold(pool) {
const initialReserve = Number(pool.initial_token_reserve || 0);
const currentReserve = Number(pool.token_reserve || 0);

if (!initialReserve || !currentReserve) return false;

return currentReserve <= initialReserve * REMAINING_POOL_THRESHOLD;
}

async function graduateLaunch(pool, reason) {
await db.run(
`
UPDATE pools
SET status = 'graduated',
graduated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[pool.id]
);

await db.run(
`
UPDATE launches
SET status = 'graduated',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[pool.launch_id]
);

console.log(
`🎓 Launch ${pool.launch_id} graduated (${pool.token_symbol}) via ${reason}`
);
}

export async function checkGraduations() {
try {
const pools = await getActivePools();

for (const pool of pools) {
const marketCapInSol = calculateMarketCapInSol(pool);
const soldThresholdHit = hasReachedPoolSoldThreshold(pool);

if (marketCapInSol >= GRADUATION_MARKETCAP_SOL) {
await graduateLaunch(pool, "marketcap");
continue;
}

if (soldThresholdHit) {
await graduateLaunch(pool, "pool_sold");
}
}
} catch (err) {
console.error("GRADUATION WATCHER ERROR:", err);
}
}

export function startGraduationWatcher() {
console.log("🎓 Graduation watcher running (every 15s)");

checkGraduations();

setInterval(() => {
checkGraduations();
}, 15000);
}
