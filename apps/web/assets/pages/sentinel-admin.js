import {
ADMIN_SESSION_INVALID_EVENT,
ADMIN_SESSION_READY_EVENT,
apiFetch,
arrayify,
cleanText,
createPill,
firstFiniteNumber,
formatCurrency,
formatDateTime,
formatNumber,
formatPercent,
formatSignedCurrency,
formatSignedPercent,
getAdminSessionSnapshot,
getPnlClass,
setAdminSessionSnapshot,
setBanner,
setBoolSelect,
setMoneyTone,
setText,
setValue,
shortenWallet,
stringifyCompact,
titleCase,
todayIso,
} from "./admin-core.js"

const REQUIRED_ADMIN_SCOPE = "admin"

const state = {
adminSession: null,
reauthPending: false,
loadingCount: 0,

sentinel: {
status: null,
settings: null,
watcherControl: null,
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
}

const els = {
apiStatusChip: document.getElementById("apiStatusChip"),
sentinelModeChip: document.getElementById("sentinelModeChip"),
heroSentinelModeValue: document.getElementById("heroSentinelModeValue"),

sentinelBanner: document.getElementById("sentinelBanner"),

refreshSentinelButton: document.getElementById("refreshSentinelButton"),
saveSentinelSettingsButton: document.getElementById(
"saveSentinelSettingsButton"
),
sentinelSaveButtons: Array.from(
document.querySelectorAll(".sentinel-save-button")
),

sentinelWatcherToggleButton: document.getElementById(
"sentinelWatcherToggleButton"
),
sentinelWatcherControlNote: document.getElementById(
"sentinelWatcherControlNote"
),
sentinelRuntimeControlsMount: document.getElementById(
"sentinelRuntimeControlsMount"
),

sentinelCurrentModeValue: document.getElementById(
"sentinelCurrentModeValue"
),
sentinelWatcherEnabledValue: document.getElementById(
"sentinelWatcherEnabledValue"
),
sentinelKillSwitchValue: document.getElementById(
"sentinelKillSwitchValue"
),
sentinelOpenPositionsHeroValue: document.getElementById(
"sentinelOpenPositionsHeroValue"
),

sentinelModePaperButton: document.getElementById(
"sentinelModePaperButton"
),
sentinelModeArmedButton: document.getElementById(
"sentinelModeArmedButton"
),
sentinelModeLiveButton: document.getElementById(
"sentinelModeLiveButton"
),
sentinelEmergencyStopButton: document.getElementById(
"sentinelEmergencyStopButton"
),
sentinelModeReasonInput: document.getElementById(
"sentinelModeReasonInput"
),

sentinelSummaryPeriodFilter: document.getElementById(
"sentinelSummaryPeriodFilter"
),
sentinelSummaryDateInput: document.getElementById(
"sentinelSummaryDateInput"
),
refreshSentinelSummaryButton: document.getElementById(
"refreshSentinelSummaryButton"
),
sentinelSummaryPeriodLabel: document.getElementById(
"sentinelSummaryPeriodLabel"
),
sentinelSummaryPeriodRange: document.getElementById(
"sentinelSummaryPeriodRange"
),

sentinelSummaryOpenPositions: document.getElementById(
"sentinelSummaryOpenPositions"
),
sentinelSummaryDailyRealizedPnl: document.getElementById(
"sentinelSummaryDailyRealizedPnl"
),
sentinelSummaryDailyUnrealizedPnl: document.getElementById(
"sentinelSummaryDailyUnrealizedPnl"
),
sentinelSummaryDailyLoss: document.getElementById(
"sentinelSummaryDailyLoss"
),
sentinelSummaryOpenCapital: document.getElementById(
"sentinelSummaryOpenCapital"
),
sentinelSummaryOpenValue: document.getElementById(
"sentinelSummaryOpenValue"
),
sentinelSummaryTotalCapital: document.getElementById(
"sentinelSummaryTotalCapital"
),
sentinelSummaryPortfolioPnl: document.getElementById(
"sentinelSummaryPortfolioPnl"
),

sentinelScoutUsdInput: document.getElementById("sentinelScoutUsdInput"),
sentinelSniperAddUsdInput: document.getElementById(
"sentinelSniperAddUsdInput"
),
sentinelMaxTotalPositionUsdInput: document.getElementById(
"sentinelMaxTotalPositionUsdInput"
),
sentinelMaxOpenPositionsInput: document.getElementById(
"sentinelMaxOpenPositionsInput"
),
sentinelMaxDailyLossUsdInput: document.getElementById(
"sentinelMaxDailyLossUsdInput"
),
sentinelMaxConsecutiveFailuresInput: document.getElementById(
"sentinelMaxConsecutiveFailuresInput"
),
sentinelMaxDailyScoutSpendUsdInput: document.getElementById(
"sentinelMaxDailyScoutSpendUsdInput"
),
sentinelMaxDailySniperSpendUsdInput: document.getElementById(
"sentinelMaxDailySniperSpendUsdInput"
),
sentinelAutoBankMultipleInput: document.getElementById(
"sentinelAutoBankMultipleInput"
),
sentinelAutoBankFractionInput: document.getElementById(
"sentinelAutoBankFractionInput"
),
sentinelMinOperatorQualityScoreInput: document.getElementById(
"sentinelMinOperatorQualityScoreInput"
),
sentinelMaxHiddenControlRiskInput: document.getElementById(
"sentinelMaxHiddenControlRiskInput"
),
sentinelMinRegimeScoreScoutInput: document.getElementById(
"sentinelMinRegimeScoreScoutInput"
),
sentinelMinRegimeScoreSniperInput: document.getElementById(
"sentinelMinRegimeScoreSniperInput"
),
sentinelMinReclaimStrengthScoreInput: document.getElementById(
"sentinelMinReclaimStrengthScoreInput"
),
sentinelMinBuyPressureScoreInput: document.getElementById(
"sentinelMinBuyPressureScoreInput"
),
sentinelMinPersistenceScoreInput: document.getElementById(
"sentinelMinPersistenceScoreInput"
),
sentinelMinPostEntryHealthScoreInput: document.getElementById(
"sentinelMinPostEntryHealthScoreInput"
),

sentinelWatcherEnabledInput: document.getElementById(
"sentinelWatcherEnabledInput"
),
sentinelAutoBankEnabledInput: document.getElementById(
"sentinelAutoBankEnabledInput"
),
sentinelEnableScoutInput: document.getElementById(
"sentinelEnableScoutInput"
),
sentinelEnableSniperInput: document.getElementById(
"sentinelEnableSniperInput"
),
sentinelEnableRunnerManagementInput: document.getElementById(
"sentinelEnableRunnerManagementInput"
),
sentinelRiskOffDisableNewEntriesInput: document.getElementById(
"sentinelRiskOffDisableNewEntriesInput"
),

sentinelMaxPositionsPerOperatorClusterInput: document.getElementById(
"sentinelMaxPositionsPerOperatorClusterInput"
),
sentinelMaxTokensPerHourInput: document.getElementById(
"sentinelMaxTokensPerHourInput"
),
sentinelCooldownAfterCloseSecInput: document.getElementById(
"sentinelCooldownAfterCloseSecInput"
),
sentinelCooldownAfterInvalidationSecInput: document.getElementById(
"sentinelCooldownAfterInvalidationSecInput"
),
sentinelEarlyFailTimeoutSecInput: document.getElementById(
"sentinelEarlyFailTimeoutSecInput"
),
sentinelWeakStallTimeoutSecInput: document.getElementById(
"sentinelWeakStallTimeoutSecInput"
),
sentinelRunnerFailedBreakoutLimitInput: document.getElementById(
"sentinelRunnerFailedBreakoutLimitInput"
),
sentinelMaxContaminationRiskInput: document.getElementById(
"sentinelMaxContaminationRiskInput"
),
sentinelMaxWalletCoordinationRiskInput: document.getElementById(
"sentinelMaxWalletCoordinationRiskInput"
),
sentinelMaxTopHolderPctInput: document.getElementById(
"sentinelMaxTopHolderPctInput"
),
sentinelMaxTop5HolderPctInput: document.getElementById(
"sentinelMaxTop5HolderPctInput"
),
sentinelMinLiquidityUsdInput: document.getElementById(
"sentinelMinLiquidityUsdInput"
),
sentinelMaxSpreadBpsInput: document.getElementById(
"sentinelMaxSpreadBpsInput"
),
sentinelMaxPriceImpactBpsInput: document.getElementById(
"sentinelMaxPriceImpactBpsInput"
),
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
sentinelEnableHardRejectsInput: document.getElementById(
"sentinelEnableHardRejectsInput"
),

sentinelEngineStartedValue: document.getElementById(
"sentinelEngineStartedValue"
),
sentinelEngineRunningValue: document.getElementById(
"sentinelEngineRunningValue"
),
sentinelLastTickStartedValue: document.getElementById(
"sentinelLastTickStartedValue"
),
sentinelLastTickFinishedValue: document.getElementById(
"sentinelLastTickFinishedValue"
),
sentinelLastErrorValue: document.getElementById(
"sentinelLastErrorValue"
),
sentinelTickCountValue: document.getElementById(
"sentinelTickCountValue"
),
sentinelSnapshotProviderValue: document.getElementById(
"sentinelSnapshotProviderValue"
),
sentinelLastTickSummaryValue: document.getElementById(
"sentinelLastTickSummaryValue"
),

sentinelStatsDateInput: document.getElementById(
"sentinelStatsDateInput"
),
sentinelStatsModeFilter: document.getElementById(
"sentinelStatsModeFilter"
),
refreshSentinelStatsButton: document.getElementById(
"refreshSentinelStatsButton"
),

sentinelStatsScoutsOpened: document.getElementById(
"sentinelStatsScoutsOpened"
),
sentinelStatsSniperAdds: document.getElementById(
"sentinelStatsSniperAdds"
),
sentinelStatsPositionsClosed: document.getElementById(
"sentinelStatsPositionsClosed"
),
sentinelStatsInvalidations: document.getElementById(
"sentinelStatsInvalidations"
),
sentinelStatsConsecutiveFailures: document.getElementById(
"sentinelStatsConsecutiveFailures"
),
sentinelStatsReclaimSuccessRate: document.getElementById(
"sentinelStatsReclaimSuccessRate"
),
sentinelStatsRecentRugRate: document.getElementById(
"sentinelStatsRecentRugRate"
),
sentinelStatsAvgMarketLiquidity: document.getElementById(
"sentinelStatsAvgMarketLiquidity"
),

sentinelPositionScopeFilter: document.getElementById(
"sentinelPositionScopeFilter"
),
sentinelPositionStageFilter: document.getElementById(
"sentinelPositionStageFilter"
),
sentinelPositionOutcomeFilter: document.getElementById(
"sentinelPositionOutcomeFilter"
),
sentinelPositionsModeFilter: document.getElementById(
"sentinelPositionsModeFilter"
),
sentinelPositionsTokenFilter: document.getElementById(
"sentinelPositionsTokenFilter"
),
sentinelPositionsMintFilter: document.getElementById(
"sentinelPositionsMintFilter"
),
sentinelPositionSortFilter: document.getElementById(
"sentinelPositionSortFilter"
),
refreshSentinelPositionsButton: document.getElementById(
"refreshSentinelPositionsButton"
),
sentinelPositionsTableBody: document.getElementById(
"sentinelPositionsTableBody"
),

sentinelAuditEventTypeFilter: document.getElementById(
"sentinelAuditEventTypeFilter"
),
sentinelAuditDecisionFilter: document.getElementById(
"sentinelAuditDecisionFilter"
),
sentinelAuditExecutionStatusFilter: document.getElementById(
"sentinelAuditExecutionStatusFilter"
),
sentinelAuditModeFilter: document.getElementById(
"sentinelAuditModeFilter"
),
sentinelAuditTokenFilter: document.getElementById(
"sentinelAuditTokenFilter"
),
sentinelAuditMintFilter: document.getElementById(
"sentinelAuditMintFilter"
),
sentinelAuditActorTypeFilter: document.getElementById(
"sentinelAuditActorTypeFilter"
),
sentinelAuditActorIdFilter: document.getElementById(
"sentinelAuditActorIdFilter"
),
sentinelAuditReasonCodeFilter: document.getElementById(
"sentinelAuditReasonCodeFilter"
),
refreshSentinelAuditButton: document.getElementById(
"refreshSentinelAuditButton"
),
sentinelAuditTableBody: document.getElementById(
"sentinelAuditTableBody"
),

sentinelAdminAuditActionFilter: document.getElementById(
"sentinelAdminAuditActionFilter"
),
sentinelAdminAuditActorFilter: document.getElementById(
"sentinelAdminAuditActorFilter"
),
sentinelAdminAuditTargetTypeFilter: document.getElementById(
"sentinelAdminAuditTargetTypeFilter"
),
refreshSentinelAdminAuditButton: document.getElementById(
"refreshSentinelAdminAuditButton"
),
sentinelAdminAuditTableBody: document.getElementById(
"sentinelAdminAuditTableBody"
),
}

function normalizeScopes(scopes) {
return arrayify(scopes)
.map((scope) => cleanText(scope, 64).toLowerCase())
.filter(Boolean)
}

function sessionAllowsSentinelAdmin(session) {
return normalizeScopes(session?.scopes).includes(REQUIRED_ADMIN_SCOPE)
}

function acceptAdminSession(session) {
if (!sessionAllowsSentinelAdmin(session)) {
return null
}

state.adminSession = session
setAdminSessionSnapshot(session)

return session
}

function getExistingAdminSession() {
const storedSession = getAdminSessionSnapshot()

if (storedSession && sessionAllowsSentinelAdmin(storedSession)) {
return acceptAdminSession(storedSession)
}

const guardState = window.MSSAdminSessionGuard?.getState?.()

if (
guardState?.authenticated &&
guardState?.session &&
sessionAllowsSentinelAdmin(guardState.session)
) {
return acceptAdminSession(guardState.session)
}

return null
}

function waitForAuthenticatedAdminSession() {
const existingSession = getExistingAdminSession()

if (existingSession) {
return Promise.resolve(existingSession)
}

return new Promise((resolve) => {
const onReady = (event) => {
const session = acceptAdminSession(event?.detail?.session || null)

if (!session) return

window.removeEventListener(ADMIN_SESSION_READY_EVENT, onReady)
resolve(session)
}

window.addEventListener(ADMIN_SESSION_READY_EVENT, onReady)

const retrySession = getExistingAdminSession()

if (retrySession) {
window.removeEventListener(ADMIN_SESSION_READY_EVENT, onReady)
resolve(retrySession)
}
})
}

function getSessionActorId() {
return (
cleanText(state.adminSession?.actor, 120) ||
cleanText(getAdminSessionSnapshot()?.actor, 120) ||
"admin"
)
}

function isAuthorizationError(error) {
return [401, 403].includes(Number(error?.status))
}

function handleAdminApiAuthorizationError(error) {
if (!isAuthorizationError(error)) {
return false
}

if (state.reauthPending) {
return true
}

state.reauthPending = true
state.adminSession = null
setAdminSessionSnapshot(null)

const message =
error?.status === 403
? "Your admin session does not have permission to control Sentinel operations."
: "Your admin session has expired. Returning to secure sign-in."

setSentinelBanner(message, "bad")

const guard = window.MSSAdminSessionGuard

if (guard?.requireAdminSession) {
guard
.requireAdminSession({
requiredScope: REQUIRED_ADMIN_SCOPE,
redirectUnauthenticated: true,
})
.catch(() => {})
.finally(() => {
state.reauthPending = false
})
}

return true
}

async function apiFetchSentinelAdmin(path, options = {}) {
try {
return await apiFetch(`/api/compliance-admin${path}`, options)
} catch (error) {
handleAdminApiAuthorizationError(error)
throw error
}
}

async function apiFetchSentinelAdminFirst(
paths,
options = {},
{ allowStatuses = [] } = {}
) {
let lastError = null

for (let index = 0; index < paths.length; index += 1) {
const path = paths[index]

try {
return await apiFetchSentinelAdmin(path, options)
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

if (error?.status === 404 && !isLast) {
continue
}

throw error
}
}

throw lastError || new Error("Sentinel admin request failed.")
}

function setSentinelBanner(message = "", variant = "warn") {
setBanner(els.sentinelBanner, message, variant)
}

function clearSentinelBanner() {
setBanner(els.sentinelBanner, "")
}

function isLoading() {
return state.loadingCount > 0
}

function refreshApiStatus() {
setText(els.apiStatusChip, isLoading() ? "Loading" : "Ready")
}

function createElement(tagName, className = "", text = "") {
const element = document.createElement(tagName)

if (className) {
element.className = className
}

if (text !== "") {
element.textContent = String(text)
}

return element
}

function getSentinelWatcherControl(
settings = state.sentinel.settings,
summary = state.sentinel.summary
) {
const rawControl =
settings?.watcher_control && typeof settings.watcher_control === "object"
? settings.watcher_control
: state.sentinel.watcherControl &&
typeof state.sentinel.watcherControl === "object"
? state.sentinel.watcherControl
: {}

const executionMode =
cleanText(
settings?.execution_mode ||
summary?.settings_execution_mode ||
summary?.execution_mode,
64
).toLowerCase() || "paper"

const emergencyStopActive =
executionMode === "emergency_stop" ||
Boolean(summary?.kill_switch_active ?? summary?.killSwitchActive)

const hasLoadedState = Boolean(settings || summary)

const enabled = emergencyStopActive
? false
: Boolean(
rawControl.enabled ??
settings?.watcher_enabled ??
summary?.watcher_enabled ??
false
)

const canToggle =
hasLoadedState &&
!emergencyStopActive &&
Boolean(
rawControl.can_toggle ??
summary?.watcher_can_toggle ??
true
)

const forcedOff =
emergencyStopActive ||
Boolean(rawControl.forced_off ?? summary?.watcher_forced_off)

const lockReason =
cleanText(
rawControl.lock_reason || summary?.watcher_lock_reason,
500
) ||
(emergencyStopActive
? "Emergency Stop is active. Restore Paper mode before enabling Sentinel Watcher."
: "")

return {
enabled,
canToggle,
forcedOff,
emergencyStopActive,
executionMode,
lockReason,
hasLoadedState,
}
}

function getSentinelControlsMount() {
return (
els.sentinelRuntimeControlsMount ||
document.getElementById("sentinelRuntimeControlsMount") ||
els.sentinelWatcherEnabledInput?.closest(
".sentinel-settings-panel, .admin-panel, .admin-card, .panel, section"
) ||
els.sentinelWatcherEnabledInput?.parentElement ||
els.sentinelBanner?.parentElement ||
document.querySelector("main")
)
}

function ensureSentinelActionControls() {
let controlsRow = document.getElementById("sentinelRuntimeControlRow")
const mount = getSentinelControlsMount()

if (!controlsRow && mount) {
controlsRow = createElement("div", "sentinel-runtime-control-row")
controlsRow.id = "sentinelRuntimeControlRow"
controlsRow.style.display = "flex"
controlsRow.style.flexWrap = "wrap"
controlsRow.style.alignItems = "center"
controlsRow.style.gap = "10px"
controlsRow.style.marginTop = "14px"
controlsRow.style.marginBottom = "14px"
controlsRow.style.padding = "12px 14px"
controlsRow.style.border = "1px solid rgba(255,255,255,.08)"
controlsRow.style.borderRadius = "12px"
controlsRow.style.background = "rgba(255,255,255,.025)"

const controlTitle = createElement(
"div",
"sentinel-runtime-control-title",
"Watcher Runtime Control"
)

controlTitle.style.fontSize = "12px"
controlTitle.style.fontWeight = "700"
controlTitle.style.letterSpacing = ".08em"
controlTitle.style.textTransform = "uppercase"
controlTitle.style.opacity = ".72"
controlTitle.style.marginRight = "4px"

controlsRow.appendChild(controlTitle)

if (!els.sentinelWatcherToggleButton) {
const toggleButton = createElement(
"button",
"secondary admin-button-secondary",
"Loading Watcher..."
)

toggleButton.id = "sentinelWatcherToggleButton"
toggleButton.type = "button"
toggleButton.disabled = true

controlsRow.appendChild(toggleButton)
els.sentinelWatcherToggleButton = toggleButton
}

if (!els.saveSentinelSettingsButton) {
const saveButton = createElement(
"button",
"primary admin-button-primary sentinel-save-button",
"Save Settings"
)

saveButton.id = "saveSentinelSettingsButton"
saveButton.type = "button"

controlsRow.appendChild(saveButton)
els.saveSentinelSettingsButton = saveButton
}

if (!els.sentinelWatcherControlNote) {
const note = createElement(
"div",
"sentinel-runtime-control-note",
"Loading Sentinel Watcher state..."
)

note.id = "sentinelWatcherControlNote"
note.style.flex = "1 1 280px"
note.style.fontSize = "12px"
note.style.opacity = ".72"
note.style.marginLeft = "4px"

controlsRow.appendChild(note)
els.sentinelWatcherControlNote = note
}

mount.appendChild(controlsRow)
}

if (!els.sentinelWatcherToggleButton) {
els.sentinelWatcherToggleButton = document.getElementById(
"sentinelWatcherToggleButton"
)
}

if (!els.saveSentinelSettingsButton) {
els.saveSentinelSettingsButton = document.getElementById(
"saveSentinelSettingsButton"
)
}

if (!els.sentinelWatcherControlNote) {
els.sentinelWatcherControlNote = document.getElementById(
"sentinelWatcherControlNote"
)
}

if (els.saveSentinelSettingsButton) {
els.saveSentinelSettingsButton.classList.remove("hidden")
}

els.sentinelSaveButtons = Array.from(
document.querySelectorAll(".sentinel-save-button")
)
}

function applySentinelWatcherControlToUi(
settings = state.sentinel.settings,
summary = state.sentinel.summary
) {
ensureSentinelActionControls()

const control = getSentinelWatcherControl(settings, summary)

state.sentinel.watcherControl = control

setText(els.sentinelWatcherEnabledValue, control.enabled ? "Yes" : "No")

if (els.sentinelWatcherEnabledInput) {
setBoolSelect(els.sentinelWatcherEnabledInput, control.enabled)
els.sentinelWatcherEnabledInput.disabled = true
els.sentinelWatcherEnabledInput.title =
"Use the Enable Watcher / Disable Watcher runtime control button."
}

if (els.sentinelWatcherToggleButton) {
const nextActionEnabled = !control.enabled

els.sentinelWatcherToggleButton.textContent = control.enabled
? "Disable Watcher"
: "Enable Watcher"

els.sentinelWatcherToggleButton.dataset.nextEnabled = String(
nextActionEnabled
)

els.sentinelWatcherToggleButton.classList.remove(
"primary",
"secondary",
"danger",
"admin-button-primary",
"admin-button-secondary",
"admin-button-danger"
)

if (control.enabled) {
els.sentinelWatcherToggleButton.classList.add(
"secondary",
"admin-button-secondary"
)
} else {
els.sentinelWatcherToggleButton.classList.add(
"primary",
"admin-button-primary"
)
}

els.sentinelWatcherToggleButton.disabled =
isLoading() || !control.canToggle

els.sentinelWatcherToggleButton.title = control.lockReason || ""
}

if (els.sentinelWatcherControlNote) {
if (!control.hasLoadedState) {
els.sentinelWatcherControlNote.textContent =
"Loading Sentinel Watcher state..."
} else if (control.forcedOff) {
els.sentinelWatcherControlNote.textContent = control.lockReason
} else if (control.enabled) {
els.sentinelWatcherControlNote.textContent =
"Sentinel Watcher is enabled. Emergency Stop remains available for immediate shutdown."
} else {
els.sentinelWatcherControlNote.textContent =
"Sentinel Watcher is disabled. Enable it to resume monitoring in the active execution mode."
}
}

return control
}

function updateControlDisabledState() {
const disabled = isLoading()
const watcherControl = getSentinelWatcherControl()

;[
els.refreshSentinelButton,
els.saveSentinelSettingsButton,
...els.sentinelSaveButtons,
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
if (button) {
button.disabled = disabled
}
})

if (els.sentinelWatcherToggleButton) {
els.sentinelWatcherToggleButton.disabled =
disabled || !watcherControl.canToggle
}

if (els.sentinelWatcherEnabledInput) {
els.sentinelWatcherEnabledInput.disabled = true
}
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
applySentinelWatcherControlToUi()
}

