const state = {
cases: [],
selectedCaseId: null,
selectedCase: null,
filters: {
status: "",
caseType: "",
riskLevel: "",
assignedTo: "",
},

sentinel: {
settings: null,
summary: null,
stats: null,
positions: [],
audit: [],
filters: {
statsDate: new Date().toISOString().slice(0, 10),
statsMode: "paper",
positionStage: "open",
positionMode: "",
positionTokenId: "",
auditEventType: "",
auditDecision: "",
auditTokenId: "",
},
},

caseLoadingCount: 0,
sentinelLoadingCount: 0,
};

const els = {
queueCountChip: document.getElementById("queueCountChip"),
apiStatusChip: document.getElementById("apiStatusChip"),
sentinelModeChip: document.getElementById("sentinelModeChip"),
refreshCasesButton: document.getElementById("refreshCasesButton"),

heroFilterValue: document.getElementById("heroFilterValue"),
heroSelectedValue: document.getElementById("heroSelectedValue"),
heroReviewStateValue: document.getElementById("heroReviewStateValue"),
heroSentinelModeValue: document.getElementById("heroSentinelModeValue"),

openCountValue: document.getElementById("openCountValue"),
escalatedCountValue: document.getElementById("escalatedCountValue"),
resolvedCountValue: document.getElementById("resolvedCountValue"),

banner: document.getElementById("banner"),
sentinelBanner: document.getElementById("sentinelBanner"),

filterStatus: document.getElementById("filterStatus"),
filterCaseType: document.getElementById("filterCaseType"),
filterRiskLevel: document.getElementById("filterRiskLevel"),
filterAssignedTo: document.getElementById("filterAssignedTo"),
applyFiltersButton: document.getElementById("applyFiltersButton"),

casesTableBody: document.getElementById("casesTableBody"),

caseDetailEmpty: document.getElementById("caseDetailEmpty"),
caseDetailPanel: document.getElementById("caseDetailPanel"),

detailCaseId: document.getElementById("detailCaseId"),
detailCaseType: document.getElementById("detailCaseType"),
detailStatus: document.getElementById("detailStatus"),
detailRisk: document.getElementById("detailRisk"),
detailReviewReason: document.getElementById("detailReviewReason"),

detailWallet: document.getElementById("detailWallet"),
detailProfileType: document.getElementById("detailProfileType"),
detailProfileStatus: document.getElementById("detailProfileStatus"),
detailProfileRisk: document.getElementById("detailProfileRisk"),
detailCountry: document.getElementById("detailCountry"),
detailManualReview: document.getElementById("detailManualReview"),
detailProfileName: document.getElementById("detailProfileName"),

detailLaunchName: document.getElementById("detailLaunchName"),
detailLaunchStatus: document.getElementById("detailLaunchStatus"),
detailLaunchTemplate: document.getElementById("detailLaunchTemplate"),
detailBuilderWallet: document.getElementById("detailBuilderWallet"),

assignedToInput: document.getElementById("assignedToInput"),
actionNotes: document.getElementById("actionNotes"),
escalationRiskLevel: document.getElementById("escalationRiskLevel"),

approveCaseButton: document.getElementById("approveCaseButton"),
rejectCaseButton: document.getElementById("rejectCaseButton"),
freezeCaseButton: document.getElementById("freezeCaseButton"),
escalateCaseButton: document.getElementById("escalateCaseButton"),
assignCaseButton: document.getElementById("assignCaseButton"),

refreshSentinelButton: document.getElementById("refreshSentinelButton"),
saveSentinelSettingsButton: document.getElementById("saveSentinelSettingsButton"),

sentinelCurrentModeValue: document.getElementById("sentinelCurrentModeValue"),
sentinelWatcherEnabledValue: document.getElementById("sentinelWatcherEnabledValue"),
sentinelKillSwitchValue: document.getElementById("sentinelKillSwitchValue"),
sentinelOpenPositionsHeroValue: document.getElementById("sentinelOpenPositionsHeroValue"),

sentinelModePaperButton: document.getElementById("sentinelModePaperButton"),
sentinelModeArmedButton: document.getElementById("sentinelModeArmedButton"),
sentinelModeLiveButton: document.getElementById("sentinelModeLiveButton"),
sentinelEmergencyStopButton: document.getElementById("sentinelEmergencyStopButton"),
sentinelModeReasonInput: document.getElementById("sentinelModeReasonInput"),

sentinelScoutUsdInput: document.getElementById("sentinelScoutUsdInput"),
sentinelSniperAddUsdInput: document.getElementById("sentinelSniperAddUsdInput"),
sentinelMaxTotalPositionUsdInput: document.getElementById("sentinelMaxTotalPositionUsdInput"),
sentinelMaxOpenPositionsInput: document.getElementById("sentinelMaxOpenPositionsInput"),
sentinelMaxDailyLossUsdInput: document.getElementById("sentinelMaxDailyLossUsdInput"),
sentinelMaxConsecutiveFailuresInput: document.getElementById("sentinelMaxConsecutiveFailuresInput"),
sentinelMaxDailyScoutSpendUsdInput: document.getElementById("sentinelMaxDailyScoutSpendUsdInput"),
sentinelMaxDailySniperSpendUsdInput: document.getElementById("sentinelMaxDailySniperSpendUsdInput"),
sentinelAutoBankMultipleInput: document.getElementById("sentinelAutoBankMultipleInput"),
sentinelAutoBankFractionInput: document.getElementById("sentinelAutoBankFractionInput"),
sentinelMinOperatorQualityScoreInput: document.getElementById("sentinelMinOperatorQualityScoreInput"),
sentinelMaxHiddenControlRiskInput: document.getElementById("sentinelMaxHiddenControlRiskInput"),
sentinelMinRegimeScoreScoutInput: document.getElementById("sentinelMinRegimeScoreScoutInput"),
sentinelMinRegimeScoreSniperInput: document.getElementById("sentinelMinRegimeScoreSniperInput"),
sentinelMinReclaimStrengthScoreInput: document.getElementById("sentinelMinReclaimStrengthScoreInput"),
sentinelMinBuyPressureScoreInput: document.getElementById("sentinelMinBuyPressureScoreInput"),
sentinelMinPersistenceScoreInput: document.getElementById("sentinelMinPersistenceScoreInput"),
sentinelMinPostEntryHealthScoreInput: document.getElementById("sentinelMinPostEntryHealthScoreInput"),

sentinelWatcherEnabledInput: document.getElementById("sentinelWatcherEnabledInput"),
sentinelAutoBankEnabledInput: document.getElementById("sentinelAutoBankEnabledInput"),
sentinelEnableScoutInput: document.getElementById("sentinelEnableScoutInput"),
sentinelEnableSniperInput: document.getElementById("sentinelEnableSniperInput"),
sentinelEnableRunnerManagementInput: document.getElementById("sentinelEnableRunnerManagementInput"),
sentinelRiskOffDisableNewEntriesInput: document.getElementById(
"sentinelRiskOffDisableNewEntriesInput"
),

sentinelSummaryOpenPositions: document.getElementById("sentinelSummaryOpenPositions"),
sentinelSummaryDailyRealizedPnl: document.getElementById("sentinelSummaryDailyRealizedPnl"),
sentinelSummaryDailyUnrealizedPnl: document.getElementById(
"sentinelSummaryDailyUnrealizedPnl"
),
sentinelSummaryDailyLoss: document.getElementById("sentinelSummaryDailyLoss"),

sentinelStatsDateInput: document.getElementById("sentinelStatsDateInput"),
sentinelStatsModeFilter: document.getElementById("sentinelStatsModeFilter"),
refreshSentinelStatsButton: document.getElementById("refreshSentinelStatsButton"),

sentinelStatsScoutsOpened: document.getElementById("sentinelStatsScoutsOpened"),
sentinelStatsSniperAdds: document.getElementById("sentinelStatsSniperAdds"),
sentinelStatsPositionsClosed: document.getElementById("sentinelStatsPositionsClosed"),
sentinelStatsInvalidations: document.getElementById("sentinelStatsInvalidations"),
sentinelStatsConsecutiveFailures: document.getElementById("sentinelStatsConsecutiveFailures"),
sentinelStatsReclaimSuccessRate: document.getElementById("sentinelStatsReclaimSuccessRate"),
sentinelStatsRecentRugRate: document.getElementById("sentinelStatsRecentRugRate"),
sentinelStatsAvgMarketLiquidity: document.getElementById(
"sentinelStatsAvgMarketLiquidity"
),

sentinelPositionStageFilter: document.getElementById("sentinelPositionStageFilter"),
sentinelPositionsModeFilter: document.getElementById("sentinelPositionsModeFilter"),
sentinelPositionsTokenFilter: document.getElementById("sentinelPositionsTokenFilter"),
refreshSentinelPositionsButton: document.getElementById("refreshSentinelPositionsButton"),
sentinelPositionsTableBody: document.getElementById("sentinelPositionsTableBody"),

sentinelAuditEventTypeFilter: document.getElementById("sentinelAuditEventTypeFilter"),
sentinelAuditDecisionFilter: document.getElementById("sentinelAuditDecisionFilter"),
sentinelAuditTokenFilter: document.getElementById("sentinelAuditTokenFilter"),
refreshSentinelAuditButton: document.getElementById("refreshSentinelAuditButton"),
sentinelAuditTableBody: document.getElementById("sentinelAuditTableBody"),
};

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value;
const normalized = cleanText(value, 16).toLowerCase();
if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
if (normalized === "false" || normalized === "0" || normalized === "no") return false;
return fallback;
}

