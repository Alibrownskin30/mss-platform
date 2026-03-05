export function buildSecurityModel({
concentration,
token,
activity
}) {

const signals = [];
let score = 0;

const top10 = Number(concentration?.top10 || 0);

const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;

const clusters = Number(activity?.clustersCount || 0);
const sybil = Number(activity?.sybilScore0to100 || 0);

const freshWallets = Number(activity?.freshWallets || 0);
const sameFundingWallets = Number(activity?.sameFundingWallets || 0);

const liquidityMigration = !!activity?.liquidityMigration;

// --- Holder concentration ---
if (top10 > 50) {
score += 20;
signals.push("High holder concentration");
} else if (top10 > 35) {
score += 10;
}

// --- Authority checks ---
if (!mintRevoked) {
score += 15;
signals.push("Mint authority active");
}

if (!freezeRevoked) {
score += 10;
signals.push("Freeze authority active");
}

// --- Cluster intelligence ---
if (clusters >= 8) {
score += 10;
signals.push("Clustered wallet activity");
}

if (sybil >= 70) {
score += 15;
signals.push("Sybil pattern detected");
}

// --- Wallet behaviour ---
if (freshWallets >= 10) {
score += 10;
signals.push("Fresh wallet buying activity");
}

if (sameFundingWallets >= 5) {
score += 10;
signals.push("Multiple wallets funded by same source");
}

// --- Liquidity migration ---
if (liquidityMigration) {
score += 10;
signals.push("Liquidity migration detected");
}

if (score > 100) score = 100;

let label = "Low Risk";

if (score >= 75) label = "Critical Risk";
else if (score >= 60) label = "High Risk";
else if (score >= 40) label = "Moderate Risk";

return {
score,
label,
signals
};
}