function appendTextLine(
parent,
text,
{ className = "", strong = false } = {}
) {
const line = createElement("div", className, text || "—")

if (strong) {
line.style.fontWeight = "800"
}

parent.appendChild(line)

return line
}

function createStackedCell(lines = []) {
const cell = document.createElement("td")

lines.forEach((line) => {
if (!line || line.text == null || line.text === "") return

appendTextLine(cell, line.text, {
className: line.className || "",
strong: Boolean(line.strong),
})
})

if (!cell.childNodes.length) {
cell.textContent = "—"
}

return cell
}

function renderTableEmpty(
tbody,
colspan = 1,
message = "No records found."
) {
if (!tbody) return

tbody.innerHTML = ""

const row = document.createElement("tr")
const cell = document.createElement("td")

cell.colSpan = Math.max(1, Number(colspan) || 1)
cell.className = "admin-table-empty"
cell.textContent = cleanText(message, 500) || "No records found."

row.appendChild(cell)
tbody.appendChild(row)
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

if (
normalized === "half_banked_at_10x" ||
normalized === "runner_only"
) {
return "good"
}

if (normalized === "invalidated") return "bad"
if (normalized === "closed") return "neutral"

return "warn"
}

function getExecutionStatusVariant(status) {
const normalized = cleanText(status, 64).toLowerCase()

if (normalized === "filled" || normalized === "simulated") {
return "good"
}

if (normalized === "failed") return "bad"

if (normalized === "submitted" || normalized === "planned") {
return "warn"
}

return "neutral"
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

const openedTs =
new Date(position.opened_at || position.created_at || 0).getTime() || 0

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
const aMetrics = getPositionMetrics(a)
const bMetrics = getPositionMetrics(b)

if (sortMode === "pnl_asc") {
return aMetrics.unrealizedPnl - bMetrics.unrealizedPnl
}

if (sortMode === "pnl_pct_desc") {
return bMetrics.pnlPct - aMetrics.pnlPct
}

if (sortMode === "pnl_pct_asc") {
return aMetrics.pnlPct - bMetrics.pnlPct
}

if (sortMode === "current_value_desc") {
return bMetrics.currentValue - aMetrics.currentValue
}

if (sortMode === "capital_desc") {
return bMetrics.costBasis - aMetrics.costBasis
}

if (sortMode === "newest") {
return bMetrics.openedTs - aMetrics.openedTs
}

if (sortMode === "oldest") {
return aMetrics.openedTs - bMetrics.openedTs
}

return bMetrics.unrealizedPnl - aMetrics.unrealizedPnl
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

const isOpenStage =
!isClosed && !["closed", "invalidated"].includes(stage)

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
: Number(pnl.scout_spend_usd || 0) +
Number(pnl.sniper_spend_usd || 0),
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
openCapital:
summaryOpenCapital == null ? openCapital : summaryOpenCapital,
openValue: summaryOpenValue == null ? openValue : summaryOpenValue,
totalCapital,
portfolioPnl,
}
}

