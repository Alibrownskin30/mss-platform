const todayIso = new Date().toISOString().slice(0, 10)

const state = {
sentinel: {
status: null,
settings: null,
engine: null,
summary: null,
stats: null,
positions: [],
audit: [],
adminAudit: [],
filters: {
summaryPeriod: "daily",
summaryDate: todayIso,
statsDate: todayIso,
statsMode: "paper",

positionScope: "open",
positionStage: "",
positionOutcome: "",
positionMode: "",
positionTokenId: "",
positionMintAddress: "",
positionSort: "pnl_desc",

auditEventType: "",
auditDecision: "",
auditExecutionStatus: "",
auditMode: "",
auditTokenId: "",
auditMintAddress: "",
auditActorType: "",
auditActorId: "",
auditReasonCode: "",

adminAuditAction: "",
adminAuditActorId: "",
adminAuditTargetType: "",
},
},

loadingCount: 0,
}

const els = {
apiStatusChip: document.getElementById("apiStatusChip"),
sentinelModeChip: document.getElementById("sentinelModeChip"),
heroSentinelModeValue: document.getElementById("heroSentinelModeValue"),

sentinelBanner: document.getElementById("sentinelBanner"),

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

sentinelSummaryPeriodFilter: document.getElementById("sentinelSummaryPeriodFilter"),
sentinelSummaryDateInput: document.getElementById("sentinelSummaryDateInput"),
refreshSentinelSummaryButton: document.getElementById("refreshSentinelSummaryButton"),
sentinelSummaryPeriodLabel: document.getElementById("sentinelSummaryPeriodLabel"),
sentinelSummaryPeriodRange: document.getElementById("sentinelSummaryPeriodRange"),

sentinelSummaryOpenPositions: document.getElementById("sentinelSummaryOpenPositions"),
sentinelSummaryDailyRealizedPnl: document.getElementById("sentinelSummaryDailyRealizedPnl"),
sentinelSummaryDailyUnrealizedPnl: document.getElementById("sentinelSummaryDailyUnrealizedPnl"),
sentinelSummaryDailyLoss: document.getElementById("sentinelSummaryDailyLoss"),
sentinelSummaryOpenCapital: document.getElementById("sentinelSummaryOpenCapital"),
sentinelSummaryOpenValue: document.getElementById("sentinelSummaryOpenValue"),
sentinelSummaryTotalCapital: document.getElementById("sentinelSummaryTotalCapital"),
sentinelSummaryPortfolioPnl: document.getElementById("sentinelSummaryPortfolioPnl"),

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
sentinelRiskOffDisableNewEntriesInput: document.getElementById("sentinelRiskOffDisableNewEntriesInput"),

sentinelMaxPositionsPerOperatorClusterInput: document.getElementById(
"sentinelMaxPositionsPerOperatorClusterInput"
),
sentinelMaxTokensPerHourInput: document.getElementById("sentinelMaxTokensPerHourInput"),
sentinelCooldownAfterCloseSecInput: document.getElementById("sentinelCooldownAfterCloseSecInput"),
sentinelCooldownAfterInvalidationSecInput: document.getElementById(
"sentinelCooldownAfterInvalidationSecInput"
),
sentinelEarlyFailTimeoutSecInput: document.getElementById("sentinelEarlyFailTimeoutSecInput"),
sentinelWeakStallTimeoutSecInput: document.getElementById("sentinelWeakStallTimeoutSecInput"),
sentinelRunnerFailedBreakoutLimitInput: document.getElementById(
"sentinelRunnerFailedBreakoutLimitInput"
),
sentinelMaxContaminationRiskInput: document.getElementById("sentinelMaxContaminationRiskInput"),
sentinelMaxWalletCoordinationRiskInput: document.getElementById(
"sentinelMaxWalletCoordinationRiskInput"
),
sentinelMaxTopHolderPctInput: document.getElementById("sentinelMaxTopHolderPctInput"),
sentinelMaxTop5HolderPctInput: document.getElementById("sentinelMaxTop5HolderPctInput"),
sentinelMinLiquidityUsdInput: document.getElementById("sentinelMinLiquidityUsdInput"),
sentinelMaxSpreadBpsInput: document.getElementById("sentinelMaxSpreadBpsInput"),
sentinelMaxPriceImpactBpsInput: document.getElementById("sentinelMaxPriceImpactBpsInput"),
sentinelMaxVerticalExtensionScoreForAddInput: document.getElementById(
"sentinelMaxVerticalExtensionScoreForAddInput"
),
sentinelMaxInsiderSellScoreInput: document.getElementById("sentinelMaxInsiderSellScoreInput"),
sentinelMaxLiquidityDecayScoreInput: document.getElementById("sentinelMaxLiquidityDecayScoreInput"),
sentinelEnableMarketRegimeFilterInput: document.getElementById(
"sentinelEnableMarketRegimeFilterInput"
),
sentinelEnableOperatorFilterInput: document.getElementById("sentinelEnableOperatorFilterInput"),
sentinelEnableHardRejectsInput: document.getElementById("sentinelEnableHardRejectsInput"),

sentinelEngineStartedValue: document.getElementById("sentinelEngineStartedValue"),
sentinelEngineRunningValue: document.getElementById("sentinelEngineRunningValue"),
sentinelLastTickStartedValue: document.getElementById("sentinelLastTickStartedValue"),
sentinelLastTickFinishedValue: document.getElementById("sentinelLastTickFinishedValue"),
sentinelLastErrorValue: document.getElementById("sentinelLastErrorValue"),
sentinelTickCountValue: document.getElementById("sentinelTickCountValue"),
sentinelSnapshotProviderValue: document.getElementById("sentinelSnapshotProviderValue"),
sentinelLastTickSummaryValue: document.getElementById("sentinelLastTickSummaryValue"),

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
sentinelStatsAvgMarketLiquidity: document.getElementById("sentinelStatsAvgMarketLiquidity"),

sentinelPositionScopeFilter: document.getElementById("sentinelPositionScopeFilter"),
sentinelPositionStageFilter: document.getElementById("sentinelPositionStageFilter"),
sentinelPositionOutcomeFilter: document.getElementById("sentinelPositionOutcomeFilter"),
sentinelPositionsModeFilter: document.getElementById("sentinelPositionsModeFilter"),
sentinelPositionsTokenFilter: document.getElementById("sentinelPositionsTokenFilter"),
sentinelPositionsMintFilter: document.getElementById("sentinelPositionsMintFilter"),
sentinelPositionSortFilter: document.getElementById("sentinelPositionSortFilter"),
refreshSentinelPositionsButton: document.getElementById("refreshSentinelPositionsButton"),
sentinelPositionsTableBody: document.getElementById("sentinelPositionsTableBody"),

sentinelAuditEventTypeFilter: document.getElementById("sentinelAuditEventTypeFilter"),
sentinelAuditDecisionFilter: document.getElementById("sentinelAuditDecisionFilter"),
sentinelAuditExecutionStatusFilter: document.getElementById("sentinelAuditExecutionStatusFilter"),
sentinelAuditModeFilter: document.getElementById("sentinelAuditModeFilter"),
sentinelAuditTokenFilter: document.getElementById("sentinelAuditTokenFilter"),
sentinelAuditMintFilter: document.getElementById("sentinelAuditMintFilter"),
sentinelAuditActorTypeFilter: document.getElementById("sentinelAuditActorTypeFilter"),
sentinelAuditActorIdFilter: document.getElementById("sentinelAuditActorIdFilter"),
sentinelAuditReasonCodeFilter: document.getElementById("sentinelAuditReasonCodeFilter"),
refreshSentinelAuditButton: document.getElementById("refreshSentinelAuditButton"),
sentinelAuditTableBody: document.getElementById("sentinelAuditTableBody"),

sentinelAdminAuditActionFilter: document.getElementById("sentinelAdminAuditActionFilter"),
sentinelAdminAuditActorFilter: document.getElementById("sentinelAdminAuditActorFilter"),
sentinelAdminAuditTargetTypeFilter: document.getElementById("sentinelAdminAuditTargetTypeFilter"),
refreshSentinelAdminAuditButton: document.getElementById("refreshSentinelAdminAuditButton"),
sentinelAdminAuditTableBody: document.getElementById("sentinelAdminAuditTableBody"),
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value

const normalized = cleanText(value, 16).toLowerCase()

if (["true", "1", "yes", "y", "enabled", "on"].includes(normalized)) return true
if (["false", "0", "no", "n", "disabled", "off"].includes(normalized)) return false

return fallback
}

function arrayify(value) {
return Array.isArray(value) ? value : []
}

function shortenWallet(wallet) {
const value = cleanText(wallet, 200)
if (!value) return "—"
if (value.length <= 14) return value
return `${value.slice(0, 6)}…${value.slice(-6)}`
}

function titleCase(value) {
return cleanText(value, 120)
.replace(/_/g, " ")
.replace(/-/g, " ")
.split(" ")
.filter(Boolean)
.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
.join(" ")
}

function formatDateTime(value) {
const date = new Date(value)
if (!value || Number.isNaN(date.getTime())) return "—"
return date.toLocaleString()
}

function formatCurrency(value) {
const num = Number(value)
if (!Number.isFinite(num)) return "$0.00"

return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
maximumFractionDigits: 2,
}).format(num)
}

function formatSignedCurrency(value) {
const num = Number(value)
if (!Number.isFinite(num)) return "$0.00"

const abs = Math.abs(num)
const formatted = new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
maximumFractionDigits: 2,
}).format(abs)