function shortenWallet(wallet) {
const value = cleanText(wallet, 200);
if (!value) return "—";
if (value.length <= 14) return value;
return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function titleCase(value) {
return cleanText(value, 120)
.replace(/_/g, " ")
.split(" ")
.filter(Boolean)
.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
.join(" ");
}

function formatDateTime(value) {
const date = new Date(value);
if (!value || Number.isNaN(date.getTime())) return "—";
return date.toLocaleString();
}

function formatCurrency(value) {
const num = Number(value);
if (!Number.isFinite(num)) return "$0.00";
return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
maximumFractionDigits: 2,
}).format(num);
}

function formatPercent(value, fractionDigits = 1) {
const num = Number(value);
if (!Number.isFinite(num)) return "0%";
return `${num.toFixed(fractionDigits)}%`;
}

function formatNumber(value, fractionDigits = 0) {
const num = Number(value);
if (!Number.isFinite(num)) return "0";
return new Intl.NumberFormat(undefined, {
maximumFractionDigits: fractionDigits,
minimumFractionDigits: fractionDigits,
}).format(num);
}

function safeNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function getApiBase() {
const { protocol, hostname } = window.location;
const override = cleanText(window.__API_BASE__ || "", 1000);
if (override) return override.replace(/\/$/, "");

if (
hostname === "127.0.0.1" ||
hostname === "localhost" ||
hostname === "[::1]"
) {
return `${protocol}//${hostname}:8787`;
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.app.github.dev", "-8787.app.github.dev")}`;
}

if (hostname.includes("-3001.app.github.dev")) {
return `${protocol}//${hostname.replace("-3001.app.github.dev", "-8787.app.github.dev")}`;
}

if (hostname.includes("-4173.app.github.dev")) {
return `${protocol}//${hostname.replace("-4173.app.github.dev", "-8787.app.github.dev")}`;
}

if (/:\d+$/.test(window.location.host)) {
return `${protocol}//${hostname}:8787`;
}

return `${window.location.origin}`;
}

const API_BASE = getApiBase();