function updateSentinelPortfolioSummary() {
const metrics = computeSentinelPortfolioMetrics()

if (els.sentinelSummaryOpenCapital) {
els.sentinelSummaryOpenCapital.textContent = formatCurrency(
metrics.openCapital
)
setMoneyTone(els.sentinelSummaryOpenCapital, metrics.openCapital)
}

if (els.sentinelSummaryOpenValue) {
els.sentinelSummaryOpenValue.textContent = formatCurrency(
metrics.openValue
)
setMoneyTone(els.sentinelSummaryOpenValue, metrics.openValue)
}

if (els.sentinelSummaryTotalCapital) {
els.sentinelSummaryTotalCapital.textContent = formatCurrency(
metrics.totalCapital
)
setMoneyTone(els.sentinelSummaryTotalCapital, metrics.totalCapital)
}

if (els.sentinelSummaryPortfolioPnl) {
els.sentinelSummaryPortfolioPnl.textContent = formatSignedCurrency(
metrics.portfolioPnl
)
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
{
el: els.sentinelModePaperButton,
mode: "paper",
base: "secondary",
},
{
el: els.sentinelModeArmedButton,
mode: "armed_mainnet",
base: "secondary",
},
{
el: els.sentinelModeLiveButton,
mode: "live_mainnet",
base: "secondary",
},
{
el: els.sentinelEmergencyStopButton,
mode: "emergency_stop",
base: "danger",
},
]

modeButtons.forEach(({ el, mode: buttonMode, base }) => {
if (!el) return

el.classList.remove(
"primary",
"secondary",
"danger",
"admin-button-primary",
"admin-button-secondary",
"admin-button-danger"
)

if (
buttonMode === normalizedMode &&
buttonMode !== "emergency_stop"
) {
el.classList.add("primary", "admin-button-primary")
return
}

if (
buttonMode === normalizedMode &&
buttonMode === "emergency_stop"
) {
el.classList.add("danger", "admin-button-danger")
return
}

if (base === "danger") {
el.classList.add("danger", "admin-button-danger")
return
}

el.classList.add("secondary", "admin-button-secondary")
})
}

