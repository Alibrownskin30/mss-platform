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
status: null,
settings: null,
engine: null,
summary: null,
stats: null,
positions: [],
audit: [],
adminAudit: [],
filters: {
statsDate: new Date().toISOString().slice(0, 10),
statsMode: "paper",

positionScope: "open",
positionStage: "",
positionOutcome: "",
positionMode: "",
positionTokenId: "",
positionMintAddress: "",

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

caseLoadingCount: 0,
sentinelLoadingCount: 0,
}

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

sentinelPositionScopeFilter: document.getElementById("sentinelPositionScopeFilter"),
sentinelPositionStageFilter: document.getElementById("sentinelPositionStageFilter"),
sentinelPositionOutcomeFilter: document.getElementById("sentinelPositionOutcomeFilter"),
sentinelPositionsModeFilter: document.getElementById("sentinelPositionsModeFilter"),
sentinelPositionsTokenFilter: document.getElementById("sentinelPositionsTokenFilter"),
sentinelPositionsMintFilter: document.getElementById("sentinelPositionsMintFilter"),
refreshSentinelPositionsButton: document.getElementById("refreshSentinelPositionsButton"),
sentinelPositionsTableBody: document.getElementById("sentinelPositionsTableBody"),

sentinelAuditEventTypeFilter: document.getElementById("sentinelAuditEventTypeFilter"),
sentinelAuditDecisionFilter: document.getElementById("sentinelAuditDecisionFilter"),
sentinelAuditExecutionStatusFilter: document.getElementById(
"sentinelAuditExecutionStatusFilter"
),
sentinelAuditModeFilter: document.getElementById("sentinelAuditModeFilter"),
sentinelAuditTokenFilter: document.getElementById("sentinelAuditTokenFilter"),
sentinelAuditMintFilter: document.getElementById("sentinelAuditMintFilter"),
sentinelAuditActorTypeFilter: document.getElementById("sentinelAuditActorTypeFilter"),
sentinelAuditActorIdFilter: document.getElementById("sentinelAuditActorIdFilter"),
sentinelAuditReasonCodeFilter: document.getElementById("sentinelAuditReasonCodeFilter"),
refreshSentinelAuditButton: document.getElementById("refreshSentinelAuditButton"),
sentinelAuditTableBody: document.getElementById("sentinelAuditTableBody"),

sentinelMaxPositionsPerOperatorClusterInput: document.getElementById(
"sentinelMaxPositionsPerOperatorClusterInput"
),
sentinelMaxTokensPerHourInput: document.getElementById("sentinelMaxTokensPerHourInput"),
sentinelCooldownAfterCloseSecInput: document.getElementById(
"sentinelCooldownAfterCloseSecInput"
),
sentinelCooldownAfterInvalidationSecInput: document.getElementById(
"sentinelCooldownAfterInvalidationSecInput"
),
sentinelEarlyFailTimeoutSecInput: document.getElementById("sentinelEarlyFailTimeoutSecInput"),
sentinelWeakStallTimeoutSecInput: document.getElementById("sentinelWeakStallTimeoutSecInput"),
sentinelRunnerFailedBreakoutLimitInput: document.getElementById(
"sentinelRunnerFailedBreakoutLimitInput"
),
sentinelMaxContaminationRiskInput: document.getElementById(
"sentinelMaxContaminationRiskInput"
),
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
sentinelMaxInsiderSellScoreInput: document.getElementById(
"sentinelMaxInsiderSellScoreInput"
),
sentinelMaxLiquidityDecayScoreInput: document.getElementById(
"sentinelMaxLiquidityDecayScoreInput"
),
sentinelEnableMarketRegimeFilterInput: document.getElementById(
"sentinelEnableMarketRegimeFilterInput"
),
sentinelEnableOperatorFilterInput: document.getElementById(
"sentinelEnableOperatorFilterInput"
),
sentinelEnableHardRejectsInput: document.getElementById("sentinelEnableHardRejectsInput"),

sentinelEngineStartedValue: document.getElementById("sentinelEngineStartedValue"),
sentinelEngineRunningValue: document.getElementById("sentinelEngineRunningValue"),
sentinelLastTickStartedValue: document.getElementById("sentinelLastTickStartedValue"),
sentinelLastTickFinishedValue: document.getElementById("sentinelLastTickFinishedValue"),
sentinelLastErrorValue: document.getElementById("sentinelLastErrorValue"),
sentinelTickCountValue: document.getElementById("sentinelTickCountValue"),
sentinelSnapshotProviderValue: document.getElementById("sentinelSnapshotProviderValue"),
sentinelLastTickSummaryValue: document.getElementById("sentinelLastTickSummaryValue"),

sentinelAdminAuditActionFilter: document.getElementById("sentinelAdminAuditActionFilter"),
sentinelAdminAuditActorFilter: document.getElementById("sentinelAdminAuditActorFilter"),
sentinelAdminAuditTargetTypeFilter: document.getElementById(
"sentinelAdminAuditTargetTypeFilter"
),
refreshSentinelAdminAuditButton: document.getElementById(
"refreshSentinelAdminAuditButton"
),
sentinelAdminAuditTableBody: document.getElementById("sentinelAdminAuditTableBody"),
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value
const normalized = cleanText(value, 16).toLowerCase()
if (normalized === "true" || normalized === "1" || normalized === "yes") return true
if (normalized === "false" || normalized === "0" || normalized === "no") return false
return fallback
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