async function apiFetch(path, options = {}) {
const response = await fetch(`${API_BASE}${path}`, {
credentials: "include",
headers: {
"Content-Type": "application/json",
...(options.headers || {}),
},
...options,
});

let payload = null;
try {
payload = await response.json();
} catch {
payload = null;
}

if (!response.ok) {
throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`);
}

return payload;
}

function setCaseBanner(message = "", variant = "warn") {
if (!els.banner) return;
els.banner.textContent = message || "";
els.banner.className = "banner";
if (message) {
els.banner.classList.add("show");
els.banner.classList.add(variant);
}
}

function clearCaseBanner() {
if (!els.banner) return;
els.banner.className = "banner";
els.banner.textContent = "";
}

function setSentinelBanner(message = "", variant = "warn") {
if (!els.sentinelBanner) return;
els.sentinelBanner.textContent = message || "";
els.sentinelBanner.className = "banner";
if (message) {
els.sentinelBanner.classList.add("show");
els.sentinelBanner.classList.add(variant);
}
}

function clearSentinelBanner() {
if (!els.sentinelBanner) return;
els.sentinelBanner.className = "banner";
els.sentinelBanner.textContent = "";
}

function isCasesLoading() {
return state.caseLoadingCount > 0;
}

function isSentinelLoading() {
return state.sentinelLoadingCount > 0;
}

function refreshApiStatus() {
if (els.apiStatusChip) {
els.apiStatusChip.textContent =
isCasesLoading() || isSentinelLoading() ? "Loading" : "Ready";
}
}

function updateCaseControlDisabledState() {
const disabled = isCasesLoading();
[
els.refreshCasesButton,
els.applyFiltersButton,
els.approveCaseButton,
els.rejectCaseButton,
els.freezeCaseButton,
els.escalateCaseButton,
els.assignCaseButton,
].forEach((button) => {
if (button) button.disabled = disabled;
});
}

function updateSentinelControlDisabledState() {
const disabled = isSentinelLoading();
[
els.refreshSentinelButton,
els.saveSentinelSettingsButton,
els.sentinelModePaperButton,
els.sentinelModeArmedButton,
els.sentinelModeLiveButton,
els.sentinelEmergencyStopButton,
els.refreshSentinelStatsButton,
els.refreshSentinelPositionsButton,
els.refreshSentinelAuditButton,
].forEach((button) => {
if (button) button.disabled = disabled;
});
}

function beginCasesLoading() {
state.caseLoadingCount += 1;
refreshApiStatus();
updateCaseControlDisabledState();
}

function endCasesLoading() {
state.caseLoadingCount = Math.max(0, state.caseLoadingCount - 1);
refreshApiStatus();
updateCaseControlDisabledState();
}

function beginSentinelLoading() {
state.sentinelLoadingCount += 1;
refreshApiStatus();
updateSentinelControlDisabledState();
}

function endSentinelLoading() {
state.sentinelLoadingCount = Math.max(0, state.sentinelLoadingCount - 1);
refreshApiStatus();
updateSentinelControlDisabledState();
}

function getStatusVariant(status) {
const normalized = cleanText(status, 32).toLowerCase();
if (normalized === "approved") return "good";
if (normalized === "rejected" || normalized === "restricted" || normalized === "frozen") {
return "bad";
}
return "warn";
}

function getRiskVariant(riskLevel) {
const normalized = cleanText(riskLevel, 32).toLowerCase();
if (normalized === "low") return "good";
if (normalized === "critical" || normalized === "high") return "bad";
return "warn";
}

function getSentinelModeVariant(mode) {
const normalized = cleanText(mode, 64).toLowerCase();
if (normalized === "live_mainnet") return "good";
if (normalized === "armed_mainnet") return "warn";
if (normalized === "emergency_stop") return "bad";
return "neutral";
}

function getSentinelStageVariant(stage) {
const normalized = cleanText(stage, 64).toLowerCase();
if (normalized === "half_banked_at_10x" || normalized === "runner_only") return "good";
if (normalized === "invalidated") return "bad";
if (normalized === "closed") return "neutral";
return "warn";
}

function getExecutionStatusVariant(status) {
const normalized = cleanText(status, 64).toLowerCase();
if (normalized === "filled" || normalized === "simulated") return "good";
if (normalized === "failed") return "bad";
if (normalized === "submitted" || normalized === "planned") return "warn";
return "neutral";
}

function createPill(text, variant = "neutral") {
const span = document.createElement("span");
span.className = `pill ${variant}`;
span.textContent = text;
return span;
}

function renderTableEmpty(tbody, colspan, message) {
if (!tbody) return;
tbody.innerHTML = "";
const row = document.createElement("tr");
const td = document.createElement("td");
td.colSpan = colspan;
td.style.padding = "24px";
td.style.color = "var(--muted)";
td.style.textAlign = "center";
td.textContent = message;
row.appendChild(td);
tbody.appendChild(row);
}

function getSelectedCase() {
if (!state.selectedCaseId) return null;
return state.cases.find((item) => Number(item.id) === Number(state.selectedCaseId)) || null;
}

function updateComplianceSummary() {
const openLike = state.cases.filter((item) =>
["open", "pending_info"].includes(cleanText(item.status, 32).toLowerCase())
).length;

const escalatedLike = state.cases.filter((item) =>
["escalated", "frozen"].includes(cleanText(item.status, 32).toLowerCase())
).length;

const resolvedLike = state.cases.filter((item) =>
["approved", "rejected"].includes(cleanText(item.status, 32).toLowerCase())
).length;

if (els.queueCountChip) {
els.queueCountChip.textContent = `${state.cases.length} case${state.cases.length === 1 ? "" : "s"}`;
}
if (els.openCountValue) els.openCountValue.textContent = String(openLike);
if (els.escalatedCountValue) els.escalatedCountValue.textContent = String(escalatedLike);
if (els.resolvedCountValue) els.resolvedCountValue.textContent = String(resolvedLike);

const filterParts = [];
if (state.filters.status) filterParts.push(`status:${state.filters.status}`);
if (state.filters.caseType) filterParts.push(`type:${state.filters.caseType}`);
if (state.filters.riskLevel) filterParts.push(`risk:${state.filters.riskLevel}`);
if (state.filters.assignedTo) filterParts.push(`assigned:${state.filters.assignedTo}`);
if (els.heroFilterValue) {
els.heroFilterValue.textContent = filterParts.length ? filterParts.join(" • ") : "All cases";
}

const selected = getSelectedCase();
if (els.heroSelectedValue) {
els.heroSelectedValue.textContent = selected
? `#${selected.id} ${cleanText(selected.case_type, 40)}`
: "None selected";
}

if (els.heroReviewStateValue) {
els.heroReviewStateValue.textContent = selected
? cleanText(selected.status, 40) || "Selected"
: state.cases.length
? "Queue loaded"
: "No cases loaded";
}
}

function applySentinelModeToUi(mode) {
const label = titleCase(mode || "paper") || "Paper";
if (els.sentinelModeChip) els.sentinelModeChip.textContent = label;
if (els.heroSentinelModeValue) els.heroSentinelModeValue.textContent = label;
if (els.sentinelCurrentModeValue) els.sentinelCurrentModeValue.textContent = label;

const modeButtons = [
{ el: els.sentinelModePaperButton, mode: "paper", base: "button-secondary" },
{ el: els.sentinelModeArmedButton, mode: "armed_mainnet", base: "button-secondary" },
{ el: els.sentinelModeLiveButton, mode: "live_mainnet", base: "button-secondary" },
{ el: els.sentinelEmergencyStopButton, mode: "emergency_stop", base: "button-danger" },
];

modeButtons.forEach(({ el, mode: buttonMode, base }) => {
if (!el) return;
if (buttonMode === mode && buttonMode !== "emergency_stop") {
el.className = "button button-primary";
} else if (buttonMode === mode && buttonMode === "emergency_stop") {
el.className = "button button-danger";
} else {
el.className = `button ${base}`;
}
});
}