function applySentinelSettingsToInputs(settings) {
if (!settings) return

state.sentinel.settings = settings

if (settings.watcher_control) {
state.sentinel.watcherControl = settings.watcher_control
}

setValue(els.sentinelScoutUsdInput, settings.scout_usd ?? 0.5)
setValue(els.sentinelSniperAddUsdInput, settings.sniper_add_usd ?? 1)

setValue(
els.sentinelMaxTotalPositionUsdInput,
settings.max_total_position_usd ?? 1.5
)

setValue(
els.sentinelMaxOpenPositionsInput,
settings.max_open_positions ?? 30
)

setValue(
els.sentinelMaxDailyLossUsdInput,
settings.max_daily_loss_usd ?? 25
)

setValue(
els.sentinelMaxConsecutiveFailuresInput,
settings.max_consecutive_failures ?? 8
)

setValue(
els.sentinelMaxDailyScoutSpendUsdInput,
settings.max_daily_scout_spend_usd ?? 20
)

setValue(
els.sentinelMaxDailySniperSpendUsdInput,
settings.max_daily_sniper_spend_usd ?? 30
)

setValue(
els.sentinelAutoBankMultipleInput,
settings.auto_bank_multiple ?? 10
)

setValue(
els.sentinelAutoBankFractionInput,
settings.auto_bank_fraction ?? 0.5
)

setValue(
els.sentinelMinOperatorQualityScoreInput,
settings.min_operator_quality_score ?? 70
)

setValue(
els.sentinelMaxHiddenControlRiskInput,
settings.max_hidden_control_risk ?? 30
)

setValue(
els.sentinelMinRegimeScoreScoutInput,
settings.min_regime_score_for_scout ?? 55
)

setValue(
els.sentinelMinRegimeScoreSniperInput,
settings.min_regime_score_for_sniper ?? 65
)

setValue(
els.sentinelMinReclaimStrengthScoreInput,
settings.min_reclaim_strength_score ?? 60
)

setValue(
els.sentinelMinBuyPressureScoreInput,
settings.min_buy_pressure_score ?? 62
)

setValue(
els.sentinelMinPersistenceScoreInput,
settings.min_persistence_score ?? 58
)

setValue(
els.sentinelMinPostEntryHealthScoreInput,
settings.min_post_entry_health_score ?? 55
)

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
settings.max_positions_per_operator_cluster ?? 2
)

setValue(
els.sentinelMaxTokensPerHourInput,
settings.max_tokens_per_hour ?? 12
)

setValue(
els.sentinelCooldownAfterCloseSecInput,
settings.cooldown_after_close_sec ?? 1800
)

setValue(
els.sentinelCooldownAfterInvalidationSecInput,
settings.cooldown_after_invalidation_sec ?? 3600
)

setValue(
els.sentinelEarlyFailTimeoutSecInput,
settings.early_fail_timeout_sec ?? 180
)

setValue(
els.sentinelWeakStallTimeoutSecInput,
settings.weak_stall_timeout_sec ?? 420
)

setValue(
els.sentinelRunnerFailedBreakoutLimitInput,
settings.runner_failed_breakout_limit ?? 2
)

setValue(
els.sentinelMaxContaminationRiskInput,
settings.max_contamination_risk ?? 35
)

