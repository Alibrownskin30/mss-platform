function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

export function runCassieSimulation({
token = {},
market = {},
concentration = {},
securityModel = {},
}) {
const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;
const liqFdvPct = safeNum(securityModel?.liquidityStability?.liqFdvPct, 0);
const top10 = safeNum(concentration?.top10, 0);
const hiddenControlScore = safeNum(securityModel?.hiddenControl?.score, 0);

const scenarios = [
{
id: "mint_authority_abuse",
possible: !mintRevoked,
severity: !mintRevoked ? "high" : "low",
note: !mintRevoked
? "Mint authority is present. A malicious issuer could expand supply."
: "Mint authority appears revoked.",
},
{
id: "freeze_restriction_abuse",
possible: !freezeRevoked,
severity: !freezeRevoked ? "high" : "low",
note: !freezeRevoked
? "Freeze authority is present. Transfers could potentially be restricted."
: "Freeze authority appears revoked.",
},
{
id: "liquidity_pull_pressure",
possible: liqFdvPct > 0 && liqFdvPct < 5,
severity: liqFdvPct < 3 ? "high" : liqFdvPct < 5 ? "medium" : "low",
note:
liqFdvPct > 0
? `Liquidity/FDV is ${liqFdvPct.toFixed(2)}%. Lower depth increases exit-pressure sensitivity.`
: "Liquidity depth unavailable.",
},
{
id: "holder_dump_pressure",
possible: top10 >= 55,
severity: top10 >= 70 ? "high" : top10 >= 55 ? "medium" : "low",
note: `Top10 concentration is ${top10.toFixed(2)}%. Higher concentration can amplify coordinated exits.`,
},
{
id: "coordinated_control_risk",
possible: hiddenControlScore >= 45,
severity: hiddenControlScore >= 70 ? "high" : "medium",
note:
hiddenControlScore >= 45
? "Linked-wallet structure suggests coordinated influence risk."
: "No strong coordinated control signal in this simulation.",
},
];

const overallRisk = scenarios.reduce((acc, s) => {
if (!s.possible) return acc;
if (s.severity === "high") return acc + 30;
if (s.severity === "medium") return acc + 18;
return acc + 6;
}, 0);

const simulationScore = Math.max(0, Math.min(100, overallRisk));

return {
ok: true,
mode: "safe_read_only",
note: "Cassie simulation is non-signing and read-only. It does not submit transactions or alter chain state.",
score: simulationScore,
label:
simulationScore >= 70
? "High Exploitability Surface"
: simulationScore >= 40
? "Moderate Exploitability Surface"
: "Lower Exploitability Surface",
scenarios,
};
}