function applySentinelSettingsToInputs(settings) {
if (!settings) return;

els.sentinelScoutUsdInput.value = safeNumber(settings.scout_usd, 0.5);
els.sentinelSniperAddUsdInput.value = safeNumber(settings.sniper_add_usd, 1);
els.sentinelMaxTotalPositionUsdInput.value = safeNumber(settings.max_total_position_usd, 1.5);
els.sentinelMaxOpenPositionsInput.value = safeNumber(settings.max_open_positions, 30);
els.sentinelMaxDailyLossUsdInput.value = safeNumber(settings.max_daily_loss_usd, 25);
els.sentinelMaxConsecutiveFailuresInput.value = safeNumber(
settings.max_consecutive_failures,
8
);
els.sentinelMaxDailyScoutSpendUsdInput.value = safeNumber(
settings.max_daily_scout_spend_usd,
20
);
els.sentinelMaxDailySniperSpendUsdInput.value = safeNumber(
settings.max_daily_sniper_spend_usd,
30
);
els.sentinelAutoBankMultipleInput.value = safeNumber(settings.auto_bank_multiple, 10);
els.sentinelAutoBankFractionInput.value = safeNumber(settings.auto_bank_fraction, 0.5);
els.sentinelMinOperatorQualityScoreInput.value = safeNumber(
settings.min_operator_quality_score,
70
);
els.sentinelMaxHiddenControlRiskInput.value = safeNumber(
settings.max_hidden_control_risk,
30
);
els.sentinelMinRegimeScoreScoutInput.value = safeNumber(
settings.min_regime_score_for_scout,
55
);
els.sentinelMinRegimeScoreSniperInput.value = safeNumber(
settings.min_regime_score_for_sniper,
65
);
els.sentinelMinReclaimStrengthScoreInput.value = safeNumber(
settings.min_reclaim_strength_score,
60
);
els.sentinelMinBuyPressureScoreInput.value = safeNumber(
settings.min_buy_pressure_score,
62
);
els.sentinelMinPersistenceScoreInput.value = safeNumber(
settings.min_persistence_score,
58
);
els.sentinelMinPostEntryHealthScoreInput.value = safeNumber(
settings.min_post_entry_health_score,
55
);

els.sentinelWatcherEnabledInput.value = String(Boolean(settings.watcher_enabled));
els.sentinelAutoBankEnabledInput.value = String(Boolean(settings.auto_bank_enabled));
els.sentinelEnableScoutInput.value = String(Boolean(settings.enable_scout));
els.sentinelEnableSniperInput.value = String(Boolean(settings.enable_sniper));
els.sentinelEnableRunnerManagementInput.value = String(
Boolean(settings.enable_runner_management)
);
els.sentinelRiskOffDisableNewEntriesInput.value = String(
Boolean(settings.risk_off_disable_new_entries)
);

if (els.sentinelWatcherEnabledValue) {
els.sentinelWatcherEnabledValue.textContent = settings.watcher_enabled ? "Yes" : "No";
}
if (els.sentinelKillSwitchValue) {
els.sentinelKillSwitchValue.textContent =
cleanText(settings.execution_mode, 64) === "emergency_stop" ? "Active" : "Inactive";
}

applySentinelModeToUi(settings.execution_mode || "paper");
}

function renderSentinelSummary(summary) {
state.sentinel.summary = summary || null;

const openPositions = safeNumber(summary?.open_positions, 0);
const realized = safeNumber(summary?.daily_realized_pnl_usd, 0);
const unrealized = safeNumber(summary?.daily_unrealized_pnl_usd, 0);
const dailyLoss = safeNumber(summary?.daily_loss_usd, 0);

if (els.sentinelOpenPositionsHeroValue) {
els.sentinelOpenPositionsHeroValue.textContent = formatNumber(openPositions);
}

if (els.sentinelSummaryOpenPositions) {
els.sentinelSummaryOpenPositions.textContent = formatNumber(openPositions);
}
if (els.sentinelSummaryDailyRealizedPnl) {
els.sentinelSummaryDailyRealizedPnl.textContent = formatCurrency(realized);
}
if (els.sentinelSummaryDailyUnrealizedPnl) {
els.sentinelSummaryDailyUnrealizedPnl.textContent = formatCurrency(unrealized);
}
if (els.sentinelSummaryDailyLoss) {
els.sentinelSummaryDailyLoss.textContent = formatCurrency(dailyLoss);
}

if (summary?.execution_mode) {
applySentinelModeToUi(summary.execution_mode);
}

if (els.sentinelKillSwitchValue) {
els.sentinelKillSwitchValue.textContent = summary?.kill_switch_active ? "Active" : "Inactive";
}
}

function renderSentinelStats(stats) {
state.sentinel.stats = stats || null;

if (els.sentinelStatsScoutsOpened) {
els.sentinelStatsScoutsOpened.textContent = formatNumber(stats?.scouts_opened, 0);
}
if (els.sentinelStatsSniperAdds) {
els.sentinelStatsSniperAdds.textContent = formatNumber(stats?.sniper_adds, 0);
}
if (els.sentinelStatsPositionsClosed) {
els.sentinelStatsPositionsClosed.textContent = formatNumber(stats?.positions_closed, 0);
}
if (els.sentinelStatsInvalidations) {
els.sentinelStatsInvalidations.textContent = formatNumber(stats?.invalidations, 0);
}
if (els.sentinelStatsConsecutiveFailures) {
els.sentinelStatsConsecutiveFailures.textContent = formatNumber(
stats?.consecutive_failures,
0
);
}
if (els.sentinelStatsReclaimSuccessRate) {
els.sentinelStatsReclaimSuccessRate.textContent = formatPercent(
stats?.reclaim_success_rate_pct,
1
);
}
if (els.sentinelStatsRecentRugRate) {
els.sentinelStatsRecentRugRate.textContent = formatPercent(stats?.recent_rug_rate_pct, 1);
}
if (els.sentinelStatsAvgMarketLiquidity) {
els.sentinelStatsAvgMarketLiquidity.textContent = formatCurrency(
stats?.avg_market_liquidity_usd
);
}
}

function renderSentinelPositions() {
const tbody = els.sentinelPositionsTableBody;
if (!tbody) return;

tbody.innerHTML = "";
if (!state.sentinel.positions.length) {
renderTableEmpty(
tbody,
9,
"No Sentinel positions found for the current filter set."
);
return;
}

state.sentinel.positions.forEach((position) => {
const row = document.createElement("tr");

const tokenCell = document.createElement("td");
tokenCell.innerHTML = `
<div style="font-weight:700;">${cleanText(position.token_id, 120) || "—"}</div>
<div class="dim mono">${shortenWallet(position.mint_address)}</div>
`;

const stageCell = document.createElement("td");
stageCell.appendChild(
createPill(titleCase(position.stage || "unknown"), getSentinelStageVariant(position.stage))
);

const modeCell = document.createElement("td");
modeCell.appendChild(
createPill(titleCase(position.execution_mode || "paper"), getSentinelModeVariant(position.execution_mode))
);

const costCell = document.createElement("td");
costCell.textContent = formatCurrency(position.total_cost_usd);

const currentCell = document.createElement("td");
currentCell.textContent = formatCurrency(position.current_value_usd);

const realizedCell = document.createElement("td");
realizedCell.textContent = formatCurrency(position.realized_pnl_usd);

const unrealizedCell = document.createElement("td");
unrealizedCell.textContent = formatCurrency(position.unrealized_pnl_usd);

const bankedCell = document.createElement("td");
bankedCell.appendChild(
createPill(position.has_banked_10x ? "Yes" : "No", position.has_banked_10x ? "good" : "neutral")
);

const openedCell = document.createElement("td");
openedCell.innerHTML = `
<div>${formatDateTime(position.opened_at)}</div>
<div class="dim">${position.closed_at ? `Closed ${formatDateTime(position.closed_at)}` : ""}</div>
`;

[
tokenCell,
stageCell,
modeCell,
costCell,
currentCell,
realizedCell,
unrealizedCell,
bankedCell,
openedCell,
].forEach((cell) => row.appendChild(cell));

tbody.appendChild(row);
});
}