setValue(
els.sentinelMaxWalletCoordinationRiskInput,
settings.max_wallet_coordination_risk ?? 40
)

setValue(
els.sentinelMaxTopHolderPctInput,
settings.max_top_holder_pct ?? 18
)

setValue(
els.sentinelMaxTop5HolderPctInput,
settings.max_top_5_holder_pct ?? 45
)

setValue(
els.sentinelMinLiquidityUsdInput,
settings.min_liquidity_usd ?? 800
)

setValue(
els.sentinelMaxSpreadBpsInput,
settings.max_spread_bps ?? 350
)

setValue(
els.sentinelMaxPriceImpactBpsInput,
settings.max_price_impact_bps ?? 500
)

setValue(
els.sentinelMaxVerticalExtensionScoreForAddInput,
settings.max_vertical_extension_score_for_add ?? 75
)

setValue(
els.sentinelMaxInsiderSellScoreInput,
settings.max_insider_sell_score ?? 45
)

setValue(
els.sentinelMaxLiquidityDecayScoreInput,
settings.max_liquidity_decay_score ?? 50
)

setBoolSelect(
els.sentinelEnableMarketRegimeFilterInput,
settings.enable_market_regime_filter
)

setBoolSelect(
els.sentinelEnableOperatorFilterInput,
settings.enable_operator_filter
)

setBoolSelect(
els.sentinelEnableHardRejectsInput,
settings.enable_hard_rejects
)

setText(
els.sentinelKillSwitchValue,
cleanText(settings.execution_mode, 64).toLowerCase() ===
"emergency_stop"
? "Active"
: "Inactive"
)

applySentinelModeToUi(settings.execution_mode || "paper")
applySentinelWatcherControlToUi(settings, state.sentinel.summary)
}

function normalizeEngine(engine = null) {
if (!engine || typeof engine !== "object") return null

return {
started:
engine.started ?? engine.is_started ?? engine.engine_started ?? false,
running:
engine.running ?? engine.is_running ?? engine.engine_running ?? false,
tick_count:
engine.tick_count ?? engine.tickCount ?? engine.total_ticks ?? 0,
snapshot_provider_name:
cleanText(
engine.snapshot_provider_name ||
engine.snapshotProviderName ||
engine.provider_name ||
engine.providerName,
120
) || null,
last_tick_started_at:
engine.last_tick_started_at || engine.lastTickStartedAt || null,
last_tick_finished_at:
engine.last_tick_finished_at || engine.lastTickFinishedAt || null,
last_error: engine.last_error || engine.lastError || null,
last_tick_summary:
engine.last_tick_summary || engine.lastTickSummary || null,
current_mode:
cleanText(engine.current_mode || engine.currentMode, 64) || null,
}
}

