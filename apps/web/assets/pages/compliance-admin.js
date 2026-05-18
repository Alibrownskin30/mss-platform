const todayIso = new Date().toISOString().slice(0, 10)

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

ui: {
activeAdminSection: "overview",
collapsedSections: new Set(),
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

sentinelAccess: {
summary: null,
codes: [],
redemptions: [],
entitlements: [],
selectedCodeId: null,
selectedCode: null,
selectedCodeRedemptions: [],
selectedCodeEntitlements: [],
filters: {
codeState: "",
codeType: "",
planKey: "",
boundUserId: "",
redemptionCode: "",
redemptionUserId: "",
redemptionStatus: "",
},
},

caseLoadingCount: 0,
sentinelLoadingCount: 0,
sentinelAccessLoadingCount: 0,
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
sentinelAccessBanner: document.getElementById("sentinelAccessBanner"),

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

sentinelSummaryPeriodFilter: document.getElementById("sentinelSummaryPeriodFilter"),
sentinelSummaryDateInput: document.getElementById("sentinelSummaryDateInput"),
refreshSentinelSummaryButton: document.getElementById("refreshSentinelSummaryButton"),
sentinelSummaryPeriodLabel: document.getElementById("sentinelSummaryPeriodLabel"),
sentinelSummaryPeriodRange: document.getElementById("sentinelSummaryPeriodRange"),

sentinelSummaryOpenPositions: document.getElementById("sentinelSummaryOpenPositions"),
sentinelSummaryDailyRealizedPnl: document.getElementById("sentinelSummaryDailyRealizedPnl"),
sentinelSummaryDailyUnrealizedPnl: document.getElementById(
"sentinelSummaryDailyUnrealizedPnl"
),
sentinelSummaryDailyLoss: document.getElementById("sentinelSummaryDailyLoss"),
sentinelSummaryOpenCapital: document.getElementById("sentinelSummaryOpenCapital"),
sentinelSummaryOpenValue: document.getElementById("sentinelSummaryOpenValue"),
sentinelSummaryTotalCapital: document.getElementById("sentinelSummaryTotalCapital"),
sentinelSummaryPortfolioPnl: document.getElementById("sentinelSummaryPortfolioPnl"),

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
sentinelPositionSortFilter: document.getElementById("sentinelPositionSortFilter"),
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

refreshSentinelAccessAdminButton: document.getElementById("refreshSentinelAccessAdminButton"),
createSentinelAccessCodeButton: document.getElementById("createSentinelAccessCodeButton"),

sentinelAccessTotalCodesValue: document.getElementById("sentinelAccessTotalCodesValue"),
sentinelAccessActiveCodesValue: document.getElementById("sentinelAccessActiveCodesValue"),
sentinelAccessRedeemedCodesValue: document.getElementById("sentinelAccessRedeemedCodesValue"),
sentinelAccessLiveEntitlementsValue: document.getElementById("sentinelAccessLiveEntitlementsValue"),

sentinelAccessCustomCodeInput: document.getElementById("sentinelAccessCustomCodeInput"),
sentinelAccessCodeTypeInput: document.getElementById("sentinelAccessCodeTypeInput"),
sentinelAccessMaxRedemptionsInput: document.getElementById("sentinelAccessMaxRedemptionsInput"),
sentinelAccessPlanKeyInput: document.getElementById("sentinelAccessPlanKeyInput"),
sentinelAccessPlanLabelInput: document.getElementById("sentinelAccessPlanLabelInput"),
sentinelAccessDurationDaysInput: document.getElementById("sentinelAccessDurationDaysInput"),
sentinelAccessBoundUserIdInput: document.getElementById("sentinelAccessBoundUserIdInput"),
sentinelAccessStartsAtInput: document.getElementById("sentinelAccessStartsAtInput"),
sentinelAccessExpiresAtInput: document.getElementById("sentinelAccessExpiresAtInput"),
sentinelAccessCreatedByUserIdInput: document.getElementById("sentinelAccessCreatedByUserIdInput"),
sentinelAccessNotesInput: document.getElementById("sentinelAccessNotesInput"),
sentinelAccessGeneratedCodeValue: document.getElementById("sentinelAccessGeneratedCodeValue"),
sentinelAccessActorIdInput: document.getElementById("sentinelAccessActorIdInput"),

sentinelAccessCodesActiveFilter: document.getElementById("sentinelAccessCodesActiveFilter"),
sentinelAccessCodesTypeFilter: document.getElementById("sentinelAccessCodesTypeFilter"),
sentinelAccessCodesPlanFilter: document.getElementById("sentinelAccessCodesPlanFilter"),
sentinelAccessCodesBoundUserFilter: document.getElementById("sentinelAccessCodesBoundUserFilter"),
refreshSentinelAccessCodesButton: document.getElementById("refreshSentinelAccessCodesButton"),
sentinelAccessCodesTableBody: document.getElementById("sentinelAccessCodesTableBody"),

sentinelAccessRedemptionsCodeFilter: document.getElementById("sentinelAccessRedemptionsCodeFilter"),
sentinelAccessRedemptionsUserFilter: document.getElementById("sentinelAccessRedemptionsUserFilter"),
sentinelAccessRedemptionsStatusFilter: document.getElementById("sentinelAccessRedemptionsStatusFilter"),
refreshSentinelAccessRedemptionsButton: document.getElementById(
"refreshSentinelAccessRedemptionsButton"
),
sentinelAccessRedemptionsTableBody: document.getElementById(
"sentinelAccessRedemptionsTableBody"
),

sentinelAccessCodeDetailEmpty: document.getElementById("sentinelAccessCodeDetailEmpty"),
sentinelAccessCodeDetailPanel: document.getElementById("sentinelAccessCodeDetailPanel"),

sentinelAccessDetailCodeId: document.getElementById("sentinelAccessDetailCodeId"),
sentinelAccessDetailCodeValue: document.getElementById("sentinelAccessDetailCodeValue"),
sentinelAccessDetailCodeType: document.getElementById("sentinelAccessDetailCodeType"),
sentinelAccessDetailCodeState: document.getElementById("sentinelAccessDetailCodeState"),
sentinelAccessDetailPlanKey: document.getElementById("sentinelAccessDetailPlanKey"),
sentinelAccessDetailPlanLabel: document.getElementById("sentinelAccessDetailPlanLabel"),
sentinelAccessDetailDurationDays: document.getElementById("sentinelAccessDetailDurationDays"),
sentinelAccessDetailMaxRedemptions: document.getElementById(
"sentinelAccessDetailMaxRedemptions"
),
sentinelAccessDetailRedeemedCount: document.getElementById(
"sentinelAccessDetailRedeemedCount"
),
sentinelAccessDetailBoundUserId: document.getElementById("sentinelAccessDetailBoundUserId"),
sentinelAccessDetailStartsAt: document.getElementById("sentinelAccessDetailStartsAt"),
sentinelAccessDetailExpiresAt: document.getElementById("sentinelAccessDetailExpiresAt"),
sentinelAccessDetailCreatedByUserId: document.getElementById(
"sentinelAccessDetailCreatedByUserId"
),
sentinelAccessDetailCreatedAt: document.getElementById("sentinelAccessDetailCreatedAt"),
sentinelAccessDetailUpdatedAt: document.getElementById("sentinelAccessDetailUpdatedAt"),
sentinelAccessDetailLatestRedemptionAt: document.getElementById(
"sentinelAccessDetailLatestRedemptionAt"
),
sentinelAccessDetailNotes: document.getElementById("sentinelAccessDetailNotes"),

sentinelAccessCodeActionActorIdInput: document.getElementById(
"sentinelAccessCodeActionActorIdInput"
),
sentinelAccessCodeActionNotesInput: document.getElementById(
"sentinelAccessCodeActionNotesInput"
),
sentinelAccessCopyCodeButton: document.getElementById("sentinelAccessCopyCodeButton"),
sentinelAccessDeactivateCodeButton: document.getElementById(
"sentinelAccessDeactivateCodeButton"
),
sentinelAccessActivateCodeButton: document.getElementById("sentinelAccessActivateCodeButton"),
sentinelAccessRefreshSelectedCodeButton: document.getElementById(
"sentinelAccessRefreshSelectedCodeButton"
),
}

const SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY = "mss_sentinel_access_admin_key"
let sentinelAccessAdminKeyPromptInFlight = null

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

function getStoredSentinelAccessAdminKey() {
const override = cleanText(window.__SENTINEL_ACCESS_ADMIN_KEY__ || "", 2000)
if (override) return override

try {
return cleanText(localStorage.getItem(SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY), 2000)
} catch {
return ""
}
}

function storeSentinelAccessAdminKey(value) {
try {
const clean = cleanText(value, 2000)
if (!clean) {
localStorage.removeItem(SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY)
return
}
localStorage.setItem(SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY, clean)
} catch {}
}

function requestSentinelAccessAdminKey() {
if (sentinelAccessAdminKeyPromptInFlight) {
return sentinelAccessAdminKeyPromptInFlight
}

sentinelAccessAdminKeyPromptInFlight = Promise.resolve().then(() => {
const entered = window.prompt("Enter Sentinel Access admin key")
const clean = cleanText(entered, 2000)
if (clean) {
storeSentinelAccessAdminKey(clean)
return clean
}
return ""
})

return sentinelAccessAdminKeyPromptInFlight.finally(() => {
sentinelAccessAdminKeyPromptInFlight = null
})
}