function renderSentinelAudit() {
const tbody = els.sentinelAuditTableBody;
if (!tbody) return;

tbody.innerHTML = "";
if (!state.sentinel.audit.length) {
renderTableEmpty(tbody, 7, "No Sentinel audit events found for the current filter set.");
return;
}

state.sentinel.audit.forEach((event) => {
const row = document.createElement("tr");

const reasons = Array.isArray(event.reason_codes) ? event.reason_codes : [];
const reasonText = reasons.length ? reasons.join(" • ") : "—";

const timeCell = document.createElement("td");
timeCell.innerHTML = `
<div>${formatDateTime(event.created_at)}</div>
<div class="dim">${event.actor_type || "system"}</div>
`;

const eventCell = document.createElement("td");
eventCell.innerHTML = `
<div style="font-weight:700;">${titleCase(event.event_type || "event")}</div>
<div class="dim">${event.position_id ? `Position #${event.position_id}` : ""}</div>
`;

const decisionCell = document.createElement("td");
decisionCell.textContent = titleCase(event.decision || "—");

const modeCell = document.createElement("td");
modeCell.appendChild(
createPill(titleCase(event.execution_mode || "—"), getSentinelModeVariant(event.execution_mode))
);

const tokenCell = document.createElement("td");
tokenCell.innerHTML = `
<div>${cleanText(event.token_id, 120) || "—"}</div>
<div class="dim mono">${event.mint_address ? shortenWallet(event.mint_address) : "—"}</div>
`;

const reasonsCell = document.createElement("td");
reasonsCell.textContent = cleanText(reasonText, 300);

const statusCell = document.createElement("td");
statusCell.appendChild(
createPill(
titleCase(event.execution_status || "unknown"),
getExecutionStatusVariant(event.execution_status)
)
);

[timeCell, eventCell, decisionCell, modeCell, tokenCell, reasonsCell, statusCell].forEach(
(cell) => row.appendChild(cell)
);

tbody.appendChild(row);
});
}

function renderCasesTable() {
const tbody = els.casesTableBody;
if (!tbody) return;

tbody.innerHTML = "";

if (!state.cases.length) {
renderTableEmpty(
tbody,
7,
"No compliance cases found for the current filter set."
);
return;
}

state.cases.forEach((item) => {
const row = document.createElement("tr");
if (Number(item.id) === Number(state.selectedCaseId)) {
row.classList.add("active");
}

const caseType = cleanText(item.case_type, 40) || "case";
const status = cleanText(item.status, 40) || "unknown";
const riskLevel = cleanText(item.risk_level, 40) || "low";
const wallet = cleanText(item.profile?.wallet_address, 200);
const launchName = cleanText(item.launch?.token_name, 120) || "—";
const launchSymbol = cleanText(item.launch?.symbol, 40);

const caseCell = document.createElement("td");
caseCell.innerHTML = `
<div style="font-weight:700;">#${item.id}</div>
<div class="dim">${caseType}</div>
`;

const statusCell = document.createElement("td");
statusCell.appendChild(createPill(status, getStatusVariant(status)));

const riskCell = document.createElement("td");
riskCell.appendChild(createPill(riskLevel, getRiskVariant(riskLevel)));

const walletCell = document.createElement("td");
walletCell.innerHTML = `
<div class="mono">${wallet ? shortenWallet(wallet) : "—"}</div>
<div class="dim">
${
cleanText(
item.profile?.entity_name || item.profile?.display_name || item.profile?.legal_name,
120
) || "No profile name"
}
</div>
`;

const launchCell = document.createElement("td");
launchCell.innerHTML = `
<div>${launchName}</div>
<div class="dim">${launchSymbol || "—"}</div>
`;

const assignedCell = document.createElement("td");
assignedCell.innerHTML = `
<div>${cleanText(item.assigned_to, 120) || "Unassigned"}</div>
<div class="dim">${cleanText(item.approved_by, 120) || ""}</div>
`;

const updatedCell = document.createElement("td");
updatedCell.innerHTML = `
<div>${formatDateTime(item.updated_at || item.created_at)}</div>
<div class="dim">${formatDateTime(item.created_at)}</div>
`;

[caseCell, statusCell, riskCell, walletCell, launchCell, assignedCell, updatedCell].forEach(
(cell) => row.appendChild(cell)
);

row.addEventListener("click", async () => {
await loadCaseDetail(item.id);
});

tbody.appendChild(row);
});
}

function renderCaseDetail(item) {
if (!item) {
if (els.caseDetailEmpty) els.caseDetailEmpty.style.display = "grid";
if (els.caseDetailPanel) els.caseDetailPanel.style.display = "none";
return;
}

if (els.caseDetailEmpty) els.caseDetailEmpty.style.display = "none";
if (els.caseDetailPanel) els.caseDetailPanel.style.display = "grid";

els.detailCaseId.textContent = `#${item.id}`;
els.detailCaseType.textContent = cleanText(item.case_type, 40) || "—";
els.detailStatus.textContent = cleanText(item.status, 40) || "—";
els.detailRisk.textContent = `${cleanText(item.risk_level, 40) || "low"} / ${Number(item.risk_score || 0)}`;

els.detailReviewReason.textContent = cleanText(item.review_reason, 5000) || "—";

els.detailWallet.textContent = cleanText(item.profile?.wallet_address, 200) || "—";
els.detailProfileType.textContent = cleanText(item.profile?.profile_type, 40) || "—";
els.detailProfileStatus.textContent = cleanText(item.profile?.status, 40) || "—";
els.detailProfileRisk.textContent = cleanText(item.profile?.risk_rating, 40) || "—";
els.detailCountry.textContent = cleanText(item.profile?.country_code, 20) || "—";
els.detailManualReview.textContent = item.profile?.manual_review_required
? cleanText(item.profile?.manual_review_reason, 500) || "Required"
: "No";

const profileName =
cleanText(item.profile?.entity_name, 200) ||
cleanText(item.profile?.display_name, 200) ||
cleanText(item.profile?.legal_name, 200) ||
"—";
els.detailProfileName.textContent = profileName;

const launchName = cleanText(item.launch?.token_name, 200);
const symbol = cleanText(item.launch?.symbol, 40);
els.detailLaunchName.textContent = launchName
? `${launchName}${symbol ? ` (${symbol})` : ""}`
: "—";

els.detailLaunchStatus.textContent = cleanText(item.launch?.status, 80) || "—";
els.detailLaunchTemplate.textContent = cleanText(item.launch?.template, 80) || "—";
els.detailBuilderWallet.textContent = cleanText(item.launch?.builder_wallet, 200) || "—";

els.assignedToInput.value = cleanText(item.assigned_to, 120);
els.actionNotes.value = "";
els.escalationRiskLevel.value =
cleanText(item.risk_level, 32).toLowerCase() || "high";
}

function buildCaseQueryString() {
const params = new URLSearchParams();

if (state.filters.status) params.set("status", state.filters.status);
if (state.filters.caseType) params.set("case_type", state.filters.caseType);
if (state.filters.riskLevel) params.set("risk_level", state.filters.riskLevel);
if (state.filters.assignedTo) params.set("assigned_to", state.filters.assignedTo);

return params.toString();
}

async function loadCases() {
beginCasesLoading();
try {
const queryString = buildCaseQueryString();
const payload = await apiFetch(
`/api/compliance-admin/cases${queryString ? `?${queryString}` : ""}`
);

state.cases = Array.isArray(payload?.cases) ? payload.cases : [];

if (state.selectedCaseId) {
const stillExists = state.cases.some(
(item) => Number(item.id) === Number(state.selectedCaseId)
);
if (!stillExists) {
state.selectedCaseId = null;
state.selectedCase = null;
}
}

renderCasesTable();
updateComplianceSummary();

if (state.selectedCaseId) {
const selected = getSelectedCase();
if (selected) {
await loadCaseDetail(selected.id, { quiet: true, manageLoading: false });
} else {
renderCaseDetail(null);
}
} else {
renderCaseDetail(null);
}

clearCaseBanner();
} catch (error) {
setCaseBanner(error?.message || "Failed to load compliance cases.", "bad");
} finally {
endCasesLoading();
}
}

async function loadCaseDetail(caseId, { quiet = false, manageLoading = true } = {}) {
if (!caseId) return;

if (manageLoading) beginCasesLoading();
try {
const payload = await apiFetch(`/api/compliance-admin/cases/${encodeURIComponent(caseId)}`);
const item = payload?.case || null;

if (!item) {
throw new Error("Case detail was empty.");
}

state.selectedCaseId = Number(caseId);
state.selectedCase = item;

renderCasesTable();
renderCaseDetail(item);
updateComplianceSummary();

if (!quiet) clearCaseBanner();
} catch (error) {
if (!quiet) {
setCaseBanner(error?.message || "Failed to load case detail.", "bad");
}
} finally {
if (manageLoading) endCasesLoading();
}
}

function syncCaseFiltersFromInputs() {
state.filters.status = cleanText(els.filterStatus?.value, 32).toLowerCase();
state.filters.caseType = cleanText(els.filterCaseType?.value, 32).toLowerCase();
state.filters.riskLevel = cleanText(els.filterRiskLevel?.value, 32).toLowerCase();
state.filters.assignedTo = cleanText(els.filterAssignedTo?.value, 120);
}

function getActionNotes() {
return cleanText(els.actionNotes?.value, 2000);
}

function getActorId() {
return "admin";
}

async function postCaseAction(path, body = {}, successMessage = "Action completed.") {
if (!state.selectedCaseId) {
setCaseBanner("Select a compliance case first.", "warn");
return;
}

beginCasesLoading();
try {
await apiFetch(
`/api/compliance-admin/cases/${encodeURIComponent(state.selectedCaseId)}${path}`,
{
method: "POST",
body: JSON.stringify(body),
}
);

await loadCases();
await loadCaseDetail(state.selectedCaseId, { quiet: true, manageLoading: false });
setCaseBanner(successMessage, "good");
} catch (error) {
setCaseBanner(error?.message || "Case action failed.", "bad");
} finally {
endCasesLoading();
}
}

async function loadSentinelSettings({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelLoading();
try {
const payload = await apiFetch(`/api/compliance-admin/sentinel/settings`);
const settings = payload?.settings || null;
state.sentinel.settings = settings;
applySentinelSettingsToInputs(settings);
return settings;
} finally {
if (manageLoading) endSentinelLoading();
}
}

async function loadSentinelSummary({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelLoading();
try {
const payload = await apiFetch(`/api/compliance-admin/sentinel/summary`);
renderSentinelSummary(payload?.summary || null);
return payload?.summary || null;
} finally {
if (manageLoading) endSentinelLoading();
}
}

function buildSentinelStatsQueryString() {
const params = new URLSearchParams();
if (state.sentinel.filters.statsDate) params.set("date", state.sentinel.filters.statsDate);
if (state.sentinel.filters.statsMode) params.set("mode", state.sentinel.filters.statsMode);
return params.toString();
}

async function loadSentinelStats({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelLoading();
try {
const queryString = buildSentinelStatsQueryString();
const payload = await apiFetch(
`/api/compliance-admin/sentinel/stats/daily${queryString ? `?${queryString}` : ""}`
);
renderSentinelStats(payload?.stats || null);
return payload?.stats || null;
} finally {
if (manageLoading) endSentinelLoading();
}
}

function buildSentinelPositionsQueryString() {
const params = new URLSearchParams();
if (state.sentinel.filters.positionStage) {
params.set("stage", state.sentinel.filters.positionStage);
}
if (state.sentinel.filters.positionMode) {
params.set("mode", state.sentinel.filters.positionMode);
}
if (state.sentinel.filters.positionTokenId) {
params.set("token_id", state.sentinel.filters.positionTokenId);
}
params.set("limit", "100");
return params.toString();
}

async function loadSentinelPositions({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelLoading();
try {
const queryString = buildSentinelPositionsQueryString();
const payload = await apiFetch(
`/api/compliance-admin/sentinel/positions${queryString ? `?${queryString}` : ""}`
);
state.sentinel.positions = Array.isArray(payload?.positions) ? payload.positions : [];
renderSentinelPositions();
return state.sentinel.positions;
} finally {
if (manageLoading) endSentinelLoading();
}
}

function buildSentinelAuditQueryString() {
const params = new URLSearchParams();
if (state.sentinel.filters.auditEventType) {
params.set("event_type", state.sentinel.filters.auditEventType);
}
if (state.sentinel.filters.auditDecision) {
params.set("decision", state.sentinel.filters.auditDecision);
}
if (state.sentinel.filters.auditTokenId) {
params.set("token_id", state.sentinel.filters.auditTokenId);
}
params.set("limit", "100");
return params.toString();
}

async function loadSentinelAudit({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelLoading();
try {
const queryString = buildSentinelAuditQueryString();
const payload = await apiFetch(
`/api/compliance-admin/sentinel/audit${queryString ? `?${queryString}` : ""}`
);
state.sentinel.audit = Array.isArray(payload?.audit) ? payload.audit : [];
renderSentinelAudit();
return state.sentinel.audit;
} finally {
if (manageLoading) endSentinelLoading();
}
}

function syncSentinelFiltersFromInputs() {
state.sentinel.filters.statsDate = cleanText(
els.sentinelStatsDateInput?.value,
32
) || new Date().toISOString().slice(0, 10);
state.sentinel.filters.statsMode = cleanText(
els.sentinelStatsModeFilter?.value,
64
) || "paper";

state.sentinel.filters.positionStage = cleanText(
els.sentinelPositionStageFilter?.value,
64
);
state.sentinel.filters.positionMode = cleanText(
els.sentinelPositionsModeFilter?.value,
64
);
state.sentinel.filters.positionTokenId = cleanText(
els.sentinelPositionsTokenFilter?.value,
255
);

state.sentinel.filters.auditEventType = cleanText(
els.sentinelAuditEventTypeFilter?.value,
64
);
state.sentinel.filters.auditDecision = cleanText(
els.sentinelAuditDecisionFilter?.value,
64
);
state.sentinel.filters.auditTokenId = cleanText(
els.sentinelAuditTokenFilter?.value,
255
);
}

async function loadSentinelBundle({ showSuccess = false } = {}) {
beginSentinelLoading();
try {
syncSentinelFiltersFromInputs();

const results = await Promise.allSettled([
loadSentinelSettings({ manageLoading: false }),
loadSentinelSummary({ manageLoading: false }),
loadSentinelStats({ manageLoading: false }),
loadSentinelPositions({ manageLoading: false }),
loadSentinelAudit({ manageLoading: false }),
]);

const failures = results.filter((result) => result.status === "rejected");
if (failures.length) {
const firstError = failures[0]?.reason;
setSentinelBanner(
firstError?.message || "One or more Sentinel admin requests failed.",
"bad"
);
return;
}

clearSentinelBanner();
if (showSuccess) {
setSentinelBanner("Sentinel data refreshed.", "good");
}
} catch (error) {
setSentinelBanner(error?.message || "Failed to load Sentinel data.", "bad");
} finally {
endSentinelLoading();
}
}

function getRequiredNumber(inputEl, label, options = {}) {
const raw = cleanText(inputEl?.value, 120);
const value = Number(raw);
if (!raw.length || !Number.isFinite(value)) {
throw new Error(`${label} must be a valid number.`);
}
if (options.min != null && value < options.min) {
throw new Error(`${label} must be at least ${options.min}.`);
}
if (options.max != null && value > options.max) {
throw new Error(`${label} must be no more than ${options.max}.`);
}
return value;
}

function buildSentinelSettingsPayload() {
return {
actor_id: getActorId(),

watcher_enabled: parseBool(els.sentinelWatcherEnabledInput?.value, true),
auto_bank_enabled: parseBool(els.sentinelAutoBankEnabledInput?.value, true),

scout_usd: getRequiredNumber(els.sentinelScoutUsdInput, "Scout USD", { min: 0.01 }),
sniper_add_usd: getRequiredNumber(els.sentinelSniperAddUsdInput, "Sniper Add USD", {
min: 0.01,
}),
max_total_position_usd: getRequiredNumber(
els.sentinelMaxTotalPositionUsdInput,
"Max Total Position USD",
{ min: 0.01 }
),
max_open_positions: getRequiredNumber(
els.sentinelMaxOpenPositionsInput,
"Max Open Positions",
{ min: 1 }
),
max_daily_loss_usd: getRequiredNumber(
els.sentinelMaxDailyLossUsdInput,
"Max Daily Loss USD",
{ min: 0 }
),
max_consecutive_failures: getRequiredNumber(
els.sentinelMaxConsecutiveFailuresInput,
"Max Consecutive Failures",
{ min: 0 }
),
max_daily_scout_spend_usd: getRequiredNumber(
els.sentinelMaxDailyScoutSpendUsdInput,
"Max Daily Scout Spend USD",
{ min: 0 }
),
max_daily_sniper_spend_usd: getRequiredNumber(
els.sentinelMaxDailySniperSpendUsdInput,
"Max Daily Sniper Spend USD",
{ min: 0 }
),

auto_bank_multiple: getRequiredNumber(
els.sentinelAutoBankMultipleInput,
"Auto-Bank Multiple",
{ min: 1 }
),
auto_bank_fraction: getRequiredNumber(
els.sentinelAutoBankFractionInput,
"Auto-Bank Fraction",
{ min: 0.01, max: 1 }
),

min_operator_quality_score: getRequiredNumber(
els.sentinelMinOperatorQualityScoreInput,
"Min Operator Quality Score",
{ min: 0, max: 100 }
),
max_hidden_control_risk: getRequiredNumber(
els.sentinelMaxHiddenControlRiskInput,
"Max Hidden Control Risk",
{ min: 0, max: 100 }
),
min_regime_score_for_scout: getRequiredNumber(
els.sentinelMinRegimeScoreScoutInput,
"Min Regime Score For Scout",
{ min: 0, max: 100 }
),
min_regime_score_for_sniper: getRequiredNumber(
els.sentinelMinRegimeScoreSniperInput,
"Min Regime Score For Sniper",
{ min: 0, max: 100 }
),
min_reclaim_strength_score: getRequiredNumber(
els.sentinelMinReclaimStrengthScoreInput,
"Min Reclaim Strength Score",
{ min: 0, max: 100 }
),
min_buy_pressure_score: getRequiredNumber(
els.sentinelMinBuyPressureScoreInput,
"Min Buy Pressure Score",
{ min: 0, max: 100 }
),
min_persistence_score: getRequiredNumber(
els.sentinelMinPersistenceScoreInput,
"Min Persistence Score",
{ min: 0, max: 100 }
),
min_post_entry_health_score: getRequiredNumber(
els.sentinelMinPostEntryHealthScoreInput,
"Min Post-Entry Health Score",
{ min: 0, max: 100 }
),

enable_scout: parseBool(els.sentinelEnableScoutInput?.value, true),
enable_sniper: parseBool(els.sentinelEnableSniperInput?.value, true),
enable_runner_management: parseBool(
els.sentinelEnableRunnerManagementInput?.value,
true
),
risk_off_disable_new_entries: parseBool(
els.sentinelRiskOffDisableNewEntriesInput?.value,
true
),
};
}

async function saveSentinelSettings() {
beginSentinelLoading();
try {
const body = buildSentinelSettingsPayload();
const payload = await apiFetch(`/api/compliance-admin/sentinel/settings`, {
method: "PATCH",
body: JSON.stringify(body),
});

const settings = payload?.settings || null;
state.sentinel.settings = settings;
applySentinelSettingsToInputs(settings);
setSentinelBanner("Sentinel settings saved.", "good");
} catch (error) {
setSentinelBanner(error?.message || "Failed to save Sentinel settings.", "bad");
} finally {
endSentinelLoading();
}
}

async function changeSentinelMode(mode) {
const requestedMode = cleanText(mode, 64).toLowerCase();
const reason = cleanText(els.sentinelModeReasonInput?.value, 500);

if (!requestedMode) {
setSentinelBanner("A Sentinel mode is required.", "warn");
return;
}

let confirmed = true;

if (requestedMode === "armed_mainnet") {
confirmed = window.confirm(
"Switch Sentinel Watcher into Armed Mainnet mode? This should only be done when controlled live arming is intended."
);
} else if (requestedMode === "live_mainnet") {
confirmed = window.confirm(
"Switch Sentinel Watcher into Live Mainnet mode? This enables live execution once backend execution routing is active."
);
} else if (requestedMode === "emergency_stop") {
confirmed = window.confirm(
"Activate Sentinel Emergency Stop? This should immediately stop new entries."
);
}

if (!confirmed) return;

beginSentinelLoading();
try {
const payload =
requestedMode === "emergency_stop"
? await apiFetch(`/api/compliance-admin/sentinel/emergency-stop`, {
method: "POST",
body: JSON.stringify({
enabled: true,
reason,
actor_id: getActorId(),
}),
})
: await apiFetch(`/api/compliance-admin/sentinel/mode`, {
method: "POST",
body: JSON.stringify({
execution_mode: requestedMode,
reason,
actor_id: getActorId(),
confirm_live:
requestedMode === "armed_mainnet" || requestedMode === "live_mainnet",
}),
});

const currentMode = cleanText(payload?.current_mode, 64) || requestedMode;
if (els.sentinelStatsModeFilter) {
els.sentinelStatsModeFilter.value = currentMode;
}

syncSentinelFiltersFromInputs();
await Promise.all([
loadSentinelSettings({ manageLoading: false }),
loadSentinelSummary({ manageLoading: false }),
loadSentinelStats({ manageLoading: false }),
loadSentinelAudit({ manageLoading: false }),
]);

setSentinelBanner(`Sentinel mode switched to ${titleCase(currentMode)}.`, "good");
} catch (error) {
setSentinelBanner(error?.message || "Failed to change Sentinel mode.", "bad");
} finally {
endSentinelLoading();
}
}

function bindCaseActions() {
els.applyFiltersButton?.addEventListener("click", async () => {
syncCaseFiltersFromInputs();
await loadCases();
});

els.refreshCasesButton?.addEventListener("click", async () => {
await loadCases();
});

els.approveCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/approve",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case approved."
);
});

els.rejectCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/reject",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case rejected."
);
});

els.freezeCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/freeze",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case frozen."
);
});