function renderSentinelSummary(summary, engine = null) {
state.sentinel.summary = summary || null
state.sentinel.engine = engine || state.sentinel.engine

const pnl = summary?.pnl || {}

const openPositions = Number(
summary?.open_positions ??
summary?.openPositions ??
pnl.open_positions ??
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

setText(els.sentinelOpenPositionsHeroValue, formatNumber(openPositions))
setText(els.sentinelSummaryOpenPositions, formatNumber(openPositions))

if (els.sentinelSummaryDailyRealizedPnl) {
els.sentinelSummaryDailyRealizedPnl.textContent =
formatSignedCurrency(realized)

setMoneyTone(els.sentinelSummaryDailyRealizedPnl, realized)
}

if (els.sentinelSummaryDailyUnrealizedPnl) {
els.sentinelSummaryDailyUnrealizedPnl.textContent =
formatSignedCurrency(unrealized)

setMoneyTone(els.sentinelSummaryDailyUnrealizedPnl, unrealized)
}

if (els.sentinelSummaryDailyLoss) {
els.sentinelSummaryDailyLoss.textContent = formatCurrency(loss)

setMoneyTone(els.sentinelSummaryDailyLoss, loss, {
lossPositive: true,
})
}

const mode =
cleanText(summary?.execution_mode || summary?.executionMode, 64) ||
cleanText(state.sentinel.settings?.execution_mode, 64) ||
"paper"

applySentinelModeToUi(mode)

setText(
els.sentinelKillSwitchValue,
Boolean(summary?.kill_switch_active ?? summary?.killSwitchActive)
? "Active"
: "Inactive"
)

updateSentinelPeriodCopy(summary)
updateSentinelPortfolioSummary()
applySentinelWatcherControlToUi(state.sentinel.settings, summary)
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

setText(
els.sentinelEngineStartedValue,
normalized ? (normalized.started ? "Yes" : "No") : "—"
)

setText(
els.sentinelEngineRunningValue,
normalized ? (normalized.running ? "Yes" : "No") : "—"
)

setText(
els.sentinelLastTickStartedValue,
formatDateTime(normalized?.last_tick_started_at)
)

setText(
els.sentinelLastTickFinishedValue,
formatDateTime(normalized?.last_tick_finished_at)
)

setText(els.sentinelTickCountValue, formatNumber(normalized?.tick_count, 0))

setText(
els.sentinelSnapshotProviderValue,
cleanText(normalized?.snapshot_provider_name, 120) || "—"
)

const lastErrorText =
cleanText(normalized?.last_error?.message, 500) ||
cleanText(normalized?.last_error, 500) ||
"None"

setText(els.sentinelLastErrorValue, lastErrorText)

const lastTickSummary = normalized?.last_tick_summary

if (!els.sentinelLastTickSummaryValue) return

if (!lastTickSummary) {
els.sentinelLastTickSummaryValue.textContent = "—"
return
}

const summaryParts = []

if (lastTickSummary.total != null) {
summaryParts.push(`total:${lastTickSummary.total}`)
}

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

if (lastTickSummary.reject != null) {
summaryParts.push(`reject:${lastTickSummary.reject}`)
}

if (lastTickSummary.watchlist != null) {
summaryParts.push(`watchlist:${lastTickSummary.watchlist}`)
}

if (lastTickSummary.hold != null) {
summaryParts.push(`hold:${lastTickSummary.hold}`)
}

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

function renderSentinelStatus(payload) {
state.sentinel.status = payload || null

if (!payload) return

if (payload.watcher_control) {
state.sentinel.watcherControl = payload.watcher_control
}

if (payload.settings) {
applySentinelSettingsToInputs(payload.settings)
}

if (payload.summary) {
renderSentinelSummary(payload.summary, payload.engine || null)
}

if (payload.engine) {
renderSentinelEngine(payload.engine)
}

applySentinelWatcherControlToUi(
payload.settings || state.sentinel.settings,
payload.summary || state.sentinel.summary
)

updateSentinelPortfolioSummary()
}

function renderSentinelStats(stats) {
state.sentinel.stats = stats || null

setText(
els.sentinelStatsScoutsOpened,
formatNumber(stats?.scouts_opened, 0)
)

setText(
els.sentinelStatsSniperAdds,
formatNumber(stats?.sniper_adds, 0)
)

setText(
els.sentinelStatsPositionsClosed,
formatNumber(stats?.positions_closed, 0)
)

setText(
els.sentinelStatsInvalidations,
formatNumber(stats?.invalidations, 0)
)

setText(
els.sentinelStatsConsecutiveFailures,
formatNumber(stats?.consecutive_failures, 0)
)

setText(
els.sentinelStatsReclaimSuccessRate,
formatPercent(stats?.reclaim_success_rate_pct, 1)
)

setText(
els.sentinelStatsRecentRugRate,
formatPercent(stats?.recent_rug_rate_pct, 1)
)

setText(
els.sentinelStatsAvgMarketLiquidity,
formatCurrency(stats?.avg_market_liquidity_usd)
)

updateSentinelPortfolioSummary()
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

updateSentinelPortfolioSummary()

return
}

const sortedPositions = getSortedSentinelPositions()

sortedPositions.forEach((position) => {
const metrics = getPositionMetrics(position)
const row = document.createElement("tr")
const unrealizedClass = getPnlClass(metrics.unrealizedPnl)

if (unrealizedClass === "pnl-good") {
row.classList.add("sentinel-position-gain")
}

if (unrealizedClass === "pnl-bad") {
row.classList.add("sentinel-position-loss")
}

const tokenCell = createStackedCell([
{
text: cleanText(position.token_id, 120) || "—",
strong: true,
},
{
text: shortenWallet(position.mint_address),
className: "dim mono",
},
{
text:
cleanText(position.linked_operator_cluster_id, 80) ||
"No cluster",
className: "dim",
},
])

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

const costCell = createStackedCell([
{
text: formatCurrency(metrics.totalCost),
},
{
text: `Basis ${formatCurrency(metrics.costBasis)}`,
className: "dim",
},
])

const multipleText =
metrics.costBasis > 0
? `${formatNumber(metrics.currentValue / metrics.costBasis, 2)}x basis`
: "No basis"

const currentCell = createStackedCell([
{
text: formatCurrency(metrics.currentValue),
strong: true,
},
{
text: multipleText,
className: "dim",
},
])

const realizedCell = document.createElement("td")
const realizedStack = createElement("div", "sentinel-pnl-stack")

realizedStack.appendChild(
createElement(
"div",
`sentinel-pnl-main ${getPnlClass(metrics.realizedPnl)}`,
formatSignedCurrency(metrics.realizedPnl)
)
)

realizedStack.appendChild(
createElement("div", "sentinel-pnl-sub", "Realized")
)

realizedCell.appendChild(realizedStack)

const unrealizedCell = document.createElement("td")
const unrealizedStack = createElement("div", "sentinel-pnl-stack")

unrealizedStack.appendChild(
createElement(
"div",
`sentinel-pnl-main ${unrealizedClass}`,
formatSignedCurrency(metrics.unrealizedPnl)
)
)

unrealizedStack.appendChild(
createElement(
"div",
`sentinel-pnl-sub ${unrealizedClass}`,
formatSignedPercent(metrics.pnlPct, 2)
)
)

unrealizedCell.appendChild(unrealizedStack)

const bankedCell = document.createElement("td")

bankedCell.appendChild(
createPill(
position.has_banked_10x ? "Yes" : "No",
position.has_banked_10x ? "good" : "neutral"
)
)

const openedCell = createStackedCell([
{
text: formatDateTime(position.opened_at),
},
{
text: position.closed_at
? `Closed ${formatDateTime(position.closed_at)}`
: "",
className: "dim",
},
{
text: position.invalidated_at
? `Invalidated ${formatDateTime(position.invalidated_at)}`
: "",
className: "dim",
},
])

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
renderTableEmpty(
tbody,
7,
"No Sentinel audit events found for the current filter set."
)

return
}

state.sentinel.audit.forEach((event) => {
const row = document.createElement("tr")

const reasons = Array.isArray(event.reason_codes)
? event.reason_codes
.map((reason) => cleanText(reason, 128))
.filter(Boolean)
: []

const timeCell = createStackedCell([
{
text: formatDateTime(event.created_at),
},
{
text: `${cleanText(event.actor_type, 64) || "system"}${
event.actor_id ? ` • ${cleanText(event.actor_id, 80)}` : ""
}`,
className: "dim",
},
])

const eventCell = createStackedCell([
{
text: titleCase(event.event_type || "event"),
strong: true,
},
{
text: event.position_id ? `Position #${event.position_id}` : "",
className: "dim",
},
])

const decisionCell = document.createElement("td")
decisionCell.textContent = titleCase(event.decision || "—")

const modeCell = document.createElement("td")

modeCell.appendChild(
createPill(
titleCase(event.execution_mode || "—"),
getSentinelModeVariant(event.execution_mode)
)
)

const tokenCell = createStackedCell([
{
text: cleanText(event.token_id, 120) || "—",
},
{
text: event.mint_address
? shortenWallet(event.mint_address)
: "—",
className: "dim mono",
},
])

const reasonsCell = document.createElement("td")
reasonsCell.textContent = reasons.length
? cleanText(reasons.join(" • "), 300)
: "—"

const statusCell = document.createElement("td")

statusCell.appendChild(
createPill(
titleCase(event.execution_status || "unknown"),
getExecutionStatusVariant(event.execution_status)
)
)

;[
timeCell,
eventCell,
decisionCell,
modeCell,
tokenCell,
reasonsCell,
statusCell,
].forEach((cell) => row.appendChild(cell))

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

const timeCell = createStackedCell([
{
text: formatDateTime(entry.created_at),
},
{
text: cleanText(entry.status, 64) || "—",
className: "dim",
},
])

const actionCell = createStackedCell([
{
text: titleCase(entry.action || "event"),
strong: true,
},
{
text: cleanText(entry.notes, 200),
className: "dim",
},
])

const actorCell = createStackedCell([
{
text: cleanText(entry.actor_id, 120) || "—",
},
{
text: cleanText(entry.actor_type, 120) || "—",
className: "dim",
},
])

const targetCell = createStackedCell([
{
text: cleanText(entry.target_type, 120) || "—",
},
{
text: cleanText(entry.target_id, 120) || "—",
className: "dim",
},
])

const detailsCell = document.createElement("td")

const detailValue =
entry.details_json ??
entry.metadata_json ??
entry.payload_json ??
entry.old_state_json ??
entry.new_state_json ??
null

detailsCell.textContent =
cleanText(stringifyCompact(detailValue), 300) || "—"

const stateCell = document.createElement("td")

stateCell.textContent =
cleanText(
stringifyCompact(entry.new_state_json || entry.old_state_json),
300
) || "—"

;[
timeCell,
actionCell,
actorCell,
targetCell,
detailsCell,
stateCell,
].forEach((cell) => row.appendChild(cell))

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

state.sentinel.filters.statsMode =
cleanText(els.sentinelStatsModeFilter?.value, 64).toLowerCase() ||
"paper"

state.sentinel.filters.positionScope =
cleanText(els.sentinelPositionScopeFilter?.value, 64).toLowerCase() ||
"open"

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

function buildSentinelSummaryQueryString() {
const params = new URLSearchParams()

const period =
cleanText(state.sentinel.filters.summaryPeriod, 32).toLowerCase() ||
"daily"

const date =
cleanText(state.sentinel.filters.summaryDate, 32) || todayIso

params.set("period", period)
params.set("date", date)

const mode = cleanText(
state.sentinel.filters.statsMode,
64
).toLowerCase()

if (mode) {
params.set("mode", mode)
}

return params.toString()
}

async function loadSentinelStatus({ manageLoading = true } = {}) {
if (manageLoading) {
beginLoading()
}

try {
const queryString = buildSentinelSummaryQueryString()

try {
const payload = await apiFetchSentinelAdmin(
`/sentinel/status${queryString ? `?${queryString}` : ""}`
)

renderSentinelStatus(payload)

return payload
} catch (error) {
if (error?.status !== 404) {
throw error
}

const [settingsPayload, summaryPayload] = await Promise.all([
apiFetchSentinelAdmin("/sentinel/settings"),
apiFetchSentinelAdmin(
`/sentinel/summary${queryString ? `?${queryString}` : ""}`
),
])

const merged = {
ok: true,
settings: settingsPayload?.settings || null,
watcher_control:
settingsPayload?.watcher_control ||
settingsPayload?.settings?.watcher_control ||
null,
engine: settingsPayload?.engine || summaryPayload?.engine || null,
summary: summaryPayload?.summary || null,
}

renderSentinelStatus(merged)

return merged
}
} finally {
if (manageLoading) {
endLoading()
}
}
}

function buildSentinelStatsQueryString() {
const params = new URLSearchParams()

const period =
cleanText(state.sentinel.filters.summaryPeriod, 32).toLowerCase() ||
"daily"

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
if (manageLoading) {
beginLoading()
}

try {
const queryString = buildSentinelStatsQueryString()

try {
const payload = await apiFetchSentinelAdmin(
`/sentinel/stats/summary${queryString ? `?${queryString}` : ""}`
)

renderSentinelStats(payload?.stats || null)

return payload?.stats || null
} catch (error) {
if (error?.status !== 404) {
throw error
}

const fallbackParams = new URLSearchParams()

if (state.sentinel.filters.statsDate) {
fallbackParams.set("date", state.sentinel.filters.statsDate)
}

if (state.sentinel.filters.statsMode) {
fallbackParams.set("mode", state.sentinel.filters.statsMode)
}

const fallbackQueryString = fallbackParams.toString()

const payload = await apiFetchSentinelAdmin(
`/sentinel/stats/daily${
fallbackQueryString ? `?${fallbackQueryString}` : ""
}`
)

renderSentinelStats(payload?.stats || null)

return payload?.stats || null
}
} finally {
if (manageLoading) {
endLoading()
}
}
}

function buildSentinelPositionsQueryString() {
const params = new URLSearchParams()

const rawScope = cleanText(
state.sentinel.filters.positionScope,
64
).toLowerCase()

const rawStage = cleanText(
state.sentinel.filters.positionStage,
64
).toLowerCase()

const rawOutcome = cleanText(
state.sentinel.filters.positionOutcome,
64
).toLowerCase()

const effectiveScope =
rawScope ||
(["open", "history", "all"].includes(rawStage) ? rawStage : "open")

if (["open", "history", "all"].includes(effectiveScope)) {
params.set("scope", effectiveScope)
}

if (rawStage && !["open", "history", "all"].includes(rawStage)) {
params.set("stage", rawStage)
}

if (["closed", "invalidated"].includes(rawOutcome)) {
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
if (manageLoading) {
beginLoading()
}

try {
const queryString = buildSentinelPositionsQueryString()

const payload = await apiFetchSentinelAdmin(
`/sentinel/positions${queryString ? `?${queryString}` : ""}`
)

state.sentinel.positions = arrayify(payload?.positions)

renderSentinelPositions()

return state.sentinel.positions
} finally {
if (manageLoading) {
endLoading()
}
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
params.set(
"execution_status",
state.sentinel.filters.auditExecutionStatus
)
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
if (manageLoading) {
beginLoading()
}

try {
const queryString = buildSentinelAuditQueryString()

const payload = await apiFetchSentinelAdmin(
`/sentinel/audit${queryString ? `?${queryString}` : ""}`
)

state.sentinel.audit = arrayify(payload?.audit)

renderSentinelAudit()

return state.sentinel.audit
} finally {
if (manageLoading) {
endLoading()
}
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
if (manageLoading) {
beginLoading()
}

try {
const queryString = buildSentinelAdminAuditQueryString()

const payload = await apiFetchSentinelAdminFirst([
`/sentinel/admin-audit${queryString ? `?${queryString}` : ""}`,
`/sentinel/audit/admin${queryString ? `?${queryString}` : ""}`,
])

state.sentinel.adminAudit = arrayify(payload?.audit)

renderSentinelAdminAudit()

return state.sentinel.adminAudit
} finally {
if (manageLoading) {
endLoading()
}
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

const failures = results.filter(
(result) => result.status === "rejected"
)

if (failures.length) {
const authorizationFailure = failures.find((result) =>
isAuthorizationError(result.reason)
)

if (!authorizationFailure) {
const firstError = failures[0]?.reason

setSentinelBanner(
firstError?.message ||
"One or more Sentinel admin requests failed.",
"bad"
)
}

return
}

clearSentinelBanner()

if (showSuccess) {
setSentinelBanner("Sentinel data refreshed.", "good")
}
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to load Sentinel data.",
"bad"
)
}
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

const normalized = cleanText(inputEl.value, 32).toLowerCase()

if (["true", "1", "yes", "enabled", "on"].includes(normalized)) {
return true
}

if (["false", "0", "no", "disabled", "off"].includes(normalized)) {
return false
}

return Boolean(fallback)
}

function buildSentinelSettingsPayload() {
const base = {
...(state.sentinel.settings || {}),
}

return {
actor_id: getSessionActorId(),

auto_bank_enabled: getOptionalBool(
els.sentinelAutoBankEnabledInput,
base.auto_bank_enabled
),

scout_usd: getOptionalNumber(
els.sentinelScoutUsdInput,
base.scout_usd,
"Scout USD",
{ min: 0.01 }
),

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

enable_scout: getOptionalBool(
els.sentinelEnableScoutInput,
base.enable_scout
),

enable_sniper: getOptionalBool(
els.sentinelEnableSniperInput,
base.enable_sniper
),

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

const payload = await apiFetchSentinelAdmin("/sentinel/settings", {
method: "PATCH",
body: JSON.stringify(body),
})

if (payload?.settings) {
applySentinelSettingsToInputs(payload.settings)
}

if (payload?.watcher_control) {
state.sentinel.watcherControl = payload.watcher_control
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
? payload.changed_fields.map((field) => cleanText(field, 80))
: []

setSentinelBanner(
changedFields.length
? `Sentinel settings saved. Changed: ${changedFields.join(", ")}.`
: "Sentinel settings saved.",
"good"
)
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to save Sentinel settings.",
"bad"
)
}
} finally {
endLoading()
}
}

async function toggleSentinelWatcher() {
const control = getSentinelWatcherControl()

if (!control.hasLoadedState) {
setSentinelBanner("Sentinel Watcher state is still loading.", "warn")
return
}

if (!control.canToggle) {
setSentinelBanner(
control.lockReason ||
"Sentinel Watcher cannot be changed while Emergency Stop is active.",
"bad"
)
return
}

const nextEnabled = !control.enabled

if (
!nextEnabled &&
!window.confirm(
"Disable Sentinel Watcher? Monitoring and new Sentinel decisions will stop until it is enabled again."
)
) {
return
}

const reason = cleanText(els.sentinelModeReasonInput?.value, 500)

beginLoading()

try {
const payload = await apiFetchSentinelAdmin("/sentinel/watcher", {
method: "POST",
body: JSON.stringify({
enabled: nextEnabled,
reason,
notes: reason,
actor_id: getSessionActorId(),
}),
})

if (payload?.settings) {
applySentinelSettingsToInputs(payload.settings)
}

if (payload?.watcher_control) {
state.sentinel.watcherControl = payload.watcher_control
}

if (payload?.engine) {
renderSentinelEngine(payload.engine)
}

await Promise.all([
loadSentinelStatus({ manageLoading: false }),
loadSentinelAudit({ manageLoading: false }),
loadSentinelAdminAudit({ manageLoading: false }),
])

setSentinelBanner(
nextEnabled
? "Sentinel Watcher enabled. Monitoring is active in the current execution mode."
: "Sentinel Watcher disabled. Monitoring remains off until re-enabled.",
"good"
)
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to update Sentinel Watcher state.",
"bad"
)
}
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
confirmed = window.confirm(
"Activate Sentinel Emergency Stop? This will immediately force Sentinel Watcher off and stop new entries."
)
}

if (!confirmed) return

beginLoading()

try {
const payload =
requestedMode === "emergency_stop"
? await apiFetchSentinelAdmin("/sentinel/emergency-stop", {
method: "POST",
body: JSON.stringify({
enabled: true,
reason,
actor_id: getSessionActorId(),
}),
})
: await apiFetchSentinelAdmin("/sentinel/mode", {
method: "POST",
body: JSON.stringify({
execution_mode: requestedMode,
reason,
actor_id: getSessionActorId(),
confirm_live:
requestedMode === "armed_mainnet" ||
requestedMode === "live_mainnet",
}),
})

if (payload?.settings) {
applySentinelSettingsToInputs(payload.settings)
}

if (payload?.watcher_control) {
state.sentinel.watcherControl = payload.watcher_control
}

if (payload?.engine) {
renderSentinelEngine(payload.engine)
}

const currentMode =
cleanText(payload?.current_mode, 64) || requestedMode

if (els.sentinelStatsModeFilter) {
els.sentinelStatsModeFilter.value = currentMode
}

state.sentinel.filters.statsMode = currentMode

await Promise.all([
loadSentinelStatus({ manageLoading: false }),
loadSentinelStats({ manageLoading: false }),
loadSentinelPositions({ manageLoading: false }),
loadSentinelAudit({ manageLoading: false }),
loadSentinelAdminAudit({ manageLoading: false }),
])

if (currentMode === "emergency_stop") {
setSentinelBanner(
"Sentinel Emergency Stop active. Watcher has been forced off.",
"good"
)
return
}

if (payload?.settings?.watcher_enabled) {
setSentinelBanner(
`Sentinel mode switched to ${titleCase(currentMode)}. Watcher is enabled.`,
"good"
)
return
}

setSentinelBanner(
`Sentinel mode switched to ${titleCase(currentMode)}.`,
"good"
)
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to change Sentinel mode.",
"bad"
)
}
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
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to refresh Sentinel summary.",
"bad"
)
}
} finally {
endLoading()
}
}