function formatPercent(value, fractionDigits = 1) {
const num = Number(value)
if (!Number.isFinite(num)) return "0%"
return `${num.toFixed(fractionDigits)}%`
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

if (
hostname === "127.0.0.1" ||
hostname === "localhost" ||
hostname === "[::1]"
) {
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

return `${window.location.origin}`
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
throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`)
}

return payload
}

function setCaseBanner(message = "", variant = "warn") {
if (!els.banner) return
els.banner.textContent = message || ""
els.banner.className = "banner"
if (message) {
els.banner.classList.add("show")
els.banner.classList.add(variant)
}
}

function clearCaseBanner() {
if (!els.banner) return
els.banner.className = "banner"
els.banner.textContent = ""
}

function setSentinelBanner(message = "", variant = "warn") {
if (!els.sentinelBanner) return
els.sentinelBanner.textContent = message || ""
els.sentinelBanner.className = "banner"
if (message) {
els.sentinelBanner.classList.add("show")
els.sentinelBanner.classList.add(variant)
}
}

function clearSentinelBanner() {
if (!els.sentinelBanner) return
els.sentinelBanner.className = "banner"
els.sentinelBanner.textContent = ""
}

function isCasesLoading() {
return state.caseLoadingCount > 0
}

function isSentinelLoading() {
return state.sentinelLoadingCount > 0
}

function refreshApiStatus() {
if (els.apiStatusChip) {
els.apiStatusChip.textContent =
isCasesLoading() || isSentinelLoading() ? "Loading" : "Ready"
}
}

function updateCaseControlDisabledState() {
const disabled = isCasesLoading()
;[
els.refreshCasesButton,
els.applyFiltersButton,
els.approveCaseButton,
els.rejectCaseButton,
els.freezeCaseButton,
els.escalateCaseButton,
els.assignCaseButton,
].forEach((button) => {
if (button) button.disabled = disabled
})
}

function updateSentinelControlDisabledState() {
const disabled = isSentinelLoading()
;[
els.refreshSentinelButton,
els.saveSentinelSettingsButton,
els.sentinelModePaperButton,
els.sentinelModeArmedButton,
els.sentinelModeLiveButton,
els.sentinelEmergencyStopButton,
els.refreshSentinelStatsButton,
els.refreshSentinelPositionsButton,
els.refreshSentinelAuditButton,
els.refreshSentinelAdminAuditButton,
].forEach((button) => {
if (button) button.disabled = disabled
})
}

function beginCasesLoading() {
state.caseLoadingCount += 1
refreshApiStatus()
updateCaseControlDisabledState()
}

function endCasesLoading() {
state.caseLoadingCount = Math.max(0, state.caseLoadingCount - 1)
refreshApiStatus()
updateCaseControlDisabledState()
}

function beginSentinelLoading() {
state.sentinelLoadingCount += 1
refreshApiStatus()
updateSentinelControlDisabledState()
}

function endSentinelLoading() {
state.sentinelLoadingCount = Math.max(0, state.sentinelLoadingCount - 1)
refreshApiStatus()
updateSentinelControlDisabledState()
}

function getStatusVariant(status) {
const normalized = cleanText(status, 32).toLowerCase()
if (normalized === "approved") return "good"
if (normalized === "rejected" || normalized === "restricted" || normalized === "frozen") {
return "bad"
}
return "warn"
}

function getRiskVariant(riskLevel) {
const normalized = cleanText(riskLevel, 32).toLowerCase()
if (normalized === "low") return "good"
if (normalized === "critical" || normalized === "high") return "bad"
return "warn"
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

function createPill(text, variant = "neutral") {
const span = document.createElement("span")
span.className = `pill ${variant}`
span.textContent = text
return span
}

function renderTableEmpty(tbody, colspan, message) {
if (!tbody) return
tbody.innerHTML = ""
const row = document.createElement("tr")
const td = document.createElement("td")
td.colSpan = colspan
td.style.padding = "24px"
td.style.color = "var(--muted)"
td.style.textAlign = "center"
td.textContent = message
row.appendChild(td)
tbody.appendChild(row)
}

function getSelectedCase() {
if (!state.selectedCaseId) return null
return state.cases.find((item) => Number(item.id) === Number(state.selectedCaseId)) || null
}

function updateComplianceSummary() {
const openLike = state.cases.filter((item) =>
["open", "pending_info"].includes(cleanText(item.status, 32).toLowerCase())
).length

const escalatedLike = state.cases.filter((item) =>
["escalated", "frozen"].includes(cleanText(item.status, 32).toLowerCase())
).length

const resolvedLike = state.cases.filter((item) =>
["approved", "rejected"].includes(cleanText(item.status, 32).toLowerCase())
).length

if (els.queueCountChip) {
els.queueCountChip.textContent = `${state.cases.length} case${state.cases.length === 1 ? "" : "s"}`
}
if (els.openCountValue) els.openCountValue.textContent = String(openLike)
if (els.escalatedCountValue) els.escalatedCountValue.textContent = String(escalatedLike)
if (els.resolvedCountValue) els.resolvedCountValue.textContent = String(resolvedLike)

const filterParts = []
if (state.filters.status) filterParts.push(`status:${state.filters.status}`)
if (state.filters.caseType) filterParts.push(`type:${state.filters.caseType}`)
if (state.filters.riskLevel) filterParts.push(`risk:${state.filters.riskLevel}`)
if (state.filters.assignedTo) filterParts.push(`assigned:${state.filters.assignedTo}`)
if (els.heroFilterValue) {
els.heroFilterValue.textContent = filterParts.length ? filterParts.join(" • ") : "All cases"
}

const selected = getSelectedCase()
if (els.heroSelectedValue) {
els.heroSelectedValue.textContent = selected
? `#${selected.id} ${cleanText(selected.case_type, 40)}`
: "None selected"
}

if (els.heroReviewStateValue) {
els.heroReviewStateValue.textContent = selected
? cleanText(selected.status, 40) || "Selected"
: state.cases.length
? "Queue loaded"
: "No cases loaded"
}
}