els.escalateCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/escalate",
{
actor_id: getActorId(),
notes: getActionNotes(),
risk_level: cleanText(els.escalationRiskLevel?.value, 32).toLowerCase() || "high",
},
"Compliance case escalated."
);
});

els.assignCaseButton?.addEventListener("click", async () => {
const assignedTo = cleanText(els.assignedToInput?.value, 120);
if (!assignedTo) {
setCaseBanner("Enter an assignee before assigning the case.", "warn");
return;
}

await postCaseAction(
"/assign",
{
actor_id: getActorId(),
assigned_to: assignedTo,
},
"Compliance case assigned."
);
});
}

function bindSentinelActions() {
els.refreshSentinelButton?.addEventListener("click", async () => {
syncSentinelFiltersFromInputs();
await loadSentinelBundle({ showSuccess: true });
});

els.saveSentinelSettingsButton?.addEventListener("click", async () => {
await saveSentinelSettings();
});

els.sentinelModePaperButton?.addEventListener("click", async () => {
await changeSentinelMode("paper");
});

els.sentinelModeArmedButton?.addEventListener("click", async () => {
await changeSentinelMode("armed_mainnet");
});

els.sentinelModeLiveButton?.addEventListener("click", async () => {
await changeSentinelMode("live_mainnet");
});

els.sentinelEmergencyStopButton?.addEventListener("click", async () => {
await changeSentinelMode("emergency_stop");
});

els.refreshSentinelStatsButton?.addEventListener("click", async () => {
beginSentinelLoading();
try {
syncSentinelFiltersFromInputs();
await loadSentinelStats({ manageLoading: false });
clearSentinelBanner();
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel stats.", "bad");
} finally {
endSentinelLoading();
}
});

els.refreshSentinelPositionsButton?.addEventListener("click", async () => {
beginSentinelLoading();
try {
syncSentinelFiltersFromInputs();
await loadSentinelPositions({ manageLoading: false });
clearSentinelBanner();
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel positions.", "bad");
} finally {
endSentinelLoading();
}
});

els.refreshSentinelAuditButton?.addEventListener("click", async () => {
beginSentinelLoading();
try {
syncSentinelFiltersFromInputs();
await loadSentinelAudit({ manageLoading: false });
clearSentinelBanner();
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel audit.", "bad");
} finally {
endSentinelLoading();
}
});
}

function initDefaults() {
if (els.sentinelStatsDateInput) {
els.sentinelStatsDateInput.value = state.sentinel.filters.statsDate;
}
if (els.sentinelStatsModeFilter) {
els.sentinelStatsModeFilter.value = state.sentinel.filters.statsMode;
}
if (els.sentinelPositionStageFilter) {
els.sentinelPositionStageFilter.value = state.sentinel.filters.positionStage;
}
}

async function init() {
initDefaults();
bindCaseActions();
bindSentinelActions();

syncCaseFiltersFromInputs();
syncSentinelFiltersFromInputs();

await Promise.all([
loadCases(),
loadSentinelBundle(),
]);
}

init().catch((error) => {
console.error("Failed to initialize compliance admin page", error);
setCaseBanner(error?.message || "Failed to initialize compliance admin page.", "bad");
setSentinelBanner(error?.message || "Failed to initialize Sentinel admin.", "bad");
});