function bindRefreshFilters() {
;[
els.sentinelPositionScopeFilter,
els.sentinelPositionStageFilter,
els.sentinelPositionOutcomeFilter,
els.sentinelPositionsModeFilter,
].forEach((input) => {
input?.addEventListener("change", async () => {
syncSentinelFiltersFromInputs()

try {
await loadSentinelPositions()
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to refresh Sentinel positions.",
"bad"
)
}
}
})
})

;[
els.sentinelPositionsTokenFilter,
els.sentinelPositionsMintFilter,
].forEach((input) => {
input?.addEventListener("keydown", async (event) => {
if (event.key !== "Enter") return

syncSentinelFiltersFromInputs()

try {
await loadSentinelPositions()
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to refresh Sentinel positions.",
"bad"
)
}
}
})
})

;[
els.sentinelAuditEventTypeFilter,
els.sentinelAuditExecutionStatusFilter,
els.sentinelAuditModeFilter,
els.sentinelAuditActorTypeFilter,
].forEach((input) => {
input?.addEventListener("change", async () => {
syncSentinelFiltersFromInputs()

try {
await loadSentinelAudit()
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to refresh Sentinel audit.",
"bad"
)
}
}
})
})

;[
els.sentinelAuditDecisionFilter,
els.sentinelAuditTokenFilter,
els.sentinelAuditMintFilter,
els.sentinelAuditActorIdFilter,
els.sentinelAuditReasonCodeFilter,
].forEach((input) => {
input?.addEventListener("keydown", async (event) => {
if (event.key !== "Enter") return

syncSentinelFiltersFromInputs()

try {
await loadSentinelAudit()
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to refresh Sentinel audit.",
"bad"
)
}
}
})
})