async function apiFetchSentinelAccessAdmin(path, options = {}, { retryOnUnauthorized = true } = {}) {
const storedKey = getStoredSentinelAccessAdminKey()
const headers = {
...(options.headers || {}),
}

if (storedKey) {
headers["x-admin-key"] = storedKey
}

try {
return await apiFetch(`/api/sentinel-access-admin${path}`, {
...options,
headers,
})
} catch (error) {
if (retryOnUnauthorized && error?.status === 401) {
storeSentinelAccessAdminKey("")
const retryKey = await requestSentinelAccessAdminKey()

if (!retryKey) {
throw new Error("Sentinel Access admin key is required.")
}

return apiFetch(`/api/sentinel-access-admin${path}`, {
...options,
headers: {
...(options.headers || {}),
"x-admin-key": retryKey,
},
})
}

throw error
}
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

function setSentinelAccessBanner(message = "", variant = "warn") {
if (!els.sentinelAccessBanner) return
els.sentinelAccessBanner.textContent = message || ""
els.sentinelAccessBanner.className = "banner"
if (message) {
els.sentinelAccessBanner.classList.add("show")
els.sentinelAccessBanner.classList.add(variant)
}
}

function clearSentinelAccessBanner() {
if (!els.sentinelAccessBanner) return
els.sentinelAccessBanner.className = "banner"
els.sentinelAccessBanner.textContent = ""
}

function isCasesLoading() {
return state.caseLoadingCount > 0
}

function isSentinelLoading() {
return state.sentinelLoadingCount > 0
}

function isSentinelAccessLoading() {
return state.sentinelAccessLoadingCount > 0
}

function refreshApiStatus() {
if (els.apiStatusChip) {
els.apiStatusChip.textContent =
isCasesLoading() || isSentinelLoading() || isSentinelAccessLoading()
? "Loading"
: "Ready"
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
els.refreshSentinelSummaryButton,
els.refreshSentinelStatsButton,
els.refreshSentinelPositionsButton,
els.refreshSentinelAuditButton,
els.refreshSentinelAdminAuditButton,
].forEach((button) => {
if (button) button.disabled = disabled
})
}

function updateSentinelAccessControlDisabledState() {
const disabled = isSentinelAccessLoading()
const hasSelectedCode = Boolean(state.sentinelAccess.selectedCodeId)

;[
els.refreshSentinelAccessAdminButton,
els.createSentinelAccessCodeButton,
els.refreshSentinelAccessCodesButton,
els.refreshSentinelAccessRedemptionsButton,
els.sentinelAccessCopyCodeButton,
els.sentinelAccessDeactivateCodeButton,
els.sentinelAccessActivateCodeButton,
els.sentinelAccessRefreshSelectedCodeButton,
].forEach((button) => {
if (button) button.disabled = disabled
})

if (els.sentinelAccessCopyCodeButton) {
els.sentinelAccessCopyCodeButton.disabled = disabled || !hasSelectedCode
}
if (els.sentinelAccessDeactivateCodeButton) {
els.sentinelAccessDeactivateCodeButton.disabled = disabled || !hasSelectedCode
}
if (els.sentinelAccessActivateCodeButton) {
els.sentinelAccessActivateCodeButton.disabled = disabled || !hasSelectedCode
}
if (els.sentinelAccessRefreshSelectedCodeButton) {
els.sentinelAccessRefreshSelectedCodeButton.disabled = disabled || !hasSelectedCode
}
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

function beginSentinelAccessLoading() {
state.sentinelAccessLoadingCount += 1
refreshApiStatus()
updateSentinelAccessControlDisabledState()
}

function endSentinelAccessLoading() {
state.sentinelAccessLoadingCount = Math.max(0, state.sentinelAccessLoadingCount - 1)
refreshApiStatus()
updateSentinelAccessControlDisabledState()
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

function getSentinelAccessStateVariant(codeState) {
const normalized = cleanText(codeState, 64).toLowerCase()
if (normalized === "active") return "good"
if (normalized === "scheduled" || normalized === "exhausted") return "warn"
if (normalized === "inactive") return "bad"
if (normalized === "expired") return "neutral"
return "neutral"
}

function getRedemptionStatusVariant(status) {
const normalized = cleanText(status, 64).toLowerCase()
if (normalized === "success") return "good"
if (normalized === "failed") return "bad"
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
span.className = `pill ${variant}`
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
td.style.color = "var(--muted)"
td.style.textAlign = "center"
td.textContent = message
row.appendChild(td)
tbody.appendChild(row)
}

function ensureSentinelEnhancementStyles() {
if (document.getElementById("sentinelPremiumEnhancementStyles")) return

const style = document.createElement("style")
style.id = "sentinelPremiumEnhancementStyles"
style.textContent = `
.mss-admin-command-center {
position: sticky;
top: 10px;
z-index: 25;
display: grid;
gap: 12px;
margin: 0 0 18px;
padding: 14px;
border: 1px solid rgba(99, 179, 237, 0.20);
border-radius: 22px;
background:
linear-gradient(135deg, rgba(2, 6, 23, 0.94), rgba(15, 23, 42, 0.78)),
radial-gradient(circle at top right, rgba(56, 189, 248, 0.14), transparent 42%);
box-shadow: 0 22px 60px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.06);
backdrop-filter: blur(18px);
}
.mss-admin-command-top {
display: flex;
align-items: center;
justify-content: space-between;
gap: 14px;
}
.mss-admin-command-title {
display: grid;
gap: 4px;
}
.mss-admin-command-eyebrow {
font-size: 10px;
letter-spacing: 0.18em;
font-weight: 900;
text-transform: uppercase;
color: var(--muted, rgba(226,232,240,0.68));
}
.mss-admin-command-heading {
font-size: 16px;
font-weight: 950;
letter-spacing: -0.02em;
color: var(--text, #f8fafc);
}
.mss-admin-command-subtitle {
font-size: 12px;
color: var(--muted, rgba(226,232,240,0.70));
}
.mss-admin-command-actions {
display: flex;
gap: 8px;
align-items: center;
flex-wrap: wrap;
justify-content: flex-end;
}
.mss-admin-tab-grid {
display: grid;
grid-template-columns: repeat(5, minmax(0, 1fr));
gap: 8px;
}
.mss-admin-tab {
border: 1px solid rgba(99, 179, 237, 0.18);
border-radius: 14px;
background: rgba(15, 23, 42, 0.62);
color: var(--muted, rgba(226,232,240,0.72));
padding: 11px 10px;
font-size: 11px;
font-weight: 900;
letter-spacing: 0.06em;
text-transform: uppercase;
cursor: pointer;
transition: border-color .16s ease, background .16s ease, color .16s ease, transform .16s ease;
}
.mss-admin-tab:hover {
border-color: rgba(99, 179, 237, 0.42);
background: rgba(30, 41, 59, 0.78);
color: var(--text, #f8fafc);
transform: translateY(-1px);
}
.mss-admin-tab.active {
border-color: rgba(56, 189, 248, 0.58);
background:
linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(20, 184, 166, 0.12)),
rgba(15, 23, 42, 0.84);
color: var(--text, #f8fafc);
box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 30px rgba(14, 165, 233, 0.12);
}
.mss-admin-section-highlight {
outline: 1px solid rgba(56, 189, 248, 0.42);
box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.08);
border-radius: 18px;
}
.mss-admin-collapse-button {
border: 1px solid rgba(99, 179, 237, 0.24);
border-radius: 999px;
background: rgba(2, 6, 23, 0.68);
color: var(--muted, rgba(226,232,240,0.72));
padding: 8px 11px;
font-size: 10px;
font-weight: 900;
letter-spacing: 0.12em;
text-transform: uppercase;
cursor: pointer;
}
.mss-admin-collapse-button:hover {
border-color: rgba(99, 179, 237, 0.46);
color: var(--text, #f8fafc);
}
.mss-admin-collapsed {
display: none !important;
}
.sentinel-enhanced-grid {
display: grid;
grid-template-columns: repeat(4, minmax(0, 1fr));
gap: 12px;
margin-top: 14px;
}
.sentinel-enhanced-card {
position: relative;
overflow: hidden;
padding: 16px;
border: 1px solid rgba(99, 179, 237, 0.22);
border-radius: 18px;
background:
linear-gradient(135deg, rgba(7, 16, 32, 0.94), rgba(13, 31, 58, 0.76)),
radial-gradient(circle at top right, rgba(79, 209, 197, 0.14), transparent 45%);
box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 46px rgba(0,0,0,0.22);
}
.sentinel-enhanced-card::after {
content: "";
position: absolute;
inset: auto -30px -48px auto;
width: 130px;
height: 130px;
border-radius: 999px;
background: rgba(56, 189, 248, 0.10);
filter: blur(10px);
}
.sentinel-enhanced-label {
position: relative;
z-index: 1;
font-size: 10px;
letter-spacing: 0.16em;
text-transform: uppercase;
color: var(--muted, rgba(226,232,240,0.68));
font-weight: 800;
}
.sentinel-enhanced-value {
position: relative;
z-index: 1;
margin-top: 8px;
font-size: 22px;
font-weight: 900;
letter-spacing: -0.03em;
color: var(--text, #f8fafc);
}
.sentinel-enhanced-subtitle {
position: relative;
z-index: 1;
margin-top: 6px;
font-size: 12px;
line-height: 1.35;
color: var(--muted, rgba(226,232,240,0.70));
}
.sentinel-summary-period-shell {
display: flex;
align-items: end;
justify-content: space-between;
gap: 14px;
margin: 14px 0;
padding: 14px;
border: 1px solid rgba(99, 179, 237, 0.18);
border-radius: 18px;
background:
linear-gradient(135deg, rgba(2, 6, 23, 0.84), rgba(15, 23, 42, 0.62)),
radial-gradient(circle at top right, rgba(56,189,248,0.12), transparent 46%);
}
.sentinel-summary-period-copy {
min-width: 220px;
}
.sentinel-summary-period-title {
font-size: 11px;
font-weight: 900;
text-transform: uppercase;
letter-spacing: 0.16em;
color: var(--muted, rgba(226,232,240,0.72));
}
.sentinel-summary-period-active {
margin-top: 6px;
font-size: 16px;
font-weight: 900;
color: var(--text, #f8fafc);
}
.sentinel-summary-period-range {
margin-top: 4px;
font-size: 12px;
color: var(--muted, rgba(226,232,240,0.66));
}
.sentinel-summary-period-controls {
display: flex;
align-items: end;
gap: 10px;
flex-wrap: wrap;
}
.sentinel-summary-period-field {
display: grid;
gap: 6px;
}
.sentinel-summary-period-field label {
font-size: 10px;
font-weight: 900;
letter-spacing: 0.14em;
text-transform: uppercase;
color: var(--muted, rgba(226,232,240,0.68));
}
.sentinel-summary-period-field select,
.sentinel-summary-period-field input {
min-width: 160px;
border: 1px solid rgba(99, 179, 237, 0.28);
border-radius: 12px;
background: rgba(2, 6, 23, 0.86);
color: var(--text, #f8fafc);
padding: 10px 12px;
font-weight: 800;
outline: none;
}
.sentinel-summary-period-field input {
min-width: 150px;
}
.sentinel-summary-period-button {
border: 1px solid rgba(99, 179, 237, 0.35);
border-radius: 12px;
background: rgba(14, 165, 233, 0.18);
color: var(--text, #f8fafc);
padding: 10px 14px;
font-weight: 900;
cursor: pointer;
}
.sentinel-summary-period-button:disabled {
opacity: 0.55;
cursor: not-allowed;
}
.pnl-good {
color: #35f2a9 !important;
text-shadow: 0 0 18px rgba(53, 242, 169, 0.20);
}
.pnl-bad {
color: #ff6b7a !important;
text-shadow: 0 0 18px rgba(255, 107, 122, 0.18);
}
.pnl-neutral {
color: var(--text, #e5e7eb) !important;
}
.sentinel-position-gain {
background: linear-gradient(90deg, rgba(16,185,129,0.08), transparent 52%);
}
.sentinel-position-loss {
background: linear-gradient(90deg, rgba(244,63,94,0.08), transparent 52%);
}
.sentinel-position-sort-shell {
display: flex;
justify-content: space-between;
align-items: center;
gap: 12px;
margin: 14px 0;
padding: 12px 14px;
border: 1px solid rgba(99, 179, 237, 0.18);
border-radius: 16px;
background: rgba(8, 18, 34, 0.72);
}
.sentinel-position-sort-title {
font-size: 11px;
font-weight: 900;
text-transform: uppercase;
letter-spacing: 0.15em;
color: var(--muted, rgba(226,232,240,0.72));
}
.sentinel-position-sort-select {
min-width: 220px;
border: 1px solid rgba(99, 179, 237, 0.28);
border-radius: 12px;
background: rgba(2, 6, 23, 0.86);
color: var(--text, #f8fafc);
padding: 10px 12px;
font-weight: 800;
outline: none;
}
.sentinel-pnl-stack {
display: grid;
gap: 4px;
}
.sentinel-pnl-main {
font-weight: 900;
letter-spacing: -0.02em;
}
.sentinel-pnl-sub {
font-size: 12px;
color: var(--muted, rgba(226,232,240,0.65));
}
@media (max-width: 1100px) {
.mss-admin-tab-grid {
grid-template-columns: repeat(2, minmax(0, 1fr));
}
.sentinel-enhanced-grid {
grid-template-columns: repeat(2, minmax(0, 1fr));
}
.sentinel-summary-period-shell {
align-items: stretch;
flex-direction: column;
}
}
@media (max-width: 720px) {
.mss-admin-command-center {
position: relative;
top: auto;
}
.mss-admin-command-top {
align-items: stretch;
flex-direction: column;
}
.mss-admin-command-actions {
justify-content: stretch;
}
.mss-admin-command-actions > * {
width: 100%;
}
.mss-admin-tab-grid {
grid-template-columns: 1fr;
}
.sentinel-enhanced-grid {
grid-template-columns: 1fr;
}
.sentinel-position-sort-shell {
align-items: stretch;
flex-direction: column;
}
.sentinel-position-sort-select {
width: 100%;
}
.sentinel-summary-period-controls {
display: grid;
grid-template-columns: 1fr;
}
.sentinel-summary-period-field select,
.sentinel-summary-period-field input,
.sentinel-summary-period-button {
width: 100%;
}
}
`
document.head.appendChild(style)
}

function getElementRoot(el) {
if (!el) return null

const root =
el.closest("[data-admin-section-root]") ||
el.closest("section") ||
el.closest(".admin-section") ||
el.closest(".admin-card") ||
el.closest(".panel") ||
el.closest(".card") ||
el.closest(".surface") ||
el.closest(".glass-panel") ||
el.closest(".compliance-panel") ||
el.closest(".stack") ||
el.parentElement

if (!root || root === document.body || root === document.documentElement) return null
return root
}

function uniqueElements(items = []) {
const seen = new Set()
const output = []

items.forEach((item) => {
if (!item || seen.has(item)) return
seen.add(item)
output.push(item)
})

return output
}

function getAdminSectionRoots() {
const overviewRoots = uniqueElements([
getElementRoot(els.sentinelBanner),
getElementRoot(els.refreshSentinelButton),
getElementRoot(els.sentinelSummaryOpenPositions),
getElementRoot(els.sentinelSummaryDailyRealizedPnl),
getElementRoot(els.sentinelEngineStartedValue),
])

const settingsRoots = uniqueElements([
getElementRoot(els.saveSentinelSettingsButton),
getElementRoot(els.sentinelScoutUsdInput),
getElementRoot(els.sentinelEnableScoutInput),
getElementRoot(els.sentinelMaxPositionsPerOperatorClusterInput),
])

const positionsAuditRoots = uniqueElements([
getElementRoot(els.sentinelPositionsTableBody),
getElementRoot(els.sentinelAuditTableBody),
getElementRoot(els.sentinelAdminAuditTableBody),
getElementRoot(els.refreshSentinelPositionsButton),
getElementRoot(els.refreshSentinelAuditButton),
getElementRoot(els.refreshSentinelAdminAuditButton),
])

const accessRoots = uniqueElements([
getElementRoot(els.sentinelAccessBanner),
getElementRoot(els.createSentinelAccessCodeButton),
getElementRoot(els.sentinelAccessCodesTableBody),
getElementRoot(els.sentinelAccessRedemptionsTableBody),
getElementRoot(els.sentinelAccessCodeDetailPanel),
])

const complianceRoots = uniqueElements([
getElementRoot(els.banner),
getElementRoot(els.casesTableBody),
getElementRoot(els.caseDetailPanel),
getElementRoot(els.applyFiltersButton),
])

return [
{
id: "overview",
label: "Sentinel Overview",
hint: "Status, mode, summary, engine health.",
roots: overviewRoots,
},
{
id: "settings",
label: "Sentinel Settings",
hint: "Risk controls, thresholds, mode changes.",
roots: settingsRoots,
},
{
id: "positions",
label: "Positions & Audit",
hint: "Open positions, PnL, event logs.",
roots: positionsAuditRoots,
},
{
id: "access",
label: "Access Codes",
hint: "Sentinel access codes and redemptions.",
roots: accessRoots,
},
{
id: "cases",
label: "Compliance Cases",
hint: "Manual review queue and actions.",
roots: complianceRoots,
},
]
}

function scrollToAdminSection(sectionId) {
const sections = getAdminSectionRoots()
const section = sections.find((item) => item.id === sectionId)
const target = section?.roots?.[0]
if (!target) return

state.ui.activeAdminSection = sectionId
updateAdminSectionTabs(sectionId)

document.querySelectorAll(".mss-admin-section-highlight").forEach((node) => {
node.classList.remove("mss-admin-section-highlight")
})

target.classList.add("mss-admin-section-highlight")
target.scrollIntoView({ behavior: "smooth", block: "start" })

window.setTimeout(() => {
target.classList.remove("mss-admin-section-highlight")
}, 1200)
}

function updateAdminSectionTabs(activeSectionId = state.ui.activeAdminSection) {
document.querySelectorAll("[data-mss-admin-tab]").forEach((button) => {
const id = button.getAttribute("data-mss-admin-tab")
button.classList.toggle("active", id === activeSectionId)
})
}

function toggleAdminSectionCollapse(sectionId) {
const sections = getAdminSectionRoots()
const section = sections.find((item) => item.id === sectionId)
if (!section) return

const isCollapsed = state.ui.collapsedSections.has(sectionId)
if (isCollapsed) {
state.ui.collapsedSections.delete(sectionId)
} else {
state.ui.collapsedSections.add(sectionId)
}

section.roots.forEach((root) => {
root.classList.toggle("mss-admin-collapsed", !isCollapsed)
})

const button = document.querySelector(`[data-mss-admin-collapse="${sectionId}"]`)
if (button) {
button.textContent = isCollapsed ? "Collapse Section" : "Expand Section"
}
}

function ensureComplianceAdminCommandCenter() {
if (document.getElementById("mssAdminCommandCenter")) {
updateAdminSectionTabs()
return
}

const sections = getAdminSectionRoots().filter((section) => section.roots.length)
if (!sections.length) return

const firstRoot = sections[0].roots[0]
const host = firstRoot?.parentElement || document.querySelector("main") || document.body
if (!host) return

const shell = document.createElement("div")
shell.id = "mssAdminCommandCenter"
shell.className = "mss-admin-command-center"

const top = document.createElement("div")
top.className = "mss-admin-command-top"

const title = document.createElement("div")
title.className = "mss-admin-command-title"
title.innerHTML = `
<div class="mss-admin-command-eyebrow">MSS Compliance Admin</div>
<div class="mss-admin-command-heading">Operational Command Center</div>
<div class="mss-admin-command-subtitle">Use the sections below to jump between Sentinel overview, controls, audit, access, and manual compliance cases.</div>
`

const actions = document.createElement("div")
actions.className = "mss-admin-command-actions"

const refreshAll = document.createElement("button")
refreshAll.type = "button"
refreshAll.className = "mss-admin-collapse-button"
refreshAll.textContent = "Refresh All"
refreshAll.addEventListener("click", async () => {
await Promise.allSettled([
loadCases(),
loadSentinelBundle({ showSuccess: true }),
loadSentinelAccessBundle({ showSuccess: true }),
])
})

const expandAll = document.createElement("button")
expandAll.type = "button"
expandAll.className = "mss-admin-collapse-button"
expandAll.textContent = "Expand All"
expandAll.addEventListener("click", () => {
state.ui.collapsedSections.clear()
getAdminSectionRoots().forEach((section) => {
section.roots.forEach((root) => root.classList.remove("mss-admin-collapsed"))
const button = document.querySelector(`[data-mss-admin-collapse="${section.id}"]`)
if (button) button.textContent = "Collapse Section"
})
})

actions.appendChild(refreshAll)
actions.appendChild(expandAll)

top.appendChild(title)
top.appendChild(actions)

const grid = document.createElement("div")
grid.className = "mss-admin-tab-grid"

sections.forEach((section) => {
const button = document.createElement("button")
button.type = "button"
button.className = "mss-admin-tab"
button.setAttribute("data-mss-admin-tab", section.id)
button.innerHTML = `
<div>${section.label}</div>
<div style="margin-top:4px;font-size:10px;font-weight:700;letter-spacing:0;text-transform:none;color:inherit;opacity:.72;">${section.hint}</div>
`
button.addEventListener("click", () => scrollToAdminSection(section.id))
grid.appendChild(button)
})

shell.appendChild(top)
shell.appendChild(grid)

host.insertBefore(shell, firstRoot)

updateAdminSectionTabs()
}

function ensureSectionCollapseButtons() {
const sections = getAdminSectionRoots()

sections.forEach((section) => {
const root = section.roots[0]
if (!root || root.querySelector?.(`[data-mss-admin-collapse="${section.id}"]`)) return

const button = document.createElement("button")
button.type = "button"
button.className = "mss-admin-collapse-button"
button.setAttribute("data-mss-admin-collapse", section.id)
button.textContent = state.ui.collapsedSections.has(section.id)
? "Expand Section"
: "Collapse Section"
button.addEventListener("click", () => toggleAdminSectionCollapse(section.id))

const header =
root.querySelector(".card-header") ||
root.querySelector(".panel-header") ||
root.querySelector("header") ||
null

if (header) {
header.appendChild(button)
} else {
root.insertBefore(button, root.firstChild)
}
})
}

function ensureComplianceAdminWorkspace() {
ensureSentinelEnhancementStyles()
ensureComplianceAdminCommandCenter()
ensureSectionCollapseButtons()
}

function createSentinelSummaryCard(id, label, subtitle) {
const card = document.createElement("div")
card.className = "sentinel-enhanced-card"

const labelEl = document.createElement("div")
labelEl.className = "sentinel-enhanced-label"
labelEl.textContent = label

const valueEl = document.createElement("div")
valueEl.className = "sentinel-enhanced-value"
valueEl.id = id
valueEl.textContent = "$0.00"

const subtitleEl = document.createElement("div")
subtitleEl.className = "sentinel-enhanced-subtitle"
subtitleEl.textContent = subtitle

card.appendChild(labelEl)
card.appendChild(valueEl)
card.appendChild(subtitleEl)

return { card, valueEl }
}

function getPeriodLabel(period) {
const normalized = cleanText(period, 32).toLowerCase()
if (normalized === "weekly") return "Weekly"
if (normalized === "monthly") return "Monthly"
if (normalized === "overall") return "Overall"
return "Daily"
}

function getPeriodSubtitle(period) {
const normalized = cleanText(period, 32).toLowerCase()
if (normalized === "weekly") return "Rolling 7-day Sentinel performance window."
if (normalized === "monthly") return "Rolling 30-day Sentinel performance window."
if (normalized === "overall") return "All-time Sentinel performance where records exist."
return "Selected UTC day Sentinel performance."
}

function updateSentinelPeriodCopy(summary = state.sentinel.summary || null) {
const period =
cleanText(summary?.selected_period, 32).toLowerCase() ||
cleanText(state.sentinel.filters.summaryPeriod, 32).toLowerCase() ||
"daily"

const label =
cleanText(summary?.selected_period_label, 80) ||
getPeriodLabel(period)

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

function ensureSentinelSummaryPeriodControls() {
if (!els.sentinelSummaryPeriodFilter) {
els.sentinelSummaryPeriodFilter = document.getElementById("sentinelSummaryPeriodFilter")
}
if (!els.sentinelSummaryDateInput) {
els.sentinelSummaryDateInput = document.getElementById("sentinelSummaryDateInput")
}
if (!els.refreshSentinelSummaryButton) {
els.refreshSentinelSummaryButton = document.getElementById("refreshSentinelSummaryButton")
}
if (!els.sentinelSummaryPeriodLabel) {
els.sentinelSummaryPeriodLabel = document.getElementById("sentinelSummaryPeriodLabel")
}
if (!els.sentinelSummaryPeriodRange) {
els.sentinelSummaryPeriodRange = document.getElementById("sentinelSummaryPeriodRange")
}

if (document.getElementById("sentinelSummaryPeriodShell")) return

const anchor =
els.sentinelSummaryOpenPositions?.closest(".stat-card") ||
els.sentinelSummaryDailyRealizedPnl?.closest(".stat-card") ||
els.sentinelSummaryDailyLoss?.closest(".stat-card") ||
els.sentinelWatcherEnabledValue?.closest(".stat-card") ||
els.sentinelOpenPositionsHeroValue?.closest(".stat-card")

const parent = anchor?.parentElement
if (!parent) return

const shell = document.createElement("div")
shell.id = "sentinelSummaryPeriodShell"
shell.className = "sentinel-summary-period-shell"

const copy = document.createElement("div")
copy.className = "sentinel-summary-period-copy"

const title = document.createElement("div")
title.className = "sentinel-summary-period-title"
title.textContent = "Sentinel Summary Window"

const active = document.createElement("div")
active.id = "sentinelSummaryPeriodLabel"
active.className = "sentinel-summary-period-active"
active.textContent = "Daily PnL"

const range = document.createElement("div")
range.id = "sentinelSummaryPeriodRange"
range.className = "sentinel-summary-period-range"
range.textContent = state.sentinel.filters.summaryDate

copy.appendChild(title)
copy.appendChild(active)
copy.appendChild(range)

const controls = document.createElement("div")
controls.className = "sentinel-summary-period-controls"

const periodField = document.createElement("div")
periodField.className = "sentinel-summary-period-field"

const periodLabel = document.createElement("label")
periodLabel.htmlFor = "sentinelSummaryPeriodFilter"
periodLabel.textContent = "Window"

const periodSelect = document.createElement("select")
periodSelect.id = "sentinelSummaryPeriodFilter"
periodSelect.innerHTML = `
<option value="daily">Daily</option>
<option value="weekly">Weekly</option>
<option value="monthly">Monthly</option>
<option value="overall">Overall</option>
`

periodField.appendChild(periodLabel)
periodField.appendChild(periodSelect)

const dateField = document.createElement("div")
dateField.className = "sentinel-summary-period-field"

const dateLabel = document.createElement("label")
dateLabel.htmlFor = "sentinelSummaryDateInput"
dateLabel.textContent = "Anchor Date"

const dateInput = document.createElement("input")
dateInput.id = "sentinelSummaryDateInput"
dateInput.type = "date"

dateField.appendChild(dateLabel)
dateField.appendChild(dateInput)

const button = document.createElement("button")
button.id = "refreshSentinelSummaryButton"
button.type = "button"
button.className = "sentinel-summary-period-button"
button.textContent = "Refresh Summary"

controls.appendChild(periodField)
controls.appendChild(dateField)
controls.appendChild(button)

shell.appendChild(copy)
shell.appendChild(controls)

parent.insertBefore(shell, anchor)

els.sentinelSummaryPeriodFilter = periodSelect
els.sentinelSummaryDateInput = dateInput
els.refreshSentinelSummaryButton = button
els.sentinelSummaryPeriodLabel = active
els.sentinelSummaryPeriodRange = range
}

function ensureSentinelEnhancementElements() {
ensureComplianceAdminWorkspace()
ensureSentinelSummaryPeriodControls()

if (!els.sentinelSummaryOpenCapital) {
els.sentinelSummaryOpenCapital = document.getElementById("sentinelSummaryOpenCapital")
}
if (!els.sentinelSummaryOpenValue) {
els.sentinelSummaryOpenValue = document.getElementById("sentinelSummaryOpenValue")
}
if (!els.sentinelSummaryTotalCapital) {
els.sentinelSummaryTotalCapital = document.getElementById("sentinelSummaryTotalCapital")
}
if (!els.sentinelSummaryPortfolioPnl) {
els.sentinelSummaryPortfolioPnl = document.getElementById("sentinelSummaryPortfolioPnl")
}

if (
!document.getElementById("sentinelEnhancedSummaryCards") &&
(els.sentinelSummaryDailyLoss || els.sentinelSummaryOpenPositions)
) {
const anchor =
els.sentinelSummaryDailyLoss?.closest(".stat-card") ||
els.sentinelSummaryDailyLoss?.parentElement ||
els.sentinelSummaryOpenPositions?.closest(".stat-card") ||
els.sentinelSummaryOpenPositions?.parentElement

if (anchor?.parentElement) {
const grid = document.createElement("div")
grid.id = "sentinelEnhancedSummaryCards"
grid.className = "sentinel-enhanced-grid"

const openCapital = createSentinelSummaryCard(
"sentinelSummaryOpenCapital",
"Open Capital at Risk",
"Remaining cost basis across currently loaded open positions."
)
const openValue = createSentinelSummaryCard(
"sentinelSummaryOpenValue",
"Current Open Value",
"Live paper value across currently loaded open positions."
)
const totalCapital = createSentinelSummaryCard(
"sentinelSummaryTotalCapital",
"Period Capital Deployed",
"Capital committed during the selected Sentinel summary window."
)
const portfolioPnl = createSentinelSummaryCard(
"sentinelSummaryPortfolioPnl",
"Selected Window PnL",
"Realized plus current open unrealized PnL for the selected window."
)

grid.appendChild(openCapital.card)
grid.appendChild(openValue.card)
grid.appendChild(totalCapital.card)
grid.appendChild(portfolioPnl.card)

anchor.parentElement.insertBefore(grid, anchor.nextSibling)

els.sentinelSummaryOpenCapital = openCapital.valueEl
els.sentinelSummaryOpenValue = openValue.valueEl
els.sentinelSummaryTotalCapital = totalCapital.valueEl
els.sentinelSummaryPortfolioPnl = portfolioPnl.valueEl
}
}

if (!els.sentinelPositionSortFilter) {
els.sentinelPositionSortFilter = document.getElementById("sentinelPositionSortFilter")
}

if (!els.sentinelPositionSortFilter && els.sentinelPositionsTableBody) {
const table = els.sentinelPositionsTableBody.closest("table")
const tableParent = table?.parentElement

if (table && tableParent && !document.getElementById("sentinelPositionSortShell")) {
const shell = document.createElement("div")
shell.id = "sentinelPositionSortShell"
shell.className = "sentinel-position-sort-shell"

const title = document.createElement("div")
title.className = "sentinel-position-sort-title"
title.textContent = "Position Intelligence View"

const select = document.createElement("select")
select.id = "sentinelPositionSortFilter"
select.className = "sentinel-position-sort-select"
select.innerHTML = `
<option value="pnl_desc">Highest gain first</option>
<option value="pnl_asc">Highest loss first</option>
<option value="pnl_pct_desc">Highest PnL % first</option>
<option value="pnl_pct_asc">Lowest PnL % first</option>
<option value="current_value_desc">Highest current value</option>
<option value="capital_desc">Highest capital at risk</option>
<option value="newest">Newest opened</option>
<option value="oldest">Oldest opened</option>
`

shell.appendChild(title)
shell.appendChild(select)
tableParent.insertBefore(shell, table)

els.sentinelPositionSortFilter = select
}
}
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
[
position.unrealized_pnl_usd,
position.unrealizedPnlUsd,
currentValue - costBasis,
],
0
)

const totalPnl = firstFiniteNumber(
[
position.total_pnl_usd,
position.totalPnlUsd,
realizedPnl + unrealizedPnl,
],
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
ensureSentinelEnhancementElements()

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
const normalizedMode = cleanText(mode, 64).toLowerCase() || "paper"
const label = titleCase(normalizedMode) || "Paper"

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
if (buttonMode === normalizedMode && buttonMode !== "emergency_stop") {
el.className = "button button-primary"
} else if (buttonMode === normalizedMode && buttonMode === "emergency_stop") {
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

function normalizeEngine(engine = null) {
if (!engine || typeof engine !== "object") return null

return {
started:
engine.started ??
engine.is_started ??
engine.engine_started ??
false,
running:
engine.running ??
engine.is_running ??
engine.engine_running ??
false,
tick_count:
engine.tick_count ??
engine.tickCount ??
engine.total_ticks ??
0,
snapshot_provider_name:
cleanText(
engine.snapshot_provider_name ||
engine.snapshotProviderName ||
engine.provider_name ||
engine.providerName,
120
) || null,
last_tick_started_at:
engine.last_tick_started_at ||
engine.lastTickStartedAt ||
null,
last_tick_finished_at:
engine.last_tick_finished_at ||
engine.lastTickFinishedAt ||
null,
last_error:
engine.last_error ||
engine.lastError ||
null,
last_tick_summary:
engine.last_tick_summary ||
engine.lastTickSummary ||
null,
current_mode:
cleanText(engine.current_mode || engine.currentMode, 64) || null,
}
}

function renderSentinelSummary(summary, engine = null) {
ensureSentinelEnhancementElements()

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
[
summary?.period_loss_usd,
pnl.loss_usd,
summary?.daily_loss_usd,
summary?.dailyLossUsd,
],
0
)

if (els.sentinelOpenPositionsHeroValue) {
els.sentinelOpenPositionsHeroValue.textContent = formatNumber(openPositions)
}

if (els.sentinelSummaryOpenPositions) {
els.sentinelSummaryOpenPositions.textContent = formatNumber(openPositions)
}
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

if (els.sentinelKillSwitchValue) {
els.sentinelKillSwitchValue.textContent =
Boolean(summary?.kill_switch_active ?? summary?.killSwitchActive) ? "Active" : "Inactive"
}

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
setText(
els.sentinelSnapshotProviderValue,
cleanText(normalized?.snapshot_provider_name, 120) || "—"
)

const lastErrorObject = normalized?.last_error
const lastErrorText =
cleanText(lastErrorObject?.message, 500) ||
cleanText(lastErrorObject, 500) ||
"None"
setText(els.sentinelLastErrorValue, lastErrorText)

const lastTickSummary = normalized?.last_tick_summary
if (els.sentinelLastTickSummaryValue) {
if (!lastTickSummary) {
els.sentinelLastTickSummaryValue.textContent = "—"
} else {
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

updateSentinelPortfolioSummary()
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

updateSentinelPortfolioSummary()
}

function renderSentinelPositions() {
ensureSentinelEnhancementElements()

const tbody = els.sentinelPositionsTableBody
if (!tbody) return

tbody.innerHTML = ""
if (!state.sentinel.positions.length) {
renderTableEmpty(
tbody,
9,
"No Sentinel positions found for the current filter set."
)
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
<div>${formatCurrency(metrics.totalCost)}</div>
<div class="dim">Basis ${formatCurrency(metrics.costBasis)}</div>
`

const currentCell = document.createElement("td")
currentCell.innerHTML = `
<div style="font-weight:900;">${formatCurrency(metrics.currentValue)}</div>
<div class="dim">${metrics.costBasis > 0 ? `${formatNumber(metrics.currentValue / metrics.costBasis, 2)}x basis` : "No basis"}</div>
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

const selected = getSelectedCase()
state.selectedCase = selected || null

renderCasesTable()
updateComplianceSummary()

if (state.selectedCaseId && selected) {
await loadCaseDetail(state.selectedCaseId, { quiet: true, manageLoading: false })
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

const caseId = state.selectedCaseId

beginCasesLoading()
try {
await apiFetch(
`/api/compliance-admin/cases/${encodeURIComponent(caseId)}${path}`,
{
method: "POST",
body: JSON.stringify(body),
}
)

await loadCases()

if (state.selectedCaseId && Number(state.selectedCaseId) === Number(caseId)) {
await loadCaseDetail(caseId, { quiet: true, manageLoading: false })
}

setCaseBanner(successMessage, "good")
} catch (error) {
setCaseBanner(error?.message || "Case action failed.", "bad")
} finally {
endCasesLoading()
}
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
if (manageLoading) beginSentinelLoading()

try {
const queryString = buildSentinelSummaryQueryString()
const payload = await apiFetchFirst([
`/api/compliance-admin/sentinel/status${queryString ? `?${queryString}` : ""}`,
])

renderSentinelStatus(payload)
return payload
} catch (primaryError) {
try {
const queryString = buildSentinelSummaryQueryString()
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
} catch {
throw primaryError
}
} finally {
if (manageLoading) endSentinelLoading()
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

if (state.sentinel.filters.statsMode) params.set("mode", state.sentinel.filters.statsMode)
return params.toString()
}

async function loadSentinelStats({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelLoading()
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
if (state.sentinel.filters.statsDate) fallbackParams.set("date", state.sentinel.filters.statsDate)
if (state.sentinel.filters.statsMode) fallbackParams.set("mode", state.sentinel.filters.statsMode)

const fallbackQueryString = fallbackParams.toString()
const payload = await apiFetch(
`/api/compliance-admin/sentinel/stats/daily${fallbackQueryString ? `?${fallbackQueryString}` : ""}`
)
renderSentinelStats(payload?.stats || null)
return payload?.stats || null
}
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
const payload = await apiFetchFirst([
`/api/compliance-admin/sentinel/admin-audit${queryString ? `?${queryString}` : ""}`,
`/api/compliance-admin/sentinel/audit/admin${queryString ? `?${queryString}` : ""}`,
])
state.sentinel.adminAudit = Array.isArray(payload?.audit) ? payload.audit : []
renderSentinelAdminAudit()
return state.sentinel.adminAudit
} finally {
if (manageLoading) endSentinelLoading()
}
}

function syncSentinelFiltersFromInputs() {
ensureSentinelEnhancementElements()

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
state.sentinel.filters.positionSort =
cleanText(els.sentinelPositionSortFilter?.value, 64) ||
state.sentinel.filters.positionSort ||
"pnl_desc"

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

function getSentinelAccessCodeState(code) {
const explicit = cleanText(code?.state, 64).toLowerCase()
if (explicit) return explicit

const isActive = Boolean(code?.is_active)
const redeemedCount = safeNumber(code?.redeemed_count, 0)
const maxRedemptions = safeNumber(code?.max_redemptions, 0)
const now = Date.now()

const startsAtTs = code?.starts_at ? new Date(code.starts_at).getTime() : null
const expiresAtTs = code?.expires_at ? new Date(code.expires_at).getTime() : null

if (!isActive) return "inactive"
if (startsAtTs && !Number.isNaN(startsAtTs) && startsAtTs > now) return "scheduled"
if (expiresAtTs && !Number.isNaN(expiresAtTs) && expiresAtTs <= now) return "expired"
if (maxRedemptions > 0 && redeemedCount >= maxRedemptions) return "exhausted"
return "active"
}

function isLiveEntitlement(entitlement) {
const status = cleanText(entitlement?.status, 64).toLowerCase()
if (status !== "active") return false

const now = Date.now()
const startsAt = entitlement?.starts_at ? new Date(entitlement.starts_at).getTime() : null
const endsAt = entitlement?.ends_at ? new Date(entitlement.ends_at).getTime() : null

if (startsAt && !Number.isNaN(startsAt) && startsAt > now) return false
if (endsAt && !Number.isNaN(endsAt) && endsAt <= now) return false

return true
}

function updateSentinelAccessSummary() {
const summary = state.sentinelAccess.summary || {}
const totalCodes = safeNumber(summary.total_codes, state.sentinelAccess.codes.length)
const activeCodes = safeNumber(summary.active_codes, 0)
const redeemedCount = safeNumber(summary.total_redemptions, 0)
const liveEntitlements = state.sentinelAccess.entitlements.filter(isLiveEntitlement).length

setText(els.sentinelAccessTotalCodesValue, formatNumber(totalCodes, 0))
setText(els.sentinelAccessActiveCodesValue, formatNumber(activeCodes, 0))
setText(els.sentinelAccessRedeemedCodesValue, formatNumber(redeemedCount, 0))
setText(els.sentinelAccessLiveEntitlementsValue, formatNumber(liveEntitlements, 0))
}

function renderSentinelAccessCodesTable() {
const tbody = els.sentinelAccessCodesTableBody
if (!tbody) return

tbody.innerHTML = ""

if (!state.sentinelAccess.codes.length) {
renderTableEmpty(tbody, 8, "No Sentinel access codes found for the current filter set.")
return
}

state.sentinelAccess.codes.forEach((code) => {
const row = document.createElement("tr")
if (Number(code.id) === Number(state.sentinelAccess.selectedCodeId)) {
row.classList.add("active")
}

const codeState = getSentinelAccessCodeState(code)

const codeCell = document.createElement("td")
codeCell.innerHTML = `
<div class="mono" style="font-weight:700;">${cleanText(code.code, 128) || "—"}</div>
<div class="dim">${cleanText(code.notes, 120) || ""}</div>
`

const typeCell = document.createElement("td")
typeCell.appendChild(
createPill(titleCase(code.code_type || "trial"), "neutral")
)

const planCell = document.createElement("td")
planCell.innerHTML = `
<div>${cleanText(code.plan_label, 120) || "—"}</div>
<div class="dim">${cleanText(code.plan_key, 120) || "—"}</div>
`

const stateCell = document.createElement("td")
stateCell.appendChild(
createPill(titleCase(codeState), getSentinelAccessStateVariant(codeState))
)

const usageCell = document.createElement("td")
const redeemedCount = safeNumber(code.redeemed_count, 0)
const maxRedemptions = safeNumber(code.max_redemptions, 0)
usageCell.innerHTML = `
<div>${formatNumber(redeemedCount, 0)} / ${formatNumber(maxRedemptions, 0)}</div>
<div class="dim">${formatNumber(Math.max(0, maxRedemptions - redeemedCount), 0)} remaining</div>
`

const boundCell = document.createElement("td")
boundCell.innerHTML = `
<div>${code.bound_user_id ? `#${code.bound_user_id}` : "Unbound"}</div>
<div class="dim">${cleanText(code.bound_user_email, 160) || ""}</div>
`

const windowCell = document.createElement("td")
windowCell.innerHTML = `
<div>${code.starts_at ? `Starts ${formatDateTime(code.starts_at)}` : "Starts immediately"}</div>
<div class="dim">${code.expires_at ? `Expires ${formatDateTime(code.expires_at)}` : "No absolute expiry"}</div>
`

const updatedCell = document.createElement("td")
updatedCell.innerHTML = `
<div>${formatDateTime(code.updated_at || code.created_at)}</div>
<div class="dim">${formatDateTime(code.created_at)}</div>
`

;[
codeCell,
typeCell,
planCell,
stateCell,
usageCell,
boundCell,
windowCell,
updatedCell,
].forEach((cell) => row.appendChild(cell))

row.addEventListener("click", async () => {
await loadSentinelAccessCodeDetail(code.id)
})

tbody.appendChild(row)
})
}

function renderSentinelAccessRedemptionsTable() {
const tbody = els.sentinelAccessRedemptionsTableBody
if (!tbody) return

tbody.innerHTML = ""

if (!state.sentinelAccess.redemptions.length) {
renderTableEmpty(
tbody,
6,
"No Sentinel access redemptions found for the current filter set."
)
return
}

state.sentinelAccess.redemptions.forEach((redemption) => {
const row = document.createElement("tr")

const redeemedAtCell = document.createElement("td")
redeemedAtCell.innerHTML = `
<div>${formatDateTime(redemption.redeemed_at || redemption.created_at)}</div>
<div class="dim">#${safeNumber(redemption.id, 0)}</div>
`

const codeCell = document.createElement("td")
codeCell.innerHTML = `
<div class="mono">${cleanText(redemption.code, 128) || "—"}</div>
<div class="dim">Code #${safeNumber(redemption.code_id, 0)}</div>
`

const userCell = document.createElement("td")
userCell.innerHTML = `
<div>${redemption.user_id ? `#${redemption.user_id}` : "—"}</div>
<div class="dim">${cleanText(redemption.user_email, 160) || ""}</div>
`

const entitlementCell = document.createElement("td")
entitlementCell.textContent = redemption.entitlement_id
? `#${redemption.entitlement_id}`
: "—"

const walletCell = document.createElement("td")
walletCell.innerHTML = `
<div class="mono">${redemption.wallet_address_at_redeem ? shortenWallet(redemption.wallet_address_at_redeem) : "—"}</div>
<div class="dim">${cleanText(redemption.wallet_address_at_redeem, 200) || ""}</div>
`

const statusCell = document.createElement("td")
statusCell.appendChild(
createPill(
titleCase(redemption.redemption_status || "unknown"),
getRedemptionStatusVariant(redemption.redemption_status)
)
)

;[
redeemedAtCell,
codeCell,
userCell,
entitlementCell,
walletCell,
statusCell,
].forEach((cell) => row.appendChild(cell))

tbody.appendChild(row)
})
}

function renderSentinelAccessCodeDetail(code, redemptions = [], entitlements = []) {
if (!code) {
if (els.sentinelAccessCodeDetailEmpty) els.sentinelAccessCodeDetailEmpty.style.display = "grid"
if (els.sentinelAccessCodeDetailPanel) els.sentinelAccessCodeDetailPanel.style.display = "none"
updateSentinelAccessControlDisabledState()
return
}

if (els.sentinelAccessCodeDetailEmpty) els.sentinelAccessCodeDetailEmpty.style.display = "none"
if (els.sentinelAccessCodeDetailPanel) els.sentinelAccessCodeDetailPanel.style.display = "grid"

const codeState = getSentinelAccessCodeState(code)
const latestRedemption =
arrayify(redemptions)
.slice()
.sort((a, b) => {
const aTs = new Date(a?.redeemed_at || a?.created_at || 0).getTime()
const bTs = new Date(b?.redeemed_at || b?.created_at || 0).getTime()
return bTs - aTs
})[0] || null

setText(els.sentinelAccessDetailCodeId, code.id ? `#${code.id}` : "—")
setText(els.sentinelAccessDetailCodeValue, cleanText(code.code, 128) || "—")
setText(els.sentinelAccessDetailCodeType, titleCase(code.code_type || "trial"))
setText(els.sentinelAccessDetailCodeState, titleCase(codeState))
setText(els.sentinelAccessDetailPlanKey, cleanText(code.plan_key, 120) || "—")
setText(els.sentinelAccessDetailPlanLabel, cleanText(code.plan_label, 120) || "—")
setText(
els.sentinelAccessDetailDurationDays,
formatNumber(code.duration_days, 0)
)
setText(
els.sentinelAccessDetailMaxRedemptions,
formatNumber(code.max_redemptions, 0)
)
setText(
els.sentinelAccessDetailRedeemedCount,
`${formatNumber(code.redeemed_count, 0)}${entitlements.length ? ` • ${entitlements.length} entitlement${entitlements.length === 1 ? "" : "s"}` : ""}`
)
setText(
els.sentinelAccessDetailBoundUserId,
code.bound_user_id
? `#${code.bound_user_id}${code.bound_user_email ? ` • ${code.bound_user_email}` : ""}`
: "Unbound"
)
setText(els.sentinelAccessDetailStartsAt, formatDateTime(code.starts_at))
setText(els.sentinelAccessDetailExpiresAt, formatDateTime(code.expires_at))
setText(
els.sentinelAccessDetailCreatedByUserId,
code.created_by_user_id ? `#${code.created_by_user_id}` : "—"
)
setText(els.sentinelAccessDetailCreatedAt, formatDateTime(code.created_at))
setText(els.sentinelAccessDetailUpdatedAt, formatDateTime(code.updated_at))
setText(
els.sentinelAccessDetailLatestRedemptionAt,
latestRedemption
? `${formatDateTime(latestRedemption.redeemed_at || latestRedemption.created_at)}${latestRedemption.user_id ? ` • #${latestRedemption.user_id}` : ""}`
: "—"
)
setText(els.sentinelAccessDetailNotes, cleanText(code.notes, 5000) || "—")

setValue(
els.sentinelAccessCodeActionActorIdInput,
cleanText(els.sentinelAccessCodeActionActorIdInput?.value, 120) ||
cleanText(els.sentinelAccessActorIdInput?.value, 120) ||
"admin"
)

updateSentinelAccessControlDisabledState()
}

function coerceDateTimeLocalToIso(value) {
const raw = cleanText(value, 120)
if (!raw) return null
const date = new Date(raw)
if (Number.isNaN(date.getTime())) return null
return date.toISOString()
}

function getSentinelAccessCreateActorId() {
return cleanText(els.sentinelAccessActorIdInput?.value, 120) || "admin"
}

function getSentinelAccessActionActorId() {
return cleanText(els.sentinelAccessCodeActionActorIdInput?.value, 120) || "admin"
}

function getSentinelAccessActionNotes() {
return cleanText(els.sentinelAccessCodeActionNotesInput?.value, 2000)
}

function syncSentinelAccessFiltersFromInputs() {
state.sentinelAccess.filters.codeState = cleanText(
els.sentinelAccessCodesActiveFilter?.value,
64
).toLowerCase()
state.sentinelAccess.filters.codeType = cleanText(
els.sentinelAccessCodesTypeFilter?.value,
64
).toLowerCase()
state.sentinelAccess.filters.planKey = cleanText(
els.sentinelAccessCodesPlanFilter?.value,
120
)
state.sentinelAccess.filters.boundUserId = cleanText(
els.sentinelAccessCodesBoundUserFilter?.value,
64
)

state.sentinelAccess.filters.redemptionCode = cleanText(
els.sentinelAccessRedemptionsCodeFilter?.value,
128
)
state.sentinelAccess.filters.redemptionUserId = cleanText(
els.sentinelAccessRedemptionsUserFilter?.value,
64
)
state.sentinelAccess.filters.redemptionStatus = cleanText(
els.sentinelAccessRedemptionsStatusFilter?.value,
64
).toLowerCase()
}

function filterSentinelAccessCodes(items) {
return arrayify(items).filter((code) => {
const codeState = getSentinelAccessCodeState(code)
const wantedState = cleanText(state.sentinelAccess.filters.codeState, 64).toLowerCase()
const wantedType = cleanText(state.sentinelAccess.filters.codeType, 64).toLowerCase()
const wantedPlan = cleanText(state.sentinelAccess.filters.planKey, 120).toLowerCase()
const wantedBoundUserId = cleanText(state.sentinelAccess.filters.boundUserId, 64)

if (wantedState === "active" && codeState !== "active") return false
if (wantedState === "inactive" && codeState === "active") return false

if (wantedType && cleanText(code.code_type, 64).toLowerCase() !== wantedType) return false

if (wantedPlan) {
const haystack = [
cleanText(code.plan_key, 120),
cleanText(code.plan_label, 120),
cleanText(code.code, 128),
]
.join(" ")
.toLowerCase()

if (!haystack.includes(wantedPlan)) return false
}

if (wantedBoundUserId && String(code.bound_user_id || "") !== wantedBoundUserId) {
return false
}

return true
})
}

function filterSentinelAccessRedemptions(items) {
return arrayify(items).filter((redemption) => {
const wantedCode = cleanText(state.sentinelAccess.filters.redemptionCode, 128).toLowerCase()
const wantedUserId = cleanText(state.sentinelAccess.filters.redemptionUserId, 64)
const wantedStatus = cleanText(state.sentinelAccess.filters.redemptionStatus, 64).toLowerCase()

if (wantedCode) {
const haystack = [
cleanText(redemption.code, 128),
cleanText(redemption.wallet_address_at_redeem, 200),
]
.join(" ")
.toLowerCase()

if (!haystack.includes(wantedCode)) return false
}

if (wantedUserId && String(redemption.user_id || "") !== wantedUserId) {
return false
}

if (
wantedStatus &&
cleanText(redemption.redemption_status, 64).toLowerCase() !== wantedStatus
) {
return false
}

return true
})
}

function buildSentinelAccessCodesQueryString() {
const params = new URLSearchParams()
if (state.sentinelAccess.filters.codeType) {
params.set("code_type", state.sentinelAccess.filters.codeType)
}
if (state.sentinelAccess.filters.boundUserId) {
params.set("bound_user_id", state.sentinelAccess.filters.boundUserId)
}
if (state.sentinelAccess.filters.planKey) {
params.set("search", state.sentinelAccess.filters.planKey)
}
params.set("limit", "500")
return params.toString()
}

function buildSentinelAccessRedemptionsQueryString() {
const params = new URLSearchParams()
if (state.sentinelAccess.filters.redemptionUserId) {
params.set("user_id", state.sentinelAccess.filters.redemptionUserId)
}
params.set("limit", "500")
return params.toString()
}

async function loadSentinelAccessSummary({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelAccessLoading()
try {
const payload = await apiFetchSentinelAccessAdmin("/summary")
state.sentinelAccess.summary = payload?.summary || null
updateSentinelAccessSummary()
return state.sentinelAccess.summary
} finally {
if (manageLoading) endSentinelAccessLoading()
}
}

async function loadSentinelAccessCodes({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelAccessLoading()
try {
const queryString = buildSentinelAccessCodesQueryString()
const payload = await apiFetchSentinelAccessAdmin(
`/codes${queryString ? `?${queryString}` : ""}`
)

state.sentinelAccess.codes = filterSentinelAccessCodes(payload?.codes)

if (state.sentinelAccess.selectedCodeId) {
const stillVisible = state.sentinelAccess.codes.some(
(code) => Number(code.id) === Number(state.sentinelAccess.selectedCodeId)
)
if (!stillVisible) {
state.sentinelAccess.selectedCodeId = null
state.sentinelAccess.selectedCode = null
state.sentinelAccess.selectedCodeRedemptions = []
state.sentinelAccess.selectedCodeEntitlements = []
}
}

renderSentinelAccessCodesTable()
renderSentinelAccessCodeDetail(
state.sentinelAccess.selectedCode,
state.sentinelAccess.selectedCodeRedemptions,
state.sentinelAccess.selectedCodeEntitlements
)
updateSentinelAccessSummary()

return state.sentinelAccess.codes
} finally {
if (manageLoading) endSentinelAccessLoading()
}
}

async function loadSentinelAccessRedemptions({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelAccessLoading()
try {
const queryString = buildSentinelAccessRedemptionsQueryString()
const payload = await apiFetchSentinelAccessAdmin(
`/redemptions${queryString ? `?${queryString}` : ""}`
)

state.sentinelAccess.redemptions = filterSentinelAccessRedemptions(payload?.redemptions)
renderSentinelAccessRedemptionsTable()
updateSentinelAccessSummary()

return state.sentinelAccess.redemptions
} finally {
if (manageLoading) endSentinelAccessLoading()
}
}

async function loadSentinelAccessEntitlements({ manageLoading = true } = {}) {
if (manageLoading) beginSentinelAccessLoading()
try {
const payload = await apiFetchSentinelAccessAdmin(`/entitlements?limit=500`)
state.sentinelAccess.entitlements = arrayify(payload?.entitlements)
updateSentinelAccessSummary()
return state.sentinelAccess.entitlements
} finally {
if (manageLoading) endSentinelAccessLoading()
}
}

async function loadSentinelAccessCodeDetail(codeId, { quiet = false, manageLoading = true } = {}) {
if (!codeId) return

if (manageLoading) beginSentinelAccessLoading()
try {
const payload = await apiFetchSentinelAccessAdmin(`/codes/${encodeURIComponent(codeId)}`)
const code = payload?.code || null
if (!code) {
throw new Error("Access code detail was empty.")
}

state.sentinelAccess.selectedCodeId = Number(codeId)
state.sentinelAccess.selectedCode = code
state.sentinelAccess.selectedCodeRedemptions = arrayify(payload?.redemptions)
state.sentinelAccess.selectedCodeEntitlements = arrayify(payload?.entitlements)

state.sentinelAccess.codes = state.sentinelAccess.codes.map((item) =>
Number(item.id) === Number(code.id) ? code : item
)

renderSentinelAccessCodesTable()
renderSentinelAccessCodeDetail(
state.sentinelAccess.selectedCode,
state.sentinelAccess.selectedCodeRedemptions,
state.sentinelAccess.selectedCodeEntitlements
)

if (!quiet) clearSentinelAccessBanner()
return code
} catch (error) {
if (!quiet) {
setSentinelAccessBanner(error?.message || "Failed to load Sentinel access code.", "bad")
}
throw error
} finally {
if (manageLoading) endSentinelAccessLoading()
}
}

async function loadSentinelAccessBundle({ showSuccess = false } = {}) {
beginSentinelAccessLoading()
try {
syncSentinelAccessFiltersFromInputs()

await loadSentinelAccessSummary({ manageLoading: false })
await loadSentinelAccessCodes({ manageLoading: false })
await loadSentinelAccessRedemptions({ manageLoading: false })
await loadSentinelAccessEntitlements({ manageLoading: false })

if (state.sentinelAccess.selectedCodeId) {
await loadSentinelAccessCodeDetail(state.sentinelAccess.selectedCodeId, {
quiet: true,
manageLoading: false,
}).catch(() => {})
}

clearSentinelAccessBanner()
if (showSuccess) {
setSentinelAccessBanner("Sentinel access data refreshed.", "good")
}
} catch (error) {
setSentinelAccessBanner(error?.message || "Failed to load Sentinel access data.", "bad")
} finally {
endSentinelAccessLoading()
}
}

function buildCreateSentinelAccessCodePayload() {
const customCode = cleanText(els.sentinelAccessCustomCodeInput?.value, 128).toUpperCase()
const codeType = cleanText(els.sentinelAccessCodeTypeInput?.value, 64).toLowerCase() || "trial"
const maxRedemptions = getOptionalNumber(
els.sentinelAccessMaxRedemptionsInput,
1,
"Max Redemptions",
{ min: 1 }
)
const planKey =
cleanText(els.sentinelAccessPlanKeyInput?.value, 120) || "sentinel_trial"
const planLabel =
cleanText(els.sentinelAccessPlanLabelInput?.value, 120) || "Early Access Trial"
const durationDays = getOptionalNumber(
els.sentinelAccessDurationDaysInput,
7,
"Duration Days",
{ min: 0 }
)
const boundUserId = cleanText(els.sentinelAccessBoundUserIdInput?.value, 64)
const createdByUserId = cleanText(els.sentinelAccessCreatedByUserIdInput?.value, 64)
const startsAt = coerceDateTimeLocalToIso(els.sentinelAccessStartsAtInput?.value)
const expiresAt = coerceDateTimeLocalToIso(els.sentinelAccessExpiresAtInput?.value)
const notes = cleanText(els.sentinelAccessNotesInput?.value, 2000) || null

if (startsAt && expiresAt && new Date(startsAt).getTime() >= new Date(expiresAt).getTime()) {
throw new Error("Absolute Expiry must be later than Starts At.")
}

return {
quantity: 1,
prefix: "MSS",
custom_code: customCode || null,
code_type: codeType,
plan_key: planKey,
plan_label: planLabel,
duration_days: durationDays,
max_redemptions: maxRedemptions,
bound_user_id: boundUserId ? Number(boundUserId) : null,
starts_at: startsAt,
expires_at: expiresAt,
created_by_user_id: createdByUserId ? Number(createdByUserId) : null,
notes,
actor_id: getSentinelAccessCreateActorId(),
is_active: true,
}
}

async function createSentinelAccessCode() {
beginSentinelAccessLoading()
try {
const body = buildCreateSentinelAccessCodePayload()
const payload = await apiFetchSentinelAccessAdmin(`/codes`, {
method: "POST",
body: JSON.stringify(body),
})

const createdCodes = arrayify(payload?.codes)
const createdCode = createdCodes[0] || null

if (createdCode?.code) {
setValue(els.sentinelAccessGeneratedCodeValue, createdCode.code)
}

await loadSentinelAccessSummary({ manageLoading: false })
await loadSentinelAccessCodes({ manageLoading: false })
await loadSentinelAccessRedemptions({ manageLoading: false })
await loadSentinelAccessEntitlements({ manageLoading: false })

if (createdCode?.id) {
await loadSentinelAccessCodeDetail(createdCode.id, {
quiet: true,
manageLoading: false,
})
}

setValue(els.sentinelAccessCustomCodeInput, "")
setValue(els.sentinelAccessNotesInput, "")
setSentinelAccessBanner(
createdCode?.code
? `Sentinel access code created: ${createdCode.code}`
: "Sentinel access code created.",
"good"
)
} catch (error) {
setSentinelAccessBanner(error?.message || "Failed to create Sentinel access code.", "bad")
} finally {
endSentinelAccessLoading()
}
}

async function postSentinelAccessCodeAction(
path,
successMessage = "Sentinel access code updated."
) {
const code = state.sentinelAccess.selectedCode
if (!code?.id) {
setSentinelAccessBanner("Select a Sentinel access code first.", "warn")
return
}

beginSentinelAccessLoading()
try {
await apiFetchSentinelAccessAdmin(
`/codes/${encodeURIComponent(code.id)}${path}`,
{
method: "POST",
body: JSON.stringify({
actor_id: getSentinelAccessActionActorId(),
notes: getSentinelAccessActionNotes(),
}),
}
)

await loadSentinelAccessSummary({ manageLoading: false })
await loadSentinelAccessCodes({ manageLoading: false })
await loadSentinelAccessRedemptions({ manageLoading: false })
await loadSentinelAccessEntitlements({ manageLoading: false })
await loadSentinelAccessCodeDetail(code.id, {
quiet: true,
manageLoading: false,
})

setSentinelAccessBanner(successMessage, "good")
} catch (error) {
setSentinelAccessBanner(error?.message || "Failed to update access code.", "bad")
} finally {
endSentinelAccessLoading()
}
}

async function copySelectedSentinelAccessCode() {
const codeValue = cleanText(state.sentinelAccess.selectedCode?.code, 128)
if (!codeValue) {
setSentinelAccessBanner("Select a Sentinel access code first.", "warn")
return
}

try {
if (navigator.clipboard?.writeText) {
await navigator.clipboard.writeText(codeValue)
setSentinelAccessBanner("Access code copied to clipboard.", "good")
return
}
} catch {}

window.prompt("Copy Sentinel access code", codeValue)
setSentinelAccessBanner("Access code ready to copy.", "good")
}

function buildSentinelAccessFilterDefaults() {
setValue(els.sentinelAccessActorIdInput, cleanText(els.sentinelAccessActorIdInput?.value, 120) || "admin")
setValue(
els.sentinelAccessCodeActionActorIdInput,
cleanText(els.sentinelAccessCodeActionActorIdInput?.value, 120) || "admin"
)
if (!cleanText(els.sentinelAccessPlanKeyInput?.value, 120)) {
setValue(els.sentinelAccessPlanKeyInput, "sentinel_trial")
}
if (!cleanText(els.sentinelAccessPlanLabelInput?.value, 120)) {
setValue(els.sentinelAccessPlanLabelInput, "Early Access Trial")
}
if (!cleanText(els.sentinelAccessCodeTypeInput?.value, 64)) {
setValue(els.sentinelAccessCodeTypeInput, "trial")
}
if (!cleanText(els.sentinelAccessMaxRedemptionsInput?.value, 16)) {
setValue(els.sentinelAccessMaxRedemptionsInput, "1")
}
if (!cleanText(els.sentinelAccessDurationDaysInput?.value, 16)) {
setValue(els.sentinelAccessDurationDaysInput, "7")
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

async function refreshSentinelSummaryOnly() {
beginSentinelLoading()
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
endSentinelLoading()
}
}

function bindSentinelActions() {
ensureSentinelEnhancementElements()

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
state.sentinel.filters.summaryDate =
cleanText(els.sentinelSummaryDateInput?.value, 32) || todayIso
state.sentinel.filters.statsDate = state.sentinel.filters.summaryDate
if (els.sentinelStatsDateInput) {
els.sentinelStatsDateInput.value = state.sentinel.filters.statsDate
}
await refreshSentinelSummaryOnly()
})

els.refreshSentinelSummaryButton?.addEventListener("click", async () => {
await refreshSentinelSummaryOnly()
})

els.sentinelPositionSortFilter?.addEventListener("change", () => {
state.sentinel.filters.positionSort =
cleanText(els.sentinelPositionSortFilter?.value, 64) || "pnl_desc"
renderSentinelPositions()
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

function bindSentinelAccessActions() {
els.refreshSentinelAccessAdminButton?.addEventListener("click", async () => {
syncSentinelAccessFiltersFromInputs()
await loadSentinelAccessBundle({ showSuccess: true })
})

els.createSentinelAccessCodeButton?.addEventListener("click", async () => {
await createSentinelAccessCode()
})

els.refreshSentinelAccessCodesButton?.addEventListener("click", async () => {
beginSentinelAccessLoading()
try {
syncSentinelAccessFiltersFromInputs()
await loadSentinelAccessCodes({ manageLoading: false })
clearSentinelAccessBanner()
} catch (error) {
setSentinelAccessBanner(error?.message || "Failed to refresh access codes.", "bad")
} finally {
endSentinelAccessLoading()
}
})

els.refreshSentinelAccessRedemptionsButton?.addEventListener("click", async () => {
beginSentinelAccessLoading()
try {
syncSentinelAccessFiltersFromInputs()
await loadSentinelAccessRedemptions({ manageLoading: false })
clearSentinelAccessBanner()
} catch (error) {
setSentinelAccessBanner(error?.message || "Failed to refresh redemptions.", "bad")
} finally {
endSentinelAccessLoading()
}
})

els.sentinelAccessCopyCodeButton?.addEventListener("click", async () => {
await copySelectedSentinelAccessCode()
})

els.sentinelAccessDeactivateCodeButton?.addEventListener("click", async () => {
const confirmed = window.confirm(
"Deactivate the selected Sentinel access code?"
)
if (!confirmed) return

await postSentinelAccessCodeAction(
"/disable",
"Sentinel access code deactivated."
)
})

els.sentinelAccessActivateCodeButton?.addEventListener("click", async () => {
await postSentinelAccessCodeAction(
"/enable",
"Sentinel access code reactivated."
)
})

els.sentinelAccessRefreshSelectedCodeButton?.addEventListener("click", async () => {
if (!state.sentinelAccess.selectedCodeId) {
setSentinelAccessBanner("Select a Sentinel access code first.", "warn")
return
}

beginSentinelAccessLoading()
try {
await loadSentinelAccessCodeDetail(state.sentinelAccess.selectedCodeId, {
quiet: true,
manageLoading: false,
})
clearSentinelAccessBanner()
} catch (error) {
setSentinelAccessBanner(error?.message || "Failed to refresh selected access code.", "bad")
} finally {
endSentinelAccessLoading()
}
})
}

function initDefaults() {
ensureSentinelEnhancementElements()

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

updateSentinelPeriodCopy()

buildSentinelAccessFilterDefaults()
updateSentinelAccessSummary()
renderSentinelAccessCodesTable()
renderSentinelAccessRedemptionsTable()
renderSentinelAccessCodeDetail(null)
updateSentinelPortfolioSummary()
updateAdminSectionTabs()
}

async function init() {
initDefaults()
bindCaseActions()
bindSentinelActions()
bindSentinelAccessActions()

syncCaseFiltersFromInputs()
syncSentinelFiltersFromInputs()
syncSentinelAccessFiltersFromInputs()

updateCaseControlDisabledState()
updateSentinelControlDisabledState()
updateSentinelAccessControlDisabledState()
refreshApiStatus()

await Promise.all([
loadCases(),
loadSentinelBundle(),
loadSentinelAccessBundle(),
])

ensureComplianceAdminWorkspace()
}

init().catch((error) => {
console.error("Failed to initialize compliance admin page", error)
setCaseBanner(error?.message || "Failed to initialize compliance admin page.", "bad")
setSentinelBanner(error?.message || "Failed to initialize Sentinel admin.", "bad")
setSentinelAccessBanner(error?.message || "Failed to initialize Sentinel access admin.", "bad")
})