function applySentinelModeToUi(mode) {
const label = titleCase(mode || "paper") || "Paper"
if (els.sentinelModeChip) els.sentinelModeChip.textContent = label
if (els.heroSentinelModeValue) els.heroSentinelModeValue.textContent = label
if (els.sentinelCurrentModeValue) els.sentinelCurrentModeValue.textContent = label

const modeButtons = [
{ el: els.sentinelModePaperButton, mode: "paper", base: "button-secondary" },
{ el: els.sentinelModeArmedButton, mode: "armed_mainnet", base: "button-secondary" },
{ el: els.sentinelModeLiveButton, mode: "live_mainnet", base: "button-secondary" },
{ el: els.sentinelEmergencyStopButton, mode: "emergency_stop", base: "button-danger" },
]

modeButtons.forEach(({ el, mode: buttonMode, base }) => {
if (!el) return
if (buttonMode === mode && buttonMode !== "emergency_stop") {
el.className = "button button-primary"
} else if (buttonMode === mode && buttonMode === "emergency_stop") {
el.className = "button button-danger"
} else {
el.className = `button ${base}`
}
})
}

function applySentinelSettingsToInputs(settings) {
if (!settings) return

state.sentinel.settings = settings

setValue(els.sentinelScoutUsdInput, safeNumber(settings.scout_usd, 0.5))
setValue(els.sentinelSniperAddUsdInput, safeNumber(settings.sniper_add_usd, 1))
setValue(
els.sentinelMaxTotalPositionUsdInput,
safeNumber(settings.max_total_position_usd, 1.5)
)
setValue(els.sentinelMaxOpenPositionsInput, safeNumber(settings.max_open_positions, 30))
setValue(els.sentinelMaxDailyLossUsdInput, safeNumber(settings.max_daily_loss_usd, 25))
setValue(
els.sentinelMaxConsecutiveFailuresInput,
safeNumber(settings.max_consecutive_failures, 8)
)
setValue(
els.sentinelMaxDailyScoutSpendUsdInput,
safeNumber(settings.max_daily_scout_spend_usd, 20)
)
setValue(
els.sentinelMaxDailySniperSpendUsdInput,
safeNumber(settings.max_daily_sniper_spend_usd, 30)
)
setValue(els.sentinelAutoBankMultipleInput, safeNumber(settings.auto_bank_multiple, 10))
setValue(els.sentinelAutoBankFractionInput, safeNumber(settings.auto_bank_fraction, 0.5))
setValue(
els.sentinelMinOperatorQualityScoreInput,
safeNumber(settings.min_operator_quality_score, 70)
)
setValue(
els.sentinelMaxHiddenControlRiskInput,
safeNumber(settings.max_hidden_control_risk, 30)
)
setValue(
els.sentinelMinRegimeScoreScoutInput,
safeNumber(settings.min_regime_score_for_scout, 55)
)
setValue(
els.sentinelMinRegimeScoreSniperInput,
safeNumber(settings.min_regime_score_for_sniper, 65)
)
setValue(
els.sentinelMinReclaimStrengthScoreInput,
safeNumber(settings.min_reclaim_strength_score, 60)
)
setValue(
els.sentinelMinBuyPressureScoreInput,
safeNumber(settings.min_buy_pressure_score, 62)
)
setValue(
els.sentinelMinPersistenceScoreInput,
safeNumber(settings.min_persistence_score, 58)
)
setValue(
els.sentinelMinPostEntryHealthScoreInput,
safeNumber(settings.min_post_entry_health_score, 55)
)

setBoolSelect(els.sentinelWatcherEnabledInput, settings.watcher_enabled)
setBoolSelect(els.sentinelAutoBankEnabledInput, settings.auto_bank_enabled)
setBoolSelect(els.sentinelEnableScoutInput, settings.enable_scout)
setBoolSelect(els.sentinelEnableSniperInput, settings.enable_sniper)
setBoolSelect(
els.sentinelEnableRunnerManagementInput,
settings.enable_runner_management
)
setBoolSelect(
els.sentinelRiskOffDisableNewEntriesInput,
settings.risk_off_disable_new_entries
)

setValue(
els.sentinelMaxPositionsPerOperatorClusterInput,
safeNumber(settings.max_positions_per_operator_cluster, 2)
)
setValue(els.sentinelMaxTokensPerHourInput, safeNumber(settings.max_tokens_per_hour, 12))
setValue(
els.sentinelCooldownAfterCloseSecInput,
safeNumber(settings.cooldown_after_close_sec, 1800)
)
setValue(
els.sentinelCooldownAfterInvalidationSecInput,
safeNumber(settings.cooldown_after_invalidation_sec, 3600)
)
setValue(
els.sentinelEarlyFailTimeoutSecInput,
safeNumber(settings.early_fail_timeout_sec, 180)
)
setValue(
els.sentinelWeakStallTimeoutSecInput,
safeNumber(settings.weak_stall_timeout_sec, 420)
)
setValue(
els.sentinelRunnerFailedBreakoutLimitInput,
safeNumber(settings.runner_failed_breakout_limit, 2)
)
setValue(
els.sentinelMaxContaminationRiskInput,
safeNumber(settings.max_contamination_risk, 35)
)
setValue(
els.sentinelMaxWalletCoordinationRiskInput,
safeNumber(settings.max_wallet_coordination_risk, 40)
)
setValue(
els.sentinelMaxTopHolderPctInput,
safeNumber(settings.max_top_holder_pct, 18)
)
setValue(
els.sentinelMaxTop5HolderPctInput,
safeNumber(settings.max_top_5_holder_pct, 45)
)
setValue(els.sentinelMinLiquidityUsdInput, safeNumber(settings.min_liquidity_usd, 800))
setValue(els.sentinelMaxSpreadBpsInput, safeNumber(settings.max_spread_bps, 350))
setValue(
els.sentinelMaxPriceImpactBpsInput,
safeNumber(settings.max_price_impact_bps, 500)
)
setValue(
els.sentinelMaxVerticalExtensionScoreForAddInput,
safeNumber(settings.max_vertical_extension_score_for_add, 75)
)
setValue(
els.sentinelMaxInsiderSellScoreInput,
safeNumber(settings.max_insider_sell_score, 45)
)
setValue(
els.sentinelMaxLiquidityDecayScoreInput,
safeNumber(settings.max_liquidity_decay_score, 50)
)
setBoolSelect(
els.sentinelEnableMarketRegimeFilterInput,
settings.enable_market_regime_filter
)
setBoolSelect(els.sentinelEnableOperatorFilterInput, settings.enable_operator_filter)
setBoolSelect(els.sentinelEnableHardRejectsInput, settings.enable_hard_rejects)

if (els.sentinelWatcherEnabledValue) {
els.sentinelWatcherEnabledValue.textContent = settings.watcher_enabled ? "Yes" : "No"
}
if (els.sentinelKillSwitchValue) {
els.sentinelKillSwitchValue.textContent =
cleanText(settings.execution_mode, 64) === "emergency_stop" ? "Active" : "Inactive"
}

applySentinelModeToUi(settings.execution_mode || "paper")
}