;[
els.sentinelAdminAuditActionFilter,
els.sentinelAdminAuditActorFilter,
els.sentinelAdminAuditTargetTypeFilter,
].forEach((input) => {
input?.addEventListener("keydown", async (event) => {
if (event.key !== "Enter") return

syncSentinelFiltersFromInputs()

try {
await loadSentinelAdminAudit()
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message ||
"Failed to refresh Sentinel admin audit.",
"bad"
)
}
}
})
})
}

function bindButtonOnce(button, actionKey, handler) {
if (!button) return

const bindingKey = `sentinelBound${actionKey}`

if (button.dataset[bindingKey] === "1") {
return
}

button.dataset[bindingKey] = "1"
button.addEventListener("click", handler)
}

function bindActions() {
ensureSentinelActionControls()

bindButtonOnce(
els.refreshSentinelButton,
"RefreshAll",
async () => {
syncSentinelFiltersFromInputs()
await loadSentinelBundle({ showSuccess: true })
}
)

bindButtonOnce(
els.saveSentinelSettingsButton,
"SaveSettings",
async () => {
await saveSentinelSettings()
}
)

els.sentinelSaveButtons.forEach((button) => {
if (!button || button === els.saveSentinelSettingsButton) return
if (button.hasAttribute("onclick")) return

bindButtonOnce(button, "SaveSettings", async () => {
await saveSentinelSettings()
})
})

bindButtonOnce(
els.sentinelWatcherToggleButton,
"ToggleWatcher",
async () => {
await toggleSentinelWatcher()
}
)

bindButtonOnce(
els.sentinelModePaperButton,
"PaperMode",
async () => {
await changeSentinelMode("paper")
}
)

bindButtonOnce(
els.sentinelModeArmedButton,
"ArmedMode",
async () => {
await changeSentinelMode("armed_mainnet")
}
)

bindButtonOnce(
els.sentinelModeLiveButton,
"LiveMode",
async () => {
await changeSentinelMode("live_mainnet")
}
)

bindButtonOnce(
els.sentinelEmergencyStopButton,
"EmergencyStop",
async () => {
await changeSentinelMode("emergency_stop")
}
)

els.sentinelSummaryPeriodFilter?.addEventListener(
"change",
async () => {
state.sentinel.filters.summaryPeriod =
cleanText(
els.sentinelSummaryPeriodFilter?.value,
32
).toLowerCase() || "daily"

await refreshSentinelSummaryOnly()
}
)

els.sentinelSummaryDateInput?.addEventListener("change", async () => {
state.sentinel.filters.summaryDate =
cleanText(els.sentinelSummaryDateInput?.value, 32) || todayIso

state.sentinel.filters.statsDate =
state.sentinel.filters.summaryDate

if (els.sentinelStatsDateInput) {
els.sentinelStatsDateInput.value = state.sentinel.filters.statsDate
}

await refreshSentinelSummaryOnly()
})

bindButtonOnce(
els.refreshSentinelSummaryButton,
"RefreshSummary",
async () => {
await refreshSentinelSummaryOnly()
}
)

bindButtonOnce(
els.refreshSentinelStatsButton,
"RefreshStats",
async () => {
beginLoading()

try {
syncSentinelFiltersFromInputs()
await loadSentinelStats({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to refresh Sentinel stats.",
"bad"
)
}
} finally {
endLoading()
}
}
)

els.sentinelPositionSortFilter?.addEventListener("change", () => {
state.sentinel.filters.positionSort =
cleanText(els.sentinelPositionSortFilter?.value, 64) || "pnl_desc"

renderSentinelPositions()
})

bindButtonOnce(
els.refreshSentinelPositionsButton,
"RefreshPositions",
async () => {
beginLoading()

try {
syncSentinelFiltersFromInputs()
await loadSentinelPositions({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to refresh Sentinel positions.",
"bad"
)
}
} finally {
endLoading()
}
}
)

bindButtonOnce(
els.refreshSentinelAuditButton,
"RefreshAudit",
async () => {
beginLoading()

try {
syncSentinelFiltersFromInputs()
await loadSentinelAudit({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to refresh Sentinel audit.",
"bad"
)
}
} finally {
endLoading()
}
}
)

bindButtonOnce(
els.refreshSentinelAdminAuditButton,
"RefreshAdminAudit",
async () => {
beginLoading()

try {
syncSentinelFiltersFromInputs()
await loadSentinelAdminAudit({ manageLoading: false })
clearSentinelBanner()
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message ||
"Failed to refresh Sentinel admin audit.",
"bad"
)
}
} finally {
endLoading()
}
}
)

window.addEventListener(ADMIN_SESSION_INVALID_EVENT, (event) => {
const detail = event?.detail || {}

handleAdminApiAuthorizationError({
status: detail.status || 401,
payload: detail.payload || null,
})
})

bindRefreshFilters()
}

function initDefaults() {
ensureSentinelActionControls()

if (els.sentinelSummaryPeriodFilter) {
els.sentinelSummaryPeriodFilter.value =
state.sentinel.filters.summaryPeriod
}

if (els.sentinelSummaryDateInput) {
els.sentinelSummaryDateInput.value =
state.sentinel.filters.summaryDate
}

if (els.sentinelStatsDateInput) {
els.sentinelStatsDateInput.value = state.sentinel.filters.statsDate
}

if (els.sentinelStatsModeFilter) {
els.sentinelStatsModeFilter.value = state.sentinel.filters.statsMode
}

if (els.sentinelPositionScopeFilter) {
els.sentinelPositionScopeFilter.value =
state.sentinel.filters.positionScope
}

if (els.sentinelPositionStageFilter) {
els.sentinelPositionStageFilter.value =
state.sentinel.filters.positionStage
}

if (els.sentinelPositionOutcomeFilter) {
els.sentinelPositionOutcomeFilter.value =
state.sentinel.filters.positionOutcome
}

if (els.sentinelPositionSortFilter) {
els.sentinelPositionSortFilter.value =
state.sentinel.filters.positionSort || "pnl_desc"
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
applySentinelWatcherControlToUi()
}

async function init() {
initDefaults()
bindActions()
syncSentinelFiltersFromInputs()

await waitForAuthenticatedAdminSession()
await loadSentinelBundle()
}

init().catch((error) => {
console.error("Failed to initialize Sentinel admin page", error)

if (!handleAdminApiAuthorizationError(error)) {
setSentinelBanner(
error?.message || "Failed to initialize Sentinel admin.",
"bad"
)
}
})