if (num > 0) return `+${formatted}`
if (num < 0) return `-${formatted}`
return formatted
}

function formatPercent(value, fractionDigits = 1) {
const num = Number(value)
if (!Number.isFinite(num)) return "0%"
return `${num.toFixed(fractionDigits)}%`
}

function formatSignedPercent(value, fractionDigits = 1) {
const num = Number(value)
if (!Number.isFinite(num)) return "0%"
const prefix = num > 0 ? "+" : ""
return `${prefix}${num.toFixed(fractionDigits)}%`
}

function formatNumber(value, fractionDigits = 0) {
const num = Number(value)
if (!Number.isFinite(num)) return "0"

return new Intl.NumberFormat(undefined, {
maximumFractionDigits: fractionDigits,
minimumFractionDigits: fractionDigits,
}).format(num)
}

function safeNumber(value, fallback = 0) {
const num = Number(value)
return Number.isFinite(num) ? num : fallback
}

function firstFiniteNumber(values = [], fallback = 0) {
for (const value of values) {
if (value == null || value === "") continue

const num = Number(value)
if (Number.isFinite(num)) return num
}

return fallback
}

function setText(el, value) {
if (!el) return
el.textContent = value == null || value === "" ? "—" : String(value)
}

function setValue(el, value) {
if (!el) return
el.value = value == null ? "" : String(value)
}

function setBoolSelect(el, value) {
if (!el) return
el.value = String(Boolean(value))
}

function stringifyCompact(value) {
if (value == null) return "—"

try {
return JSON.stringify(value)
} catch {
return String(value)
}
}

function getApiBase() {
const { protocol, hostname } = window.location
const override = cleanText(window.__API_BASE__ || "", 1000)

if (override) return override.replace(/\/$/, "")

if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]") {
return `${protocol}//${hostname}:8787`
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.app.github.dev", "-8787.app.github.dev")}`
}

if (hostname.includes("-3001.app.github.dev")) {
return `${protocol}//${hostname.replace("-3001.app.github.dev", "-8787.app.github.dev")}`
}

if (hostname.includes("-4173.app.github.dev")) {
return `${protocol}//${hostname.replace("-4173.app.github.dev", "-8787.app.github.dev")}`
}

if (/:\d+$/.test(window.location.host)) {
return `${protocol}//${hostname}:8787`
}

return window.location.origin
}

const API_BASE = getApiBase()

async function apiFetch(path, options = {}) {
const response = await fetch(`${API_BASE}${path}`, {
credentials: "include",
headers: {
"Content-Type": "application/json",
...(options.headers || {}),
},
...options,
})

let payload = null

try {
payload = await response.json()
} catch {
payload = null
}

if (!response.ok) {
const error = new Error(
payload?.error || payload?.message || `Request failed (${response.status})`
)

error.status = response.status
error.payload = payload

throw error
}

return payload
}

async function apiFetchFirst(paths, options = {}, { allowStatuses = [] } = {}) {
let lastError = null

for (let index = 0; index < paths.length; index += 1) {
const path = paths[index]

try {
return await apiFetch(path, options)
} catch (error) {
lastError = error

if (allowStatuses.includes(error?.status)) {
return {
ok: false,
allowed_status: error.status,
payload: error.payload || null,
}
}

const isLast = index === paths.length - 1
if (error?.status === 404 && !isLast) continue

throw error
}
}

throw lastError || new Error("Request failed")
}

function setSentinelBanner(message = "", variant = "warn") {
if (!els.sentinelBanner) return

els.sentinelBanner.textContent = message || ""
els.sentinelBanner.className = "admin-banner banner"

if (message) {
els.sentinelBanner.classList.add("show")
els.sentinelBanner.classList.add(variant)
}
}

function clearSentinelBanner() {
if (!els.sentinelBanner) return
els.sentinelBanner.className = "admin-banner banner"
els.sentinelBanner.textContent = ""
}

function isLoading() {
return state.loadingCount > 0
}

function refreshApiStatus() {
setText(els.apiStatusChip, isLoading() ? "Loading" : "Ready")
}

function updateControlDisabledState() {
const disabled = isLoading()

;[
els.refreshSentinelButton,
els.saveSentinelSettingsButton,
els.sentinelModePaperButton,
els.sentinelModeArmedButton,
els.sentinelModeLiveButton,
els.sentinelEmergencyStopButton,
els.refreshSentinelSummaryButton,
els.refreshSentinelStatsButton,
els.refreshSentinelPositionsButton,
els.refreshSentinelAuditButton,
els.refreshSentinelAdminAuditButton,
].forEach((button) => {
if (button) button.disabled = disabled
})
}

function beginLoading() {
state.loadingCount += 1
refreshApiStatus()
updateControlDisabledState()
}

function endLoading() {
state.loadingCount = Math.max(0, state.loadingCount - 1)
refreshApiStatus()
updateControlDisabledState()
}

function getSentinelModeVariant(mode) {
const normalized = cleanText(mode, 64).toLowerCase()

if (normalized === "live_mainnet") return "good"
if (normalized === "armed_mainnet") return "warn"
if (normalized === "emergency_stop") return "bad"
if (normalized === "paper") return "neutral"

return "neutral"
}

function getSentinelStageVariant(stage) {
const normalized = cleanText(stage, 64).toLowerCase()

if (normalized === "half_banked_at_10x" || normalized === "runner_only") return "good"
if (normalized === "invalidated") return "bad"
if (normalized === "closed") return "neutral"

return "warn"
}

function getExecutionStatusVariant(status) {
const normalized = cleanText(status, 64).toLowerCase()

if (normalized === "filled" || normalized === "simulated") return "good"
if (normalized === "failed") return "bad"
if (normalized === "submitted" || normalized === "planned") return "warn"

return "neutral"
}

function getPnlVariant(value) {
const num = Number(value)

if (!Number.isFinite(num) || Math.abs(num) < 0.005) return "neutral"

return num > 0 ? "good" : "bad"
}

function getPnlClass(value) {
const variant = getPnlVariant(value)

if (variant === "good") return "pnl-good"
if (variant === "bad") return "pnl-bad"

return "pnl-neutral"
}

function setMoneyTone(el, value, { lossPositive = false } = {}) {
if (!el) return

el.classList.remove("pnl-good", "pnl-bad", "pnl-neutral", "sentinel-loss-metric")

const num = Number(value)

if (!Number.isFinite(num) || Math.abs(num) < 0.005) {
el.classList.add("pnl-neutral")
return
}

if (lossPositive) {
el.classList.add(num > 0 ? "pnl-bad" : "pnl-neutral")
el.classList.add("sentinel-loss-metric")
return
}

el.classList.add(num > 0 ? "pnl-good" : "pnl-bad")
}

function createPill(text, variant = "neutral") {
const span = document.createElement("span")
span.className = `pill admin-pill ${variant}`
span.textContent = cleanText(text, 120) || "—"
return span
}

function renderTableEmpty(tbody, colspan, message) {
if (!tbody) return

tbody.innerHTML = ""

const row = document.createElement("tr")
const td = document.createElement("td")

td.colSpan = colspan
td.style.padding = "24px"
td.style.color = "var(--admin-muted, var(--muted))"
td.style.textAlign = "center"
td.textContent = message

row.appendChild(td)
tbody.appendChild(row)
}

function getPeriodLabel(period) {
const normalized = cleanText(period, 32).toLowerCase()

if (normalized === "weekly") return "Weekly"
if (normalized === "monthly") return "Monthly"
if (normalized === "overall") return "Overall"

return "Daily"
}

function updateSentinelPeriodCopy(summary = state.sentinel.summary || null) {
const period =
cleanText(summary?.selected_period, 32).toLowerCase() ||
cleanText(state.sentinel.filters.summaryPeriod, 32).toLowerCase() ||
"daily"

const label = cleanText(summary?.selected_period_label, 80) || getPeriodLabel(period)

const startDate =
cleanText(summary?.selected_period_start_date, 32) ||
cleanText(summary?.pnl?.start_date, 32) ||
""

const endDate =
cleanText(summary?.selected_period_end_date, 32) ||
cleanText(summary?.pnl?.end_date, 32) ||
cleanText(state.sentinel.filters.summaryDate, 32) ||
todayIso

const rangeText =
period === "overall"
? startDate
? `${startDate} → ${endDate}`
: `Up to ${endDate}`
: startDate && endDate && startDate !== endDate
? `${startDate} → ${endDate}`
: endDate

setText(els.sentinelSummaryPeriodLabel, `${label} PnL`)
setText(els.sentinelSummaryPeriodRange, rangeText || "—")
}