function renderSentinelSummary(summary, engine = null) {
state.sentinel.summary = summary || null
state.sentinel.engine = engine || state.sentinel.engine

const openPositions = safeNumber(summary?.open_positions, 0)
const realized = safeNumber(summary?.daily_realized_pnl_usd, 0)
const unrealized = safeNumber(summary?.daily_unrealized_pnl_usd, 0)
const dailyLoss = safeNumber(summary?.daily_loss_usd, 0)

if (els.sentinelOpenPositionsHeroValue) {
els.sentinelOpenPositionsHeroValue.textContent = formatNumber(openPositions)
}

if (els.sentinelSummaryOpenPositions) {
els.sentinelSummaryOpenPositions.textContent = formatNumber(openPositions)
}
if (els.sentinelSummaryDailyRealizedPnl) {
els.sentinelSummaryDailyRealizedPnl.textContent = formatCurrency(realized)
}
if (els.sentinelSummaryDailyUnrealizedPnl) {
els.sentinelSummaryDailyUnrealizedPnl.textContent = formatCurrency(unrealized)
}
if (els.sentinelSummaryDailyLoss) {
els.sentinelSummaryDailyLoss.textContent = formatCurrency(dailyLoss)
}

if (summary?.execution_mode) {
applySentinelModeToUi(summary.execution_mode)
}

if (els.sentinelKillSwitchValue) {
els.sentinelKillSwitchValue.textContent = summary?.kill_switch_active ? "Active" : "Inactive"
}
}

function renderSentinelEngine(engine = null) {
state.sentinel.engine = engine || null

const currentMode =
cleanText(engine?.current_mode, 64) ||
cleanText(state.sentinel.summary?.execution_mode, 64) ||
cleanText(state.sentinel.settings?.execution_mode, 64) ||
"paper"

applySentinelModeToUi(currentMode)

setText(els.sentinelEngineStartedValue, engine ? (engine.started ? "Yes" : "No") : "—")
setText(els.sentinelEngineRunningValue, engine ? (engine.running ? "Yes" : "No") : "—")
setText(els.sentinelLastTickStartedValue, formatDateTime(engine?.last_tick_started_at))
setText(els.sentinelLastTickFinishedValue, formatDateTime(engine?.last_tick_finished_at))
setText(els.sentinelTickCountValue, formatNumber(engine?.tick_count, 0))
setText(
els.sentinelSnapshotProviderValue,
cleanText(engine?.snapshot_provider_name, 120) || "—"
)

const lastErrorText =
cleanText(engine?.last_error?.message, 500) ||
cleanText(engine?.last_error, 500) ||
"None"
setText(els.sentinelLastErrorValue, lastErrorText)

const lastTickSummary = engine?.last_tick_summary
if (els.sentinelLastTickSummaryValue) {
if (!lastTickSummary) {
els.sentinelLastTickSummaryValue.textContent = "—"
} else {
const summaryParts = []
if (lastTickSummary.total != null) summaryParts.push(`total:${lastTickSummary.total}`)
if (lastTickSummary.scout_entry != null) {
summaryParts.push(`scout:${lastTickSummary.scout_entry}`)
}
if (lastTickSummary.sniper_add != null) {
summaryParts.push(`sniper:${lastTickSummary.sniper_add}`)
}
if (lastTickSummary.partial_take_profit != null) {
summaryParts.push(`tp:${lastTickSummary.partial_take_profit}`)
}
if (lastTickSummary.full_exit != null) {
summaryParts.push(`exit:${lastTickSummary.full_exit}`)
}
if (lastTickSummary.reject != null) summaryParts.push(`reject:${lastTickSummary.reject}`)
if (lastTickSummary.watchlist != null) {
summaryParts.push(`watchlist:${lastTickSummary.watchlist}`)
}
if (lastTickSummary.hold != null) summaryParts.push(`hold:${lastTickSummary.hold}`)
if (lastTickSummary.kill_switch != null) {
summaryParts.push(`kill:${lastTickSummary.kill_switch}`)
}
if (lastTickSummary.error) {
summaryParts.push(`error:${cleanText(lastTickSummary.error, 80)}`)
}
els.sentinelLastTickSummaryValue.textContent = summaryParts.length
? summaryParts.join(" • ")
: stringifyCompact(lastTickSummary)
}
}
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

if (els.sentinelWatcherEnabledValue) {
els.sentinelWatcherEnabledValue.textContent = watcherEnabled ? "Yes" : "No"
}
}

function renderSentinelStats(stats) {
state.sentinel.stats = stats || null

if (els.sentinelStatsScoutsOpened) {
els.sentinelStatsScoutsOpened.textContent = formatNumber(stats?.scouts_opened, 0)
}
if (els.sentinelStatsSniperAdds) {
els.sentinelStatsSniperAdds.textContent = formatNumber(stats?.sniper_adds, 0)
}
if (els.sentinelStatsPositionsClosed) {
els.sentinelStatsPositionsClosed.textContent = formatNumber(stats?.positions_closed, 0)
}
if (els.sentinelStatsInvalidations) {
els.sentinelStatsInvalidations.textContent = formatNumber(stats?.invalidations, 0)
}
if (els.sentinelStatsConsecutiveFailures) {
els.sentinelStatsConsecutiveFailures.textContent = formatNumber(
stats?.consecutive_failures,
0
)
}
if (els.sentinelStatsReclaimSuccessRate) {
els.sentinelStatsReclaimSuccessRate.textContent = formatPercent(
stats?.reclaim_success_rate_pct,
1
)
}
if (els.sentinelStatsRecentRugRate) {
els.sentinelStatsRecentRugRate.textContent = formatPercent(stats?.recent_rug_rate_pct, 1)
}
if (els.sentinelStatsAvgMarketLiquidity) {
els.sentinelStatsAvgMarketLiquidity.textContent = formatCurrency(
stats?.avg_market_liquidity_usd
)
}
}

function renderSentinelPositions() {
const tbody = els.sentinelPositionsTableBody
if (!tbody) return

tbody.innerHTML = ""
if (!state.sentinel.positions.length) {
renderTableEmpty(
tbody,
9,
"No Sentinel positions found for the current filter set."
)
return
}

state.sentinel.positions.forEach((position) => {
const row = document.createElement("tr")

const tokenCell = document.createElement("td")
tokenCell.innerHTML = `
<div style="font-weight:700;">${cleanText(position.token_id, 120) || "—"}</div>
<div class="dim mono">${shortenWallet(position.mint_address)}</div>
<div class="dim">${cleanText(position.linked_operator_cluster_id, 80) || "No cluster"}</div>
`

const stageCell = document.createElement("td")
stageCell.appendChild(
createPill(
titleCase(position.stage || "unknown"),
getSentinelStageVariant(position.stage)
)
)

const modeCell = document.createElement("td")
modeCell.appendChild(
createPill(
titleCase(position.execution_mode || "paper"),
getSentinelModeVariant(position.execution_mode)
)
)

const costCell = document.createElement("td")
costCell.innerHTML = `
<div>${formatCurrency(position.total_cost_usd)}</div>
<div class="dim">Basis ${formatCurrency(position.remaining_cost_basis_usd)}</div>
`

const currentCell = document.createElement("td")
currentCell.textContent = formatCurrency(position.current_value_usd)

const realizedCell = document.createElement("td")
realizedCell.textContent = formatCurrency(position.realized_pnl_usd)

const unrealizedCell = document.createElement("td")
unrealizedCell.textContent = formatCurrency(position.unrealized_pnl_usd)

const bankedCell = document.createElement("td")
bankedCell.appendChild(
createPill(
position.has_banked_10x ? "Yes" : "No",
position.has_banked_10x ? "good" : "neutral"
)
)

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
<div style="font-weight:700;">${titleCase(event.event_type || "event")}</div>
<div class="dim">${event.position_id ? `Position #${event.position_id}` : ""}</div>
`

const decisionCell = document.createElement("td")
decisionCell.textContent = titleCase(event.decision || "—")

const modeCell = document.createElement("td")
modeCell.appendChild(
createPill(
titleCase(event.execution_mode || "—"),
getSentinelModeVariant(event.execution_mode)
)
)

const tokenCell = document.createElement("td")
tokenCell.innerHTML = `
<div>${cleanText(event.token_id, 120) || "—"}</div>
<div class="dim mono">${event.mint_address ? shortenWallet(event.mint_address) : "—"}</div>
`

const reasonsCell = document.createElement("td")
reasonsCell.textContent = cleanText(reasonText, 300)

const statusCell = document.createElement("td")
statusCell.appendChild(
createPill(
titleCase(event.execution_status || "unknown"),
getExecutionStatusVariant(event.execution_status)
)
)

;[timeCell, eventCell, decisionCell, modeCell, tokenCell, reasonsCell, statusCell].forEach(
(cell) => row.appendChild(cell)
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
<div style="font-weight:700;">${titleCase(entry.action || "event")}</div>
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
stateCell.textContent =
cleanText(stringifyCompact(entry.new_state_json || entry.old_state_json), 300) || "—"

;[timeCell, actionCell, actorCell, targetCell, detailsCell, stateCell].forEach((cell) =>
row.appendChild(cell)
)

tbody.appendChild(row)
})
}

function renderCasesTable() {
const tbody = els.casesTableBody
if (!tbody) return

tbody.innerHTML = ""

if (!state.cases.length) {
renderTableEmpty(
tbody,
7,
"No compliance cases found for the current filter set."
)
return
}

state.cases.forEach((item) => {
const row = document.createElement("tr")
if (Number(item.id) === Number(state.selectedCaseId)) {
row.classList.add("active")
}

const caseType = cleanText(item.case_type, 40) || "case"
const status = cleanText(item.status, 40) || "unknown"
const riskLevel = cleanText(item.risk_level, 40) || "low"
const wallet = cleanText(item.profile?.wallet_address, 200)
const launchName = cleanText(item.launch?.token_name, 120) || "—"
const launchSymbol = cleanText(item.launch?.symbol, 40)

const caseCell = document.createElement("td")
caseCell.innerHTML = `
<div style="font-weight:700;">#${item.id}</div>
<div class="dim">${caseType}</div>
`

const statusCell = document.createElement("td")
statusCell.appendChild(createPill(status, getStatusVariant(status)))

const riskCell = document.createElement("td")
riskCell.appendChild(createPill(riskLevel, getRiskVariant(riskLevel)))

const walletCell = document.createElement("td")
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
`

const launchCell = document.createElement("td")
launchCell.innerHTML = `
<div>${launchName}</div>
<div class="dim">${launchSymbol || "—"}</div>
`

const assignedCell = document.createElement("td")
assignedCell.innerHTML = `
<div>${cleanText(item.assigned_to, 120) || "Unassigned"}</div>
<div class="dim">${cleanText(item.approved_by, 120) || ""}</div>
`

const updatedCell = document.createElement("td")
updatedCell.innerHTML = `
<div>${formatDateTime(item.updated_at || item.created_at)}</div>
<div class="dim">${formatDateTime(item.created_at)}</div>
`

;[caseCell, statusCell, riskCell, walletCell, launchCell, assignedCell, updatedCell].forEach(
(cell) => row.appendChild(cell)
)

row.addEventListener("click", async () => {
await loadCaseDetail(item.id)
})

tbody.appendChild(row)
})
}