function getPositionMetrics(position = {}) {
const totalCost = firstFiniteNumber(
[
position.total_cost_usd,
position.totalCostUsd,
position.cost_usd,
position.costUsd,
position.capital_deployed_usd,
position.capitalDeployedUsd,
],
0
)

const costBasis = firstFiniteNumber(
[
position.remaining_cost_basis_usd,
position.remainingCostBasisUsd,
position.cost_basis_usd,
position.costBasisUsd,
position.total_cost_usd,
position.totalCostUsd,
],
totalCost
)

const currentValue = firstFiniteNumber(
[
position.current_value_usd,
position.currentValueUsd,
position.position_value_usd,
position.positionValueUsd,
position.market_value_usd,
position.marketValueUsd,
],
0
)

const realizedPnl = firstFiniteNumber(
[
position.realized_pnl_usd,
position.realizedPnlUsd,
position.realized_profit_usd,
position.realizedProfitUsd,
],
0
)

const unrealizedPnl = firstFiniteNumber(
[position.unrealized_pnl_usd, position.unrealizedPnlUsd, currentValue - costBasis],
0
)

const totalPnl = firstFiniteNumber(
[position.total_pnl_usd, position.totalPnlUsd, realizedPnl + unrealizedPnl],
0
)

const pnlPct =
costBasis > 0
? (unrealizedPnl / costBasis) * 100
: totalCost > 0
? (totalPnl / totalCost) * 100
: 0

const openedTs = new Date(position.opened_at || position.created_at || 0).getTime() || 0

return {
totalCost,
costBasis,
currentValue,
realizedPnl,
unrealizedPnl,
totalPnl,
pnlPct,
openedTs,
}
}

function getSortedSentinelPositions() {
const sortMode =
cleanText(state.sentinel.filters.positionSort, 64) ||
cleanText(els.sentinelPositionSortFilter?.value, 64) ||
"pnl_desc"

return [...state.sentinel.positions].sort((a, b) => {
const am = getPositionMetrics(a)
const bm = getPositionMetrics(b)

if (sortMode === "pnl_asc") return am.unrealizedPnl - bm.unrealizedPnl
if (sortMode === "pnl_pct_desc") return bm.pnlPct - am.pnlPct
if (sortMode === "pnl_pct_asc") return am.pnlPct - bm.pnlPct
if (sortMode === "current_value_desc") return bm.currentValue - am.currentValue
if (sortMode === "capital_desc") return bm.costBasis - am.costBasis
if (sortMode === "newest") return bm.openedTs - am.openedTs
if (sortMode === "oldest") return am.openedTs - bm.openedTs

return bm.unrealizedPnl - am.unrealizedPnl
})
}

function computeSentinelPortfolioMetrics() {
const positions = arrayify(state.sentinel.positions)
const summary = state.sentinel.summary || {}
const pnl = summary.pnl || {}
const stats = state.sentinel.stats || {}

let openCapital = 0
let openValue = 0
let openRealized = 0
let openUnrealized = 0
let fallbackTotalCapital = 0

positions.forEach((position) => {
const metrics = getPositionMetrics(position)
const stage = cleanText(position.stage, 64).toLowerCase()
const isClosed = Boolean(position.closed_at || position.invalidated_at)
const isOpenStage = !isClosed && !["closed", "invalidated"].includes(stage)

fallbackTotalCapital += metrics.totalCost || metrics.costBasis

if (isOpenStage) {
openCapital += metrics.costBasis
openValue += metrics.currentValue
openRealized += metrics.realizedPnl
openUnrealized += metrics.unrealizedPnl
}
})

const summaryOpenCapital = firstFiniteNumber(
[
pnl.open_remaining_cost_basis_usd,
pnl.open_cost_basis_usd,
summary.open_capital_at_risk_usd,
summary.openCapitalAtRiskUsd,
summary.open_cost_basis_usd,
summary.openCostBasisUsd,
summary.remaining_cost_basis_usd,
summary.remainingCostBasisUsd,
],
null
)

const summaryOpenValue = firstFiniteNumber(
[
pnl.open_current_value_usd,
summary.open_current_value_usd,
summary.openCurrentValueUsd,
summary.current_open_value_usd,
summary.currentOpenValueUsd,
summary.open_value_usd,
summary.openValueUsd,
],
null
)

const totalCapital = firstFiniteNumber(
[
summary.period_total_spend_usd,
pnl.total_spend_usd,
pnl.scout_spend_usd == null && pnl.sniper_spend_usd == null
? null
: safeNumber(pnl.scout_spend_usd, 0) + safeNumber(pnl.sniper_spend_usd, 0),
summary.total_capital_deployed_usd,
summary.totalCapitalDeployedUsd,
summary.total_invested_usd,
summary.totalInvestedUsd,
summary.capital_deployed_usd,
summary.capitalDeployedUsd,
stats.total_spend_usd,
stats.total_capital_deployed_usd,
stats.totalCapitalDeployedUsd,
stats.total_invested_usd,
stats.totalInvestedUsd,
stats.capital_deployed_usd,
stats.capitalDeployedUsd,
stats.total_cost_usd,
stats.totalCostUsd,
fallbackTotalCapital,
],
0
)

const portfolioPnl = firstFiniteNumber(
[
summary.period_net_pnl_usd,
pnl.net_pnl_usd,
summary.total_portfolio_pnl_usd,
summary.totalPortfolioPnlUsd,
summary.portfolio_pnl_usd,
summary.portfolioPnlUsd,
summary.total_pnl_usd,
summary.totalPnlUsd,
stats.net_pnl_usd,
stats.total_portfolio_pnl_usd,
stats.totalPortfolioPnlUsd,
stats.total_pnl_usd,
stats.totalPnlUsd,
openRealized + openUnrealized,
],
0
)

return {
openCapital: summaryOpenCapital == null ? openCapital : summaryOpenCapital,
openValue: summaryOpenValue == null ? openValue : summaryOpenValue,
totalCapital,
portfolioPnl,
}
}

function updateSentinelPortfolioSummary() {
const metrics = computeSentinelPortfolioMetrics()

if (els.sentinelSummaryOpenCapital) {
els.sentinelSummaryOpenCapital.textContent = formatCurrency(metrics.openCapital)
setMoneyTone(els.sentinelSummaryOpenCapital, metrics.openCapital)
}

if (els.sentinelSummaryOpenValue) {
els.sentinelSummaryOpenValue.textContent = formatCurrency(metrics.openValue)
setMoneyTone(els.sentinelSummaryOpenValue, metrics.openValue)
}

if (els.sentinelSummaryTotalCapital) {
els.sentinelSummaryTotalCapital.textContent = formatCurrency(metrics.totalCapital)
setMoneyTone(els.sentinelSummaryTotalCapital, metrics.totalCapital)
}

if (els.sentinelSummaryPortfolioPnl) {
els.sentinelSummaryPortfolioPnl.textContent = formatSignedCurrency(metrics.portfolioPnl)
setMoneyTone(els.sentinelSummaryPortfolioPnl, metrics.portfolioPnl)
}
}

function applySentinelModeToUi(mode) {
const normalizedMode = cleanText(mode, 64).toLowerCase() || "paper"
const label = titleCase(normalizedMode) || "Paper"

setText(els.sentinelModeChip, label)
setText(els.heroSentinelModeValue, label)
setText(els.sentinelCurrentModeValue, label)

const modeButtons = [
{ el: els.sentinelModePaperButton, mode: "paper", base: "secondary" },
{ el: els.sentinelModeArmedButton, mode: "armed_mainnet", base: "secondary" },
{ el: els.sentinelModeLiveButton, mode: "live_mainnet", base: "secondary" },
{ el: els.sentinelEmergencyStopButton, mode: "emergency_stop", base: "danger" },
]

modeButtons.forEach(({ el, mode: buttonMode, base }) => {
if (!el) return

el.classList.remove("primary", "secondary", "danger", "admin-button-primary", "admin-button-secondary", "admin-button-danger")

if (buttonMode === normalizedMode && buttonMode !== "emergency_stop") {
el.classList.add("primary", "admin-button-primary")
} else if (buttonMode === normalizedMode && buttonMode === "emergency_stop") {
el.classList.add("danger", "admin-button-danger")
} else if (base === "danger") {
el.classList.add("danger", "admin-button-danger")
} else {
el.classList.add("secondary", "admin-button-secondary")
}
})
}