function renderCaseDetail(item) {
if (!item) {
if (els.caseDetailEmpty) els.caseDetailEmpty.style.display = "grid"
if (els.caseDetailPanel) els.caseDetailPanel.style.display = "none"
return
}

if (els.caseDetailEmpty) els.caseDetailEmpty.style.display = "none"
if (els.caseDetailPanel) els.caseDetailPanel.style.display = "grid"

setText(els.detailCaseId, `#${item.id}`)
setText(els.detailCaseType, cleanText(item.case_type, 40) || "—")
setText(els.detailStatus, cleanText(item.status, 40) || "—")
setText(
els.detailRisk,
`${cleanText(item.risk_level, 40) || "low"} / ${Number(item.risk_score || 0)}`
)

setText(els.detailReviewReason, cleanText(item.review_reason, 5000) || "—")

setText(els.detailWallet, cleanText(item.profile?.wallet_address, 200) || "—")
setText(els.detailProfileType, cleanText(item.profile?.profile_type, 40) || "—")
setText(els.detailProfileStatus, cleanText(item.profile?.status, 40) || "—")
setText(els.detailProfileRisk, cleanText(item.profile?.risk_rating, 40) || "—")
setText(els.detailCountry, cleanText(item.profile?.country_code, 20) || "—")
setText(
els.detailManualReview,
item.profile?.manual_review_required
? cleanText(item.profile?.manual_review_reason, 500) || "Required"
: "No"
)

const profileName =
cleanText(item.profile?.entity_name, 200) ||
cleanText(item.profile?.display_name, 200) ||
cleanText(item.profile?.legal_name, 200) ||
"—"
setText(els.detailProfileName, profileName)

const launchName = cleanText(item.launch?.token_name, 200)
const symbol = cleanText(item.launch?.symbol, 40)
setText(
els.detailLaunchName,
launchName ? `${launchName}${symbol ? ` (${symbol})` : ""}` : "—"
)

setText(els.detailLaunchStatus, cleanText(item.launch?.status, 80) || "—")
setText(els.detailLaunchTemplate, cleanText(item.launch?.template, 80) || "—")
setText(els.detailBuilderWallet, cleanText(item.launch?.builder_wallet, 200) || "—")

setValue(els.assignedToInput, cleanText(item.assigned_to, 120))
setValue(els.actionNotes, "")
setValue(
els.escalationRiskLevel,
cleanText(item.risk_level, 32).toLowerCase() || "high"
)
}

function buildCaseQueryString() {
const params = new URLSearchParams()

if (state.filters.status) params.set("status", state.filters.status)
if (state.filters.caseType) params.set("case_type", state.filters.caseType)
if (state.filters.riskLevel) params.set("risk_level", state.filters.riskLevel)
if (state.filters.assignedTo) params.set("assigned_to", state.filters.assignedTo)

return params.toString()
}

async function loadCases() {
beginCasesLoading()
try {
const queryString = buildCaseQueryString()
const payload = await apiFetch(
`/api/compliance-admin/cases${queryString ? `?${queryString}` : ""}`
)

state.cases = Array.isArray(payload?.cases) ? payload.cases : []

if (state.selectedCaseId) {
const stillExists = state.cases.some(
(item) => Number(item.id) === Number(state.selectedCaseId)
)
if (!stillExists) {
state.selectedCaseId = null
state.selectedCase = null
}
}

renderCasesTable()
updateComplianceSummary()

if (state.selectedCaseId) {
const selected = getSelectedCase()
if (selected) {
await loadCaseDetail(state.selectedCaseId, { quiet: true, manageLoading: false })
} else {
renderCaseDetail(null)
}
} else {
renderCaseDetail(null)
}

clearCaseBanner()
} catch (error) {
setCaseBanner(error?.message || "Failed to load compliance cases.", "bad")
} finally {
endCasesLoading()
}
}

async function loadCaseDetail(caseId, { quiet = false, manageLoading = true } = {}) {
if (!caseId) return

if (manageLoading) beginCasesLoading()
try {
const payload = await apiFetch(`/api/compliance-admin/cases/${encodeURIComponent(caseId)}`)
const item = payload?.case || null

if (!item) {
throw new Error("Case detail was empty.")
}

state.selectedCaseId = Number(caseId)
state.selectedCase = item

renderCasesTable()
renderCaseDetail(item)
updateComplianceSummary()

if (!quiet) clearCaseBanner()
} catch (error) {
if (!quiet) {
setCaseBanner(error?.message || "Failed to load case detail.", "bad")
}
} finally {
if (manageLoading) endCasesLoading()
}
}

function syncCaseFiltersFromInputs() {
state.filters.status = cleanText(els.filterStatus?.value, 32).toLowerCase()
state.filters.caseType = cleanText(els.filterCaseType?.value, 32).toLowerCase()
state.filters.riskLevel = cleanText(els.filterRiskLevel?.value, 32).toLowerCase()
state.filters.assignedTo = cleanText(els.filterAssignedTo?.value, 120)
}

function getActionNotes() {
return cleanText(els.actionNotes?.value, 2000)
}

function getActorId() {
return "admin"
}

async function postCaseAction(path, body = {}, successMessage = "Action completed.") {
if (!state.selectedCaseId) {
setCaseBanner("Select a compliance case first.", "warn")
return
}

beginCasesLoading()
try {
await apiFetch(
`/api/compliance-admin/cases/${encodeURIComponent(state.selectedCaseId)}${path}`,
{
method: "POST",
body: JSON.stringify(body),
}
)

await loadCases()
await loadCaseDetail(state.selectedCaseId, { quiet: true, manageLoading: false })
setCaseBanner(successMessage, "good")
} catch (error) {
setCaseBanner(error?.message || "Case action failed.", "bad")
} finally {
endCasesLoading()
}
}

async function loadSentinelStatus({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelLoading()
try {
const payload = await apiFetch(`/api/compliance-admin/sentinel/status`)
renderSentinelStatus(payload)
return payload
} finally {
if (manageLoading) endSentinelLoading()
}
}

function buildSentinelStatsQueryString() {
const params = new URLSearchParams()
if (state.sentinel.filters.statsDate) params.set("date", state.sentinel.filters.statsDate)
if (state.sentinel.filters.statsMode) params.set("mode", state.sentinel.filters.statsMode)
return params.toString()
}

async function loadSentinelStats({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelLoading()
try {
const queryString = buildSentinelStatsQueryString()
const payload = await apiFetch(
`/api/compliance-admin/sentinel/stats/daily${queryString ? `?${queryString}` : ""}`
)
renderSentinelStats(payload?.stats || null)
return payload?.stats || null
} finally {
if (manageLoading) endSentinelLoading()
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
if (manageLoading) beginSentinelLoading()
try {
const queryString = buildSentinelPositionsQueryString()
const payload = await apiFetch(
`/api/compliance-admin/sentinel/positions${queryString ? `?${queryString}` : ""}`
)
state.sentinel.positions = Array.isArray(payload?.positions) ? payload.positions : []
renderSentinelPositions()
return state.sentinel.positions
} finally {
if (manageLoading) endSentinelLoading()
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
if (manageLoading) beginSentinelLoading()
try {
const queryString = buildSentinelAuditQueryString()
const payload = await apiFetch(
`/api/compliance-admin/sentinel/audit${queryString ? `?${queryString}` : ""}`
)
state.sentinel.audit = Array.isArray(payload?.audit) ? payload.audit : []
renderSentinelAudit()
return state.sentinel.audit
} finally {
if (manageLoading) endSentinelLoading()
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
if (manageLoading) beginSentinelLoading()
try {
const queryString = buildSentinelAdminAuditQueryString()
const payload = await apiFetch(
`/api/compliance-admin/sentinel/admin-audit${queryString ? `?${queryString}` : ""}`
)
state.sentinel.adminAudit = Array.isArray(payload?.audit) ? payload.audit : []
renderSentinelAdminAudit()
return state.sentinel.adminAudit
} finally {
if (manageLoading) endSentinelLoading()
}
}

function syncSentinelFiltersFromInputs() {
state.sentinel.filters.statsDate =
cleanText(els.sentinelStatsDateInput?.value, 32) || new Date().toISOString().slice(0, 10)
state.sentinel.filters.statsMode =
cleanText(els.sentinelStatsModeFilter?.value, 64) || "paper"

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
state.sentinel.filters.positionTokenId = cleanText(
els.sentinelPositionsTokenFilter?.value,
255
)
state.sentinel.filters.positionMintAddress = cleanText(
els.sentinelPositionsMintFilter?.value,
255
)

state.sentinel.filters.auditEventType = cleanText(
els.sentinelAuditEventTypeFilter?.value,
64
).toLowerCase()
state.sentinel.filters.auditDecision = cleanText(
els.sentinelAuditDecisionFilter?.value,
64
).toLowerCase()
state.sentinel.filters.auditExecutionStatus = cleanText(
els.sentinelAuditExecutionStatusFilter?.value,
64
).toLowerCase()
state.sentinel.filters.auditMode = cleanText(
els.sentinelAuditModeFilter?.value,
64
).toLowerCase()
state.sentinel.filters.auditTokenId = cleanText(
els.sentinelAuditTokenFilter?.value,
255
)
state.sentinel.filters.auditMintAddress = cleanText(
els.sentinelAuditMintFilter?.value,
255
)
state.sentinel.filters.auditActorType = cleanText(
els.sentinelAuditActorTypeFilter?.value,
64
).toLowerCase()
state.sentinel.filters.auditActorId = cleanText(
els.sentinelAuditActorIdFilter?.value,
255
)
state.sentinel.filters.auditReasonCode = cleanText(
els.sentinelAuditReasonCodeFilter?.value,
128
)

state.sentinel.filters.adminAuditAction = cleanText(
els.sentinelAdminAuditActionFilter?.value,
120
)
state.sentinel.filters.adminAuditActorId = cleanText(
els.sentinelAdminAuditActorFilter?.value,
255
)
state.sentinel.filters.adminAuditTargetType = cleanText(
els.sentinelAdminAuditTargetTypeFilter?.value,
120
)
}

async function loadSentinelBundle({ showSuccess = false } = {}) {
beginSentinelLoading()
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
setSentinelBanner(
firstError?.message || "One or more Sentinel admin requests failed.",
"bad"
)
return
}

clearSentinelBanner()
if (showSuccess) {
setSentinelBanner("Sentinel data refreshed.", "good")
}
} catch (error) {
setSentinelBanner(error?.message || "Failed to load Sentinel data.", "bad")
} finally {
endSentinelLoading()
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
beginSentinelLoading()
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

const changedFields = Array.isArray(payload?.changed_fields)
? payload.changed_fields
: []
setSentinelBanner(
changedFields.length
? `Sentinel settings saved. Changed: ${changedFields.join(", ")}.`
: "Sentinel settings saved.",
"good"
)
} catch (error) {
setSentinelBanner(error?.message || "Failed to save Sentinel settings.", "bad")
} finally {
endSentinelLoading()
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
"Switch Sentinel Watcher into Armed Mainnet mode? This should only be done when controlled live arming is intended."
)
} else if (requestedMode === "live_mainnet") {
confirmed = window.confirm(
"Switch Sentinel Watcher into Live Mainnet mode? This enables live execution once backend execution routing is active."
)
} else if (requestedMode === "emergency_stop") {
confirmed = window.confirm(
"Activate Sentinel Emergency Stop? This should immediately stop new entries."
)
}

if (!confirmed) return

beginSentinelLoading()
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
endSentinelLoading()
}
}

function bindCaseActions() {
els.applyFiltersButton?.addEventListener("click", async () => {
syncCaseFiltersFromInputs()
await loadCases()
})

els.refreshCasesButton?.addEventListener("click", async () => {
await loadCases()
})

els.approveCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/approve",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case approved."
)
})

els.rejectCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/reject",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case rejected."
)
})

els.freezeCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/freeze",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case frozen."
)
})

els.escalateCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/escalate",
{
actor_id: getActorId(),
notes: getActionNotes(),
risk_level: cleanText(els.escalationRiskLevel?.value, 32).toLowerCase() || "high",
},
"Compliance case escalated."
)
})

els.assignCaseButton?.addEventListener("click", async () => {
const assignedTo = cleanText(els.assignedToInput?.value, 120)
if (!assignedTo) {
setCaseBanner("Enter an assignee before assigning the case.", "warn")
return
}

await postCaseAction(
"/assign",
{
actor_id: getActorId(),
assigned_to: assignedTo,
},
"Compliance case assigned."
)
})
}

function bindSentinelActions() {
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

els.refreshSentinelStatsButton?.addEventListener("click", async () => {
beginSentinelLoading()
try {
syncSentinelFiltersFromInputs()
await loadSentinelStats({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel stats.", "bad")
} finally {
endSentinelLoading()
}
})

els.refreshSentinelPositionsButton?.addEventListener("click", async () => {
beginSentinelLoading()
try {
syncSentinelFiltersFromInputs()
await loadSentinelPositions({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel positions.", "bad")
} finally {
endSentinelLoading()
}
})

els.refreshSentinelAuditButton?.addEventListener("click", async () => {
beginSentinelLoading()
try {
syncSentinelFiltersFromInputs()
await loadSentinelAudit({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel audit.", "bad")
} finally {
endSentinelLoading()
}
})

els.refreshSentinelAdminAuditButton?.addEventListener("click", async () => {
beginSentinelLoading()
try {
syncSentinelFiltersFromInputs()
await loadSentinelAdminAudit({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel admin audit.", "bad")
} finally {
endSentinelLoading()
}
})
}

function initDefaults() {
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
}

async function init() {
initDefaults()
bindCaseActions()
bindSentinelActions()

syncCaseFiltersFromInputs()
syncSentinelFiltersFromInputs()

await Promise.all([loadCases(), loadSentinelBundle()])
}

init().catch((error) => {
console.error("Failed to initialize compliance admin page", error)
setCaseBanner(error?.message || "Failed to initialize compliance admin page.", "bad")
setSentinelBanner(error?.message || "Failed to initialize Sentinel admin.", "bad")
})