function applySentinelSettingsToInputs(settings) {
if (!settings) return

state.sentinel.settings = settings

setValue(els.sentinelScoutUsdInput, safeNumber(settings.scout_usd, 0.5))
setValue(els.sentinelSniperAddUsdInput, safeNumber(settings.sniper_add_usd, 1))
setValue(els.sentinelMaxTotalPositionUsdInput, safeNumber(settings.max_total_position_usd, 1.5))
setValue(els.sentinelMaxOpenPositionsInput, safeNumber(settings.max_open_positions, 30))
setValue(els.sentinelMaxDailyLossUsdInput, safeNumber(settings.max_daily_loss_usd, 25))
setValue(els.sentinelMaxConsecutiveFailuresInput, safeNumber(settings.max_consecutive_failures, 8))
setValue(els.sentinelMaxDailyScoutSpendUsdInput, safeNumber(settings.max_daily_scout_spend_usd, 20))
setValue(els.sentinelMaxDailySniperSpendUsdInput, safeNumber(settings.max_daily_sniper_spend_usd, 30))
setValue(els.sentinelAutoBankMultipleInput, safeNumber(settings.auto_bank_multiple, 10))
setValue(els.sentinelAutoBankFractionInput, safeNumber(settings.auto_bank_fraction, 0.5))
setValue(els.sentinelMinOperatorQualityScoreInput, safeNumber(settings.min_operator_quality_score, 70))
setValue(els.sentinelMaxHiddenControlRiskInput, safeNumber(settings.max_hidden_control_risk, 30))
setValue(els.sentinelMinRegimeScoreScoutInput, safeNumber(settings.min_regime_score_for_scout, 55))
setValue(els.sentinelMinRegimeScoreSniperInput, safeNumber(settings.min_regime_score_for_sniper, 65))
setValue(els.sentinelMinReclaimStrengthScoreInput, safeNumber(settings.min_reclaim_strength_score, 60))
setValue(els.sentinelMinBuyPressureScoreInput, safeNumber(settings.min_buy_pressure_score, 62))
setValue(els.sentinelMinPersistenceScoreInput, safeNumber(settings.min_persistence_score, 58))
setValue(els.sentinelMinPostEntryHealthScoreInput, safeNumber(settings.min_post_entry_health_score, 55))

setBoolSelect(els.sentinelWatcherEnabledInput, settings.watcher_enabled)
setBoolSelect(els.sentinelAutoBankEnabledInput, settings.auto_bank_enabled)
setBoolSelect(els.sentinelEnableScoutInput, settings.enable_scout)
setBoolSelect(els.sentinelEnableSniperInput, settings.enable_sniper)
setBoolSelect(els.sentinelEnableRunnerManagementInput, settings.enable_runner_management)
setBoolSelect(els.sentinelRiskOffDisableNewEntriesInput, settings.risk_off_disable_new_entries)

setValue(
els.sentinelMaxPositionsPerOperatorClusterInput,
safeNumber(settings.max_positions_per_operator_cluster, 2)
)
setValue(els.sentinelMaxTokensPerHourInput, safeNumber(settings.max_tokens_per_hour, 12))
setValue(els.sentinelCooldownAfterCloseSecInput, safeNumber(settings.cooldown_after_close_sec, 1800))
setValue(
els.sentinelCooldownAfterInvalidationSecInput,
safeNumber(settings.cooldown_after_invalidation_sec, 3600)
)
setValue(els.sentinelEarlyFailTimeoutSecInput, safeNumber(settings.early_fail_timeout_sec, 180))
setValue(els.sentinelWeakStallTimeoutSecInput, safeNumber(settings.weak_stall_timeout_sec, 420))
setValue(
els.sentinelRunnerFailedBreakoutLimitInput,
safeNumber(settings.runner_failed_breakout_limit, 2)
)
setValue(els.sentinelMaxContaminationRiskInput, safeNumber(settings.max_contamination_risk, 35))
setValue(
els.sentinelMaxWalletCoordinationRiskInput,
safeNumber(settings.max_wallet_coordination_risk, 40)
)
setValue(els.sentinelMaxTopHolderPctInput, safeNumber(settings.max_top_holder_pct, 18))
setValue(els.sentinelMaxTop5HolderPctInput, safeNumber(settings.max_top_5_holder_pct, 45))
setValue(els.sentinelMinLiquidityUsdInput, safeNumber(settings.min_liquidity_usd, 800))
setValue(els.sentinelMaxSpreadBpsInput, safeNumber(settings.max_spread_bps, 350))
setValue(els.sentinelMaxPriceImpactBpsInput, safeNumber(settings.max_price_impact_bps, 500))
setValue(
els.sentinelMaxVerticalExtensionScoreForAddInput,
safeNumber(settings.max_vertical_extension_score_for_add, 75)
)
setValue(els.sentinelMaxInsiderSellScoreInput, safeNumber(settings.max_insider_sell_score, 45))
setValue(els.sentinelMaxLiquidityDecayScoreInput, safeNumber(settings.max_liquidity_decay_score, 50))

setBoolSelect(els.sentinelEnableMarketRegimeFilterInput, settings.enable_market_regime_filter)
setBoolSelect(els.sentinelEnableOperatorFilterInput, settings.enable_operator_filter)
setBoolSelect(els.sentinelEnableHardRejectsInput, settings.enable_hard_rejects)

setText(els.sentinelWatcherEnabledValue, settings.watcher_enabled ? "Yes" : "No")
setText(
els.sentinelKillSwitchValue,
cleanText(settings.execution_mode, 64) === "emergency_stop" ? "Active" : "Inactive"
)

applySentinelModeToUi(settings.execution_mode || "paper")
}

function normalizeEngine(engine = null) {
if (!engine || typeof engine !== "object") return null

return {
started: engine.started ?? engine.is_started ?? engine.engine_started ?? false,
running: engine.running ?? engine.is_running ?? engine.engine_running ?? false,
tick_count: engine.tick_count ?? engine.tickCount ?? engine.total_ticks ?? 0,
snapshot_provider_name:
cleanText(
engine.snapshot_provider_name ||
engine.snapshotProviderName ||
engine.provider_name ||
engine.providerName,
120
) || null,
last_tick_started_at: engine.last_tick_started_at || engine.lastTickStartedAt || null,
last_tick_finished_at: engine.last_tick_finished_at || engine.lastTickFinishedAt || null,
last_error: engine.last_error || engine.lastError || null,
last_tick_summary: engine.last_tick_summary || engine.lastTickSummary || null,
current_mode: cleanText(engine.current_mode || engine.currentMode, 64) || null,
}
}

function renderSentinelSummary(summary, engine = null) {
state.sentinel.summary = summary || null
state.sentinel.engine = engine || state.sentinel.engine

const pnl = summary?.pnl || {}

const openPositions = safeNumber(
summary?.open_positions ?? summary?.openPositions ?? pnl.open_positions,
0
)

const realized = firstFiniteNumber(
[
summary?.period_realized_pnl_usd,
pnl.realized_pnl_usd,
summary?.daily_realized_pnl_usd,
summary?.dailyRealizedPnlUsd,
],
0
)

const unrealized = firstFiniteNumber(
[
summary?.period_unrealized_pnl_usd,
pnl.unrealized_pnl_usd,
pnl.open_unrealized_pnl_usd,
summary?.daily_unrealized_pnl_usd,
summary?.dailyUnrealizedPnlUsd,
],
0
)

const loss = firstFiniteNumber(
[summary?.period_loss_usd, pnl.loss_usd, summary?.daily_loss_usd, summary?.dailyLossUsd],
0
)

setText(els.sentinelOpenPositionsHeroValue, formatNumber(openPositions))
setText(els.sentinelSummaryOpenPositions, formatNumber(openPositions))

if (els.sentinelSummaryDailyRealizedPnl) {
els.sentinelSummaryDailyRealizedPnl.textContent = formatSignedCurrency(realized)
setMoneyTone(els.sentinelSummaryDailyRealizedPnl, realized)
}

if (els.sentinelSummaryDailyUnrealizedPnl) {
els.sentinelSummaryDailyUnrealizedPnl.textContent = formatSignedCurrency(unrealized)
setMoneyTone(els.sentinelSummaryDailyUnrealizedPnl, unrealized)
}

if (els.sentinelSummaryDailyLoss) {
els.sentinelSummaryDailyLoss.textContent = formatCurrency(loss)
setMoneyTone(els.sentinelSummaryDailyLoss, loss, { lossPositive: true })
}

const mode =
cleanText(summary?.execution_mode || summary?.executionMode, 64) ||
cleanText(state.sentinel.settings?.execution_mode, 64) ||
"paper"

applySentinelModeToUi(mode)

setText(
els.sentinelKillSwitchValue,
Boolean(summary?.kill_switch_active ?? summary?.killSwitchActive) ? "Active" : "Inactive"
)

updateSentinelPeriodCopy(summary)
updateSentinelPortfolioSummary()
}

function renderSentinelEngine(engine = null) {
const normalized = normalizeEngine(engine)
state.sentinel.engine = normalized

const currentMode =
cleanText(normalized?.current_mode, 64) ||
cleanText(state.sentinel.summary?.execution_mode, 64) ||
cleanText(state.sentinel.settings?.execution_mode, 64) ||
"paper"

applySentinelModeToUi(currentMode)

setText(els.sentinelEngineStartedValue, normalized ? (normalized.started ? "Yes" : "No") : "—")
setText(els.sentinelEngineRunningValue, normalized ? (normalized.running ? "Yes" : "No") : "—")
setText(els.sentinelLastTickStartedValue, formatDateTime(normalized?.last_tick_started_at))
setText(els.sentinelLastTickFinishedValue, formatDateTime(normalized?.last_tick_finished_at))
setText(els.sentinelTickCountValue, formatNumber(normalized?.tick_count, 0))
setText(els.sentinelSnapshotProviderValue, cleanText(normalized?.snapshot_provider_name, 120) || "—")

const lastErrorObject = normalized?.last_error
const lastErrorText =
cleanText(lastErrorObject?.message, 500) || cleanText(lastErrorObject, 500) || "None"
setText(els.sentinelLastErrorValue, lastErrorText)

const lastTickSummary = normalized?.last_tick_summary

if (!els.sentinelLastTickSummaryValue) return

if (!lastTickSummary) {
els.sentinelLastTickSummaryValue.textContent = "—"
return
}

const summaryParts = []

if (lastTickSummary.total != null) summaryParts.push(`total:${lastTickSummary.total}`)
if (lastTickSummary.scout_entry != null) summaryParts.push(`scout:${lastTickSummary.scout_entry}`)
if (lastTickSummary.sniper_add != null) summaryParts.push(`sniper:${lastTickSummary.sniper_add}`)
if (lastTickSummary.partial_take_profit != null) summaryParts.push(`tp:${lastTickSummary.partial_take_profit}`)
if (lastTickSummary.full_exit != null) summaryParts.push(`exit:${lastTickSummary.full_exit}`)
if (lastTickSummary.reject != null) summaryParts.push(`reject:${lastTickSummary.reject}`)
if (lastTickSummary.watchlist != null) summaryParts.push(`watchlist:${lastTickSummary.watchlist}`)
if (lastTickSummary.hold != null) summaryParts.push(`hold:${lastTickSummary.hold}`)
if (lastTickSummary.kill_switch != null) summaryParts.push(`kill:${lastTickSummary.kill_switch}`)
if (lastTickSummary.error) summaryParts.push(`error:${cleanText(lastTickSummary.error, 80)}`)

els.sentinelLastTickSummaryValue.textContent = summaryParts.length
? summaryParts.join(" • ")
: stringifyCompact(lastTickSummary)
}

function renderSentinelStatus(payload) {
state.sentinel.status = payload || null
if (!payload) return

if (payload.settings) {
applySentinelSettingsToInputs(payload.settings)
}

if (payload.summary) {
renderSentinelSummary(payload.summary, payload.engine || null)
}

if (payload.engine) {
renderSentinelEngine(payload.engine)
}

const watcherEnabled =
payload?.settings?.watcher_enabled != null
? Boolean(payload.settings.watcher_enabled)
: Boolean(payload?.summary?.watcher_enabled)

setText(els.sentinelWatcherEnabledValue, watcherEnabled ? "Yes" : "No")

updateSentinelPortfolioSummary()
}

function renderSentinelStats(stats) {
state.sentinel.stats = stats || null

setText(els.sentinelStatsScoutsOpened, formatNumber(stats?.scouts_opened, 0))
setText(els.sentinelStatsSniperAdds, formatNumber(stats?.sniper_adds, 0))
setText(els.sentinelStatsPositionsClosed, formatNumber(stats?.positions_closed, 0))
setText(els.sentinelStatsInvalidations, formatNumber(stats?.invalidations, 0))
setText(els.sentinelStatsConsecutiveFailures, formatNumber(stats?.consecutive_failures, 0))
setText(els.sentinelStatsReclaimSuccessRate, formatPercent(stats?.reclaim_success_rate_pct, 1))
setText(els.sentinelStatsRecentRugRate, formatPercent(stats?.recent_rug_rate_pct, 1))
setText(els.sentinelStatsAvgMarketLiquidity, formatCurrency(stats?.avg_market_liquidity_usd))

updateSentinelPortfolioSummary()
}

function renderSentinelPositions() {
const tbody = els.sentinelPositionsTableBody
if (!tbody) return

tbody.innerHTML = ""

if (!state.sentinel.positions.length) {
renderTableEmpty(tbody, 9, "No Sentinel positions found for the current filter set.")
updateSentinelPortfolioSummary()
return
}

const sortedPositions = getSortedSentinelPositions()

sortedPositions.forEach((position) => {
const metrics = getPositionMetrics(position)
const row = document.createElement("tr")

const pnlVariant = getPnlVariant(metrics.unrealizedPnl)
if (pnlVariant === "good") row.classList.add("sentinel-position-gain")
if (pnlVariant === "bad") row.classList.add("sentinel-position-loss")

const tokenCell = document.createElement("td")
tokenCell.innerHTML = `
<div style="font-weight:800;">${cleanText(position.token_id, 120) || "—"}</div>
<div class="dim mono">${shortenWallet(position.mint_address)}</div>
<div class="dim">${cleanText(position.linked_operator_cluster_id, 80) || "No cluster"}</div>
`

const stageCell = document.createElement("td")
stageCell.appendChild(createPill(titleCase(position.stage || "unknown"), getSentinelStageVariant(position.stage)))

const modeCell = document.createElement("td")
modeCell.appendChild(
createPill(titleCase(position.execution_mode || "paper"), getSentinelModeVariant(position.execution_mode))
)

const costCell = document.createElement("td")
costCell.innerHTML = `
<div>${formatCurrency(metrics.totalCost)}</div>
<div class="dim">Basis ${formatCurrency(metrics.costBasis)}</div>
`

const currentCell = document.createElement("td")
currentCell.innerHTML = `
<div style="font-weight:900;">${formatCurrency(metrics.currentValue)}</div>
<div class="dim">${
metrics.costBasis > 0 ? `${formatNumber(metrics.currentValue / metrics.costBasis, 2)}x basis` : "No basis"
}</div>
`

const realizedCell = document.createElement("td")
realizedCell.innerHTML = `
<div class="sentinel-pnl-stack">
<div class="sentinel-pnl-main ${getPnlClass(metrics.realizedPnl)}">${formatSignedCurrency(metrics.realizedPnl)}</div>
<div class="sentinel-pnl-sub">Realized</div>
</div>
`

const unrealizedCell = document.createElement("td")
unrealizedCell.innerHTML = `
<div class="sentinel-pnl-stack">
<div class="sentinel-pnl-main ${getPnlClass(metrics.unrealizedPnl)}">${formatSignedCurrency(metrics.unrealizedPnl)}</div>
<div class="sentinel-pnl-sub ${getPnlClass(metrics.unrealizedPnl)}">${formatSignedPercent(metrics.pnlPct, 2)}</div>
</div>
`

const bankedCell = document.createElement("td")
bankedCell.appendChild(createPill(position.has_banked_10x ? "Yes" : "No", position.has_banked_10x ? "good" : "neutral"))

const openedCell = document.createElement("td")
openedCell.innerHTML = `
<div>${formatDateTime(position.opened_at)}</div>
<div class="dim">${position.closed_at ? `Closed ${formatDateTime(position.closed_at)}` : ""}</div>
<div class="dim">${position.invalidated_at ? `Invalidated ${formatDateTime(position.invalidated_at)}` : ""}</div>
`

;[
tokenCell,
stageCell,
modeCell,
costCell,
currentCell,
realizedCell,
unrealizedCell,
bankedCell,
openedCell,
].forEach((cell) => row.appendChild(cell))

tbody.appendChild(row)
})

updateSentinelPortfolioSummary()
}

function renderSentinelAudit() {
const tbody = els.sentinelAuditTableBody
if (!tbody) return

tbody.innerHTML = ""

if (!state.sentinel.audit.length) {
renderTableEmpty(tbody, 7, "No Sentinel audit events found for the current filter set.")
return
}

state.sentinel.audit.forEach((event) => {
const row = document.createElement("tr")
const reasons = Array.isArray(event.reason_codes) ? event.reason_codes : []
const reasonText = reasons.length ? reasons.join(" • ") : "—"

const timeCell = document.createElement("td")
timeCell.innerHTML = `
<div>${formatDateTime(event.created_at)}</div>
<div class="dim">${event.actor_type || "system"}${event.actor_id ? ` • ${cleanText(event.actor_id, 80)}` : ""}</div>
`

const eventCell = document.createElement("td")
eventCell.innerHTML = `
<div style="font-weight:800;">${titleCase(event.event_type || "event")}</div>
<div class="dim">${event.position_id ? `Position #${event.position_id}` : ""}</div>
`

const decisionCell = document.createElement("td")
decisionCell.textContent = titleCase(event.decision || "—")

const modeCell = document.createElement("td")
modeCell.appendChild(createPill(titleCase(event.execution_mode || "—"), getSentinelModeVariant(event.execution_mode)))

const tokenCell = document.createElement("td")
tokenCell.innerHTML = `
<div>${cleanText(event.token_id, 120) || "—"}</div>
<div class="dim mono">${event.mint_address ? shortenWallet(event.mint_address) : "—"}</div>
`

const reasonsCell = document.createElement("td")
reasonsCell.textContent = cleanText(reasonText, 300)

const statusCell = document.createElement("td")
statusCell.appendChild(
createPill(titleCase(event.execution_status || "unknown"), getExecutionStatusVariant(event.execution_status))
)

;[timeCell, eventCell, decisionCell, modeCell, tokenCell, reasonsCell, statusCell].forEach((cell) =>
row.appendChild(cell)
)

tbody.appendChild(row)
})
}

function renderSentinelAdminAudit() {
const tbody = els.sentinelAdminAuditTableBody
if (!tbody) return

tbody.innerHTML = ""

if (!state.sentinel.adminAudit.length) {
renderTableEmpty(tbody, 6, "No Sentinel admin audit entries found.")
return
}

state.sentinel.adminAudit.forEach((entry) => {
const row = document.createElement("tr")

const timeCell = document.createElement("td")
timeCell.innerHTML = `
<div>${formatDateTime(entry.created_at)}</div>
<div class="dim">${cleanText(entry.status, 64) || "—"}</div>
`

const actionCell = document.createElement("td")
actionCell.innerHTML = `
<div style="font-weight:800;">${titleCase(entry.action || "event")}</div>
<div class="dim">${cleanText(entry.notes, 200) || ""}</div>
`

const actorCell = document.createElement("td")
actorCell.innerHTML = `
<div>${cleanText(entry.actor_id, 120) || "—"}</div>
<div class="dim">${cleanText(entry.actor_type, 120) || "—"}</div>
`

const targetCell = document.createElement("td")
targetCell.innerHTML = `
<div>${cleanText(entry.target_type, 120) || "—"}</div>
<div class="dim">${cleanText(entry.target_id, 120) || "—"}</div>
`

const detailsCell = document.createElement("td")
const detailValue =
entry.details_json ??
entry.metadata_json ??
entry.payload_json ??
entry.old_state_json ??
entry.new_state_json ??
null
detailsCell.textContent = cleanText(stringifyCompact(detailValue), 300)

const stateCell = document.createElement("td")
stateCell.textContent = cleanText(stringifyCompact(entry.new_state_json || entry.old_state_json), 300) || "—"

;[timeCell, actionCell, actorCell, targetCell, detailsCell, stateCell].forEach((cell) =>
row.appendChild(cell)
)

tbody.appendChild(row)
})
}

function syncSentinelFiltersFromInputs() {
state.sentinel.filters.summaryPeriod =
cleanText(els.sentinelSummaryPeriodFilter?.value, 32).toLowerCase() ||
state.sentinel.filters.summaryPeriod ||
"daily"

state.sentinel.filters.summaryDate =
cleanText(els.sentinelSummaryDateInput?.value, 32) ||
state.sentinel.filters.summaryDate ||
todayIso

state.sentinel.filters.statsDate =
cleanText(els.sentinelStatsDateInput?.value, 32) ||
state.sentinel.filters.summaryDate ||
todayIso

state.sentinel.filters.statsMode = cleanText(els.sentinelStatsModeFilter?.value, 64) || "paper"

state.sentinel.filters.positionScope =
cleanText(els.sentinelPositionScopeFilter?.value, 64).toLowerCase() || "open"

state.sentinel.filters.positionStage = cleanText(
els.sentinelPositionStageFilter?.value,
64
).toLowerCase()

state.sentinel.filters.positionOutcome = cleanText(
els.sentinelPositionOutcomeFilter?.value,
64
).toLowerCase()

state.sentinel.filters.positionMode = cleanText(
els.sentinelPositionsModeFilter?.value,
64
).toLowerCase()

state.sentinel.filters.positionTokenId = cleanText(els.sentinelPositionsTokenFilter?.value, 255)
state.sentinel.filters.positionMintAddress = cleanText(els.sentinelPositionsMintFilter?.value, 255)

state.sentinel.filters.positionSort =
cleanText(els.sentinelPositionSortFilter?.value, 64) ||
state.sentinel.filters.positionSort ||
"pnl_desc"

state.sentinel.filters.auditEventType = cleanText(
els.sentinelAuditEventTypeFilter?.value,
64
).toLowerCase()

state.sentinel.filters.auditDecision = cleanText(els.sentinelAuditDecisionFilter?.value, 64).toLowerCase()

state.sentinel.filters.auditExecutionStatus = cleanText(
els.sentinelAuditExecutionStatusFilter?.value,
64
).toLowerCase()

state.sentinel.filters.auditMode = cleanText(els.sentinelAuditModeFilter?.value, 64).toLowerCase()
state.sentinel.filters.auditTokenId = cleanText(els.sentinelAuditTokenFilter?.value, 255)
state.sentinel.filters.auditMintAddress = cleanText(els.sentinelAuditMintFilter?.value, 255)

state.sentinel.filters.auditActorType = cleanText(
els.sentinelAuditActorTypeFilter?.value,
64
).toLowerCase()

state.sentinel.filters.auditActorId = cleanText(els.sentinelAuditActorIdFilter?.value, 255)
state.sentinel.filters.auditReasonCode = cleanText(els.sentinelAuditReasonCodeFilter?.value, 128)

state.sentinel.filters.adminAuditAction = cleanText(els.sentinelAdminAuditActionFilter?.value, 120)
state.sentinel.filters.adminAuditActorId = cleanText(els.sentinelAdminAuditActorFilter?.value, 255)
state.sentinel.filters.adminAuditTargetType = cleanText(els.sentinelAdminAuditTargetTypeFilter?.value, 120)
}

function buildSentinelSummaryQueryString() {
const params = new URLSearchParams()
const period = cleanText(state.sentinel.filters.summaryPeriod, 32).toLowerCase() || "daily"
const date = cleanText(state.sentinel.filters.summaryDate, 32) || todayIso

params.set("period", period)
params.set("date", date)

const mode = cleanText(state.sentinel.filters.statsMode, 64).toLowerCase()
if (mode) params.set("mode", mode)

return params.toString()
}

async function loadSentinelStatus({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const queryString = buildSentinelSummaryQueryString()

try {
const payload = await apiFetchFirst([
`/api/compliance-admin/sentinel/status${queryString ? `?${queryString}` : ""}`,
])

renderSentinelStatus(payload)
return payload
} catch (primaryError) {
const [settingsPayload, summaryPayload] = await Promise.all([
apiFetch(`/api/compliance-admin/sentinel/settings`),
apiFetch(`/api/compliance-admin/sentinel/summary${queryString ? `?${queryString}` : ""}`),
])

const merged = {
ok: true,
settings: settingsPayload?.settings || null,
engine: settingsPayload?.engine || summaryPayload?.engine || null,
summary: summaryPayload?.summary || null,
}

renderSentinelStatus(merged)
return merged
}
} finally {
if (manageLoading) endLoading()
}
}

function buildSentinelStatsQueryString() {
const params = new URLSearchParams()
const period = cleanText(state.sentinel.filters.summaryPeriod, 32).toLowerCase() || "daily"
const date =
cleanText(state.sentinel.filters.statsDate, 32) ||
cleanText(state.sentinel.filters.summaryDate, 32) ||
todayIso

params.set("period", period)
params.set("date", date)

if (state.sentinel.filters.statsMode) {
params.set("mode", state.sentinel.filters.statsMode)
}

return params.toString()
}

async function loadSentinelStats({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const queryString = buildSentinelStatsQueryString()

try {
const payload = await apiFetch(
`/api/compliance-admin/sentinel/stats/summary${queryString ? `?${queryString}` : ""}`
)
renderSentinelStats(payload?.stats || null)
return payload?.stats || null
} catch (error) {
if (error?.status !== 404) throw error

const fallbackParams = new URLSearchParams()

if (state.sentinel.filters.statsDate) {
fallbackParams.set("date", state.sentinel.filters.statsDate)
}

if (state.sentinel.filters.statsMode) {
fallbackParams.set("mode", state.sentinel.filters.statsMode)
}

const fallbackQueryString = fallbackParams.toString()

const payload = await apiFetch(
`/api/compliance-admin/sentinel/stats/daily${fallbackQueryString ? `?${fallbackQueryString}` : ""}`
)

renderSentinelStats(payload?.stats || null)
return payload?.stats || null
}
} finally {
if (manageLoading) endLoading()
}
}

function buildSentinelPositionsQueryString() {
const params = new URLSearchParams()

const rawScope = cleanText(state.sentinel.filters.positionScope, 64).toLowerCase()
const rawStage = cleanText(state.sentinel.filters.positionStage, 64).toLowerCase()
const rawOutcome = cleanText(state.sentinel.filters.positionOutcome, 64).toLowerCase()

const effectiveScope =
rawScope || (["open", "history", "all"].includes(rawStage) ? rawStage : "open")

if (effectiveScope && ["open", "history", "all"].includes(effectiveScope)) {
params.set("scope", effectiveScope)
}

if (rawStage && !["open", "history", "all"].includes(rawStage)) {
params.set("stage", rawStage)
}

if (rawOutcome && ["closed", "invalidated"].includes(rawOutcome)) {
params.set("outcome", rawOutcome)
}

if (state.sentinel.filters.positionMode) {
params.set("mode", state.sentinel.filters.positionMode)
}

if (state.sentinel.filters.positionTokenId) {
params.set("token_id", state.sentinel.filters.positionTokenId)
}

if (state.sentinel.filters.positionMintAddress) {
params.set("mint_address", state.sentinel.filters.positionMintAddress)
}

params.set("limit", "100")

return params.toString()
}

async function loadSentinelPositions({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const queryString = buildSentinelPositionsQueryString()
const payload = await apiFetch(
`/api/compliance-admin/sentinel/positions${queryString ? `?${queryString}` : ""}`
)

state.sentinel.positions = Array.isArray(payload?.positions) ? payload.positions : []
renderSentinelPositions()

return state.sentinel.positions
} finally {
if (manageLoading) endLoading()
}
}

function buildSentinelAuditQueryString() {
const params = new URLSearchParams()

if (state.sentinel.filters.auditEventType) {
params.set("event_type", state.sentinel.filters.auditEventType)
}

if (state.sentinel.filters.auditDecision) {
params.set("decision", state.sentinel.filters.auditDecision)
}

if (state.sentinel.filters.auditExecutionStatus) {
params.set("execution_status", state.sentinel.filters.auditExecutionStatus)
}

if (state.sentinel.filters.auditMode) {
params.set("mode", state.sentinel.filters.auditMode)
}

if (state.sentinel.filters.auditTokenId) {
params.set("token_id", state.sentinel.filters.auditTokenId)
}

if (state.sentinel.filters.auditMintAddress) {
params.set("mint_address", state.sentinel.filters.auditMintAddress)
}

if (state.sentinel.filters.auditActorType) {
params.set("actor_type", state.sentinel.filters.auditActorType)
}

if (state.sentinel.filters.auditActorId) {
params.set("actor_id", state.sentinel.filters.auditActorId)
}

if (state.sentinel.filters.auditReasonCode) {
params.set("reason_code", state.sentinel.filters.auditReasonCode)
}

params.set("limit", "100")

return params.toString()
}

async function loadSentinelAudit({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const queryString = buildSentinelAuditQueryString()
const payload = await apiFetch(
`/api/compliance-admin/sentinel/audit${queryString ? `?${queryString}` : ""}`
)

state.sentinel.audit = Array.isArray(payload?.audit) ? payload.audit : []
renderSentinelAudit()

return state.sentinel.audit
} finally {
if (manageLoading) endLoading()
}
}

function buildSentinelAdminAuditQueryString() {
const params = new URLSearchParams()

if (state.sentinel.filters.adminAuditAction) {
params.set("action", state.sentinel.filters.adminAuditAction)
}

if (state.sentinel.filters.adminAuditActorId) {
params.set("actor_id", state.sentinel.filters.adminAuditActorId)
}

if (state.sentinel.filters.adminAuditTargetType) {
params.set("target_type", state.sentinel.filters.adminAuditTargetType)
}

params.set("limit", "100")

return params.toString()
}

async function loadSentinelAdminAudit({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const queryString = buildSentinelAdminAuditQueryString()

const payload = await apiFetchFirst([
`/api/compliance-admin/sentinel/admin-audit${queryString ? `?${queryString}` : ""}`,
`/api/compliance-admin/sentinel/audit/admin${queryString ? `?${queryString}` : ""}`,
])

state.sentinel.adminAudit = Array.isArray(payload?.audit) ? payload.audit : []
renderSentinelAdminAudit()

return state.sentinel.adminAudit
} finally {
if (manageLoading) endLoading()
}
}

async function loadSentinelBundle({ showSuccess = false } = {}) {
beginLoading()

try {
syncSentinelFiltersFromInputs()

const results = await Promise.allSettled([
loadSentinelStatus({ manageLoading: false }),
loadSentinelStats({ manageLoading: false }),
loadSentinelPositions({ manageLoading: false }),
loadSentinelAudit({ manageLoading: false }),
loadSentinelAdminAudit({ manageLoading: false }),
])

const failures = results.filter((result) => result.status === "rejected")

if (failures.length) {
const firstError = failures[0]?.reason
setSentinelBanner(firstError?.message || "One or more Sentinel admin requests failed.", "bad")
return
}

clearSentinelBanner()

if (showSuccess) {
setSentinelBanner("Sentinel data refreshed.", "good")
}
} catch (error) {
setSentinelBanner(error?.message || "Failed to load Sentinel data.", "bad")
} finally {
endLoading()
}
}

function getOptionalNumber(inputEl, fallback, label, options = {}) {
if (!inputEl) return fallback

const raw = cleanText(inputEl.value, 120)
if (!raw.length) return fallback

const value = Number(raw)

if (!Number.isFinite(value)) {
throw new Error(`${label} must be a valid number.`)
}

if (options.min != null && value < options.min) {
throw new Error(`${label} must be at least ${options.min}.`)
}

if (options.max != null && value > options.max) {
throw new Error(`${label} must be no more than ${options.max}.`)
}

return value
}

function getOptionalBool(inputEl, fallback) {
if (!inputEl) return Boolean(fallback)
return parseBool(inputEl.value, Boolean(fallback))
}

function getActorId() {
return cleanText(window.__MSS_ADMIN_ACTOR_ID__ || "", 120) || "admin"
}

function buildSentinelSettingsPayload() {
const base = {
...(state.sentinel.settings || {}),
}

return {
actor_id: getActorId(),

watcher_enabled: getOptionalBool(els.sentinelWatcherEnabledInput, base.watcher_enabled),
auto_bank_enabled: getOptionalBool(els.sentinelAutoBankEnabledInput, base.auto_bank_enabled),

scout_usd: getOptionalNumber(els.sentinelScoutUsdInput, base.scout_usd, "Scout USD", {
min: 0.01,
}),
sniper_add_usd: getOptionalNumber(
els.sentinelSniperAddUsdInput,
base.sniper_add_usd,
"Sniper Add USD",
{ min: 0.01 }
),
max_total_position_usd: getOptionalNumber(
els.sentinelMaxTotalPositionUsdInput,
base.max_total_position_usd,
"Max Total Position USD",
{ min: 0.01 }
),
max_open_positions: getOptionalNumber(
els.sentinelMaxOpenPositionsInput,
base.max_open_positions,
"Max Open Positions",
{ min: 1 }
),
max_daily_loss_usd: getOptionalNumber(
els.sentinelMaxDailyLossUsdInput,
base.max_daily_loss_usd,
"Max Daily Loss USD",
{ min: 0 }
),
max_consecutive_failures: getOptionalNumber(
els.sentinelMaxConsecutiveFailuresInput,
base.max_consecutive_failures,
"Max Consecutive Failures",
{ min: 0 }
),
max_daily_scout_spend_usd: getOptionalNumber(
els.sentinelMaxDailyScoutSpendUsdInput,
base.max_daily_scout_spend_usd,
"Max Daily Scout Spend USD",
{ min: 0 }
),
max_daily_sniper_spend_usd: getOptionalNumber(
els.sentinelMaxDailySniperSpendUsdInput,
base.max_daily_sniper_spend_usd,
"Max Daily Sniper Spend USD",
{ min: 0 }
),
auto_bank_multiple: getOptionalNumber(
els.sentinelAutoBankMultipleInput,
base.auto_bank_multiple,
"Auto-Bank Multiple",
{ min: 1 }
),
auto_bank_fraction: getOptionalNumber(
els.sentinelAutoBankFractionInput,
base.auto_bank_fraction,
"Auto-Bank Fraction",
{ min: 0.01, max: 1 }
),

min_operator_quality_score: getOptionalNumber(
els.sentinelMinOperatorQualityScoreInput,
base.min_operator_quality_score,
"Min Operator Quality Score",
{ min: 0, max: 100 }
),
max_hidden_control_risk: getOptionalNumber(
els.sentinelMaxHiddenControlRiskInput,
base.max_hidden_control_risk,
"Max Hidden Control Risk",
{ min: 0, max: 100 }
),
min_regime_score_for_scout: getOptionalNumber(
els.sentinelMinRegimeScoreScoutInput,
base.min_regime_score_for_scout,
"Min Regime Score For Scout",
{ min: 0, max: 100 }
),
min_regime_score_for_sniper: getOptionalNumber(
els.sentinelMinRegimeScoreSniperInput,
base.min_regime_score_for_sniper,
"Min Regime Score For Sniper",
{ min: 0, max: 100 }
),
min_reclaim_strength_score: getOptionalNumber(
els.sentinelMinReclaimStrengthScoreInput,
base.min_reclaim_strength_score,
"Min Reclaim Strength Score",
{ min: 0, max: 100 }
),
min_buy_pressure_score: getOptionalNumber(
els.sentinelMinBuyPressureScoreInput,
base.min_buy_pressure_score,
"Min Buy Pressure Score",
{ min: 0, max: 100 }
),
min_persistence_score: getOptionalNumber(
els.sentinelMinPersistenceScoreInput,
base.min_persistence_score,
"Min Persistence Score",
{ min: 0, max: 100 }
),
min_post_entry_health_score: getOptionalNumber(
els.sentinelMinPostEntryHealthScoreInput,
base.min_post_entry_health_score,
"Min Post-Entry Health Score",
{ min: 0, max: 100 }
),

enable_scout: getOptionalBool(els.sentinelEnableScoutInput, base.enable_scout),
enable_sniper: getOptionalBool(els.sentinelEnableSniperInput, base.enable_sniper),
enable_runner_management: getOptionalBool(
els.sentinelEnableRunnerManagementInput,
base.enable_runner_management
),
risk_off_disable_new_entries: getOptionalBool(
els.sentinelRiskOffDisableNewEntriesInput,
base.risk_off_disable_new_entries
),

max_positions_per_operator_cluster: getOptionalNumber(
els.sentinelMaxPositionsPerOperatorClusterInput,
base.max_positions_per_operator_cluster,
"Max Positions Per Operator Cluster",
{ min: 1 }
),
max_tokens_per_hour: getOptionalNumber(
els.sentinelMaxTokensPerHourInput,
base.max_tokens_per_hour,
"Max Tokens Per Hour",
{ min: 0 }
),
cooldown_after_close_sec: getOptionalNumber(
els.sentinelCooldownAfterCloseSecInput,
base.cooldown_after_close_sec,
"Cooldown After Close Seconds",
{ min: 0 }
),
cooldown_after_invalidation_sec: getOptionalNumber(
els.sentinelCooldownAfterInvalidationSecInput,
base.cooldown_after_invalidation_sec,
"Cooldown After Invalidation Seconds",
{ min: 0 }
),
early_fail_timeout_sec: getOptionalNumber(
els.sentinelEarlyFailTimeoutSecInput,
base.early_fail_timeout_sec,
"Early Fail Timeout Seconds",
{ min: 0 }
),
weak_stall_timeout_sec: getOptionalNumber(
els.sentinelWeakStallTimeoutSecInput,
base.weak_stall_timeout_sec,
"Weak Stall Timeout Seconds",
{ min: 0 }
),
runner_failed_breakout_limit: getOptionalNumber(
els.sentinelRunnerFailedBreakoutLimitInput,
base.runner_failed_breakout_limit,
"Runner Failed Breakout Limit",
{ min: 0 }
),
max_contamination_risk: getOptionalNumber(
els.sentinelMaxContaminationRiskInput,
base.max_contamination_risk,
"Max Contamination Risk",
{ min: 0, max: 100 }
),
max_wallet_coordination_risk: getOptionalNumber(
els.sentinelMaxWalletCoordinationRiskInput,
base.max_wallet_coordination_risk,
"Max Wallet Coordination Risk",
{ min: 0, max: 100 }
),
max_top_holder_pct: getOptionalNumber(
els.sentinelMaxTopHolderPctInput,
base.max_top_holder_pct,
"Max Top Holder %",
{ min: 0, max: 100 }
),
max_top_5_holder_pct: getOptionalNumber(
els.sentinelMaxTop5HolderPctInput,
base.max_top_5_holder_pct,
"Max Top 5 Holder %",
{ min: 0, max: 100 }
),
min_liquidity_usd: getOptionalNumber(
els.sentinelMinLiquidityUsdInput,
base.min_liquidity_usd,
"Min Liquidity USD",
{ min: 0 }
),
max_spread_bps: getOptionalNumber(
els.sentinelMaxSpreadBpsInput,
base.max_spread_bps,
"Max Spread BPS",
{ min: 0 }
),
max_price_impact_bps: getOptionalNumber(
els.sentinelMaxPriceImpactBpsInput,
base.max_price_impact_bps,
"Max Price Impact BPS",
{ min: 0 }
),
max_vertical_extension_score_for_add: getOptionalNumber(
els.sentinelMaxVerticalExtensionScoreForAddInput,
base.max_vertical_extension_score_for_add,
"Max Vertical Extension Score For Add",
{ min: 0, max: 100 }
),
max_insider_sell_score: getOptionalNumber(
els.sentinelMaxInsiderSellScoreInput,
base.max_insider_sell_score,
"Max Insider Sell Score",
{ min: 0, max: 100 }
),
max_liquidity_decay_score: getOptionalNumber(
els.sentinelMaxLiquidityDecayScoreInput,
base.max_liquidity_decay_score,
"Max Liquidity Decay Score",
{ min: 0, max: 100 }
),
enable_market_regime_filter: getOptionalBool(
els.sentinelEnableMarketRegimeFilterInput,
base.enable_market_regime_filter
),
enable_operator_filter: getOptionalBool(
els.sentinelEnableOperatorFilterInput,
base.enable_operator_filter
),
enable_hard_rejects: getOptionalBool(
els.sentinelEnableHardRejectsInput,
base.enable_hard_rejects
),
}
}

async function saveSentinelSettings() {
beginLoading()

try {
const body = buildSentinelSettingsPayload()

const payload = await apiFetch(`/api/compliance-admin/sentinel/settings`, {
method: "PATCH",
body: JSON.stringify(body),
})

if (payload?.settings) {
applySentinelSettingsToInputs(payload.settings)
}

if (payload?.engine) {
renderSentinelEngine(payload.engine)
}

await Promise.all([
loadSentinelStatus({ manageLoading: false }),
loadSentinelStats({ manageLoading: false }),
loadSentinelPositions({ manageLoading: false }),
loadSentinelAudit({ manageLoading: false }),
loadSentinelAdminAudit({ manageLoading: false }),
])

const changedFields = Array.isArray(payload?.changed_fields) ? payload.changed_fields : []

setSentinelBanner(
changedFields.length
? `Sentinel settings saved. Changed: ${changedFields.join(", ")}.`
: "Sentinel settings saved.",
"good"
)
} catch (error) {
setSentinelBanner(error?.message || "Failed to save Sentinel settings.", "bad")
} finally {
endLoading()
}
}

async function changeSentinelMode(mode) {
const requestedMode = cleanText(mode, 64).toLowerCase()
const reason = cleanText(els.sentinelModeReasonInput?.value, 500)

if (!requestedMode) {
setSentinelBanner("A Sentinel mode is required.", "warn")
return
}

let confirmed = true

if (requestedMode === "armed_mainnet") {
confirmed = window.confirm(
"Switch Sentinel Watcher into Armed Mainnet mode? Only do this when controlled live arming is intended."
)
} else if (requestedMode === "live_mainnet") {
confirmed = window.confirm(
"Switch Sentinel Watcher into Live Mainnet mode? This enables live execution once backend routing is active."
)
} else if (requestedMode === "emergency_stop") {
confirmed = window.confirm("Activate Sentinel Emergency Stop? This should immediately stop new entries.")
}

if (!confirmed) return

beginLoading()

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
confirm_live: requestedMode === "armed_mainnet" || requestedMode === "live_mainnet",
}),
})

const currentMode = cleanText(payload?.current_mode, 64) || requestedMode

if (els.sentinelStatsModeFilter) {
els.sentinelStatsModeFilter.value = currentMode
}

await Promise.all([
loadSentinelStatus({ manageLoading: false }),
loadSentinelStats({ manageLoading: false }),
loadSentinelPositions({ manageLoading: false }),
loadSentinelAudit({ manageLoading: false }),
loadSentinelAdminAudit({ manageLoading: false }),
])

setSentinelBanner(`Sentinel mode switched to ${titleCase(currentMode)}.`, "good")
} catch (error) {
setSentinelBanner(error?.message || "Failed to change Sentinel mode.", "bad")
} finally {
endLoading()
}
}

async function refreshSentinelSummaryOnly() {
beginLoading()

try {
syncSentinelFiltersFromInputs()

await Promise.all([
loadSentinelStatus({ manageLoading: false }),
loadSentinelStats({ manageLoading: false }),
])

clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel summary.", "bad")
} finally {
endLoading()
}
}

function bindActions() {
els.refreshSentinelButton?.addEventListener("click", async () => {
syncSentinelFiltersFromInputs()
await loadSentinelBundle({ showSuccess: true })
})

els.saveSentinelSettingsButton?.addEventListener("click", async () => {
await saveSentinelSettings()
})

els.sentinelModePaperButton?.addEventListener("click", async () => {
await changeSentinelMode("paper")
})

els.sentinelModeArmedButton?.addEventListener("click", async () => {
await changeSentinelMode("armed_mainnet")
})

els.sentinelModeLiveButton?.addEventListener("click", async () => {
await changeSentinelMode("live_mainnet")
})

els.sentinelEmergencyStopButton?.addEventListener("click", async () => {
await changeSentinelMode("emergency_stop")
})

els.sentinelSummaryPeriodFilter?.addEventListener("change", async () => {
state.sentinel.filters.summaryPeriod =
cleanText(els.sentinelSummaryPeriodFilter?.value, 32).toLowerCase() || "daily"

await refreshSentinelSummaryOnly()
})

els.sentinelSummaryDateInput?.addEventListener("change", async () => {
state.sentinel.filters.summaryDate = cleanText(els.sentinelSummaryDateInput?.value, 32) || todayIso
state.sentinel.filters.statsDate = state.sentinel.filters.summaryDate

if (els.sentinelStatsDateInput) {
els.sentinelStatsDateInput.value = state.sentinel.filters.statsDate
}

await refreshSentinelSummaryOnly()
})

els.refreshSentinelSummaryButton?.addEventListener("click", async () => {
await refreshSentinelSummaryOnly()
})

els.refreshSentinelStatsButton?.addEventListener("click", async () => {
beginLoading()

try {
syncSentinelFiltersFromInputs()
await loadSentinelStats({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel stats.", "bad")
} finally {
endLoading()
}
})

els.sentinelPositionSortFilter?.addEventListener("change", () => {
state.sentinel.filters.positionSort = cleanText(els.sentinelPositionSortFilter?.value, 64) || "pnl_desc"
renderSentinelPositions()
})

els.refreshSentinelPositionsButton?.addEventListener("click", async () => {
beginLoading()

try {
syncSentinelFiltersFromInputs()
await loadSentinelPositions({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel positions.", "bad")
} finally {
endLoading()
}
})

els.refreshSentinelAuditButton?.addEventListener("click", async () => {
beginLoading()

try {
syncSentinelFiltersFromInputs()
await loadSentinelAudit({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel audit.", "bad")
} finally {
endLoading()
}
})

els.refreshSentinelAdminAuditButton?.addEventListener("click", async () => {
beginLoading()

try {
syncSentinelFiltersFromInputs()
await loadSentinelAdminAudit({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel admin audit.", "bad")
} finally {
endLoading()
}
})
}

function initDefaults() {
if (els.sentinelSummaryPeriodFilter) {
els.sentinelSummaryPeriodFilter.value = state.sentinel.filters.summaryPeriod
}

if (els.sentinelSummaryDateInput) {
els.sentinelSummaryDateInput.value = state.sentinel.filters.summaryDate
}

if (els.sentinelStatsDateInput) {
els.sentinelStatsDateInput.value = state.sentinel.filters.statsDate
}

if (els.sentinelStatsModeFilter) {
els.sentinelStatsModeFilter.value = state.sentinel.filters.statsMode
}

if (els.sentinelPositionScopeFilter) {
els.sentinelPositionScopeFilter.value = state.sentinel.filters.positionScope
}

if (els.sentinelPositionStageFilter) {
els.sentinelPositionStageFilter.value = state.sentinel.filters.positionStage
}

if (els.sentinelPositionOutcomeFilter) {
els.sentinelPositionOutcomeFilter.value = state.sentinel.filters.positionOutcome
}

if (els.sentinelPositionSortFilter) {
els.sentinelPositionSortFilter.value = state.sentinel.filters.positionSort || "pnl_desc"
}

clearSentinelBanner()
updateSentinelPeriodCopy()
updateSentinelPortfolioSummary()
renderSentinelPositions()
renderSentinelAudit()
renderSentinelAdminAudit()
updateControlDisabledState()
refreshApiStatus()
applySentinelModeToUi("paper")
}

async function init() {
initDefaults()
bindActions()

syncSentinelFiltersFromInputs()

await loadSentinelBundle()
}

init().catch((error) => {
console.error("Failed to initialize Sentinel admin page", error)
setSentinelBanner(error?.message || "Failed to initialize Sentinel admin.", "bad")
})