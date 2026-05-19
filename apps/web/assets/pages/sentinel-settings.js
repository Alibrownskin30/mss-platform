import {
apiFetch,
apiFetchFirst,
cleanText,
formatDateTime,
formatNumber,
safeNumber,
setBanner,
clearBanner,
setDisabled,
setText,
setValue,
titleCase,
todayIso,
} from "./admin-core.js"

const state = {
status: null,
settings: null,
engine: null,
summary: null,
loadingCount: 0,
}

const els = {
apiStatusChip: document.getElementById("apiStatusChip"),
sentinelModeChip: document.getElementById("sentinelModeChip"),
sentinelEngineRunningChip: document.getElementById("sentinelEngineRunningChip"),
sentinelBanner: document.getElementById("sentinelBanner"),

refreshSentinelButton: document.getElementById("refreshSentinelButton"),
saveSentinelSettingsButton: document.getElementById("saveSentinelSettingsButton"),

sentinelCurrentModeValue: document.getElementById("sentinelCurrentModeValue"),
sentinelWatcherEnabledValue: document.getElementById("sentinelWatcherEnabledValue"),
sentinelKillSwitchValue: document.getElementById("sentinelKillSwitchValue"),
sentinelSettingsStateValue: document.getElementById("sentinelSettingsStateValue"),

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
sentinelTickCountValue: document.getElementById("sentinelTickCountValue"),
sentinelLastErrorValue: document.getElementById("sentinelLastErrorValue"),
}

function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value

const normalized = cleanText(value, 16).toLowerCase()

if (normalized === "true" || normalized === "1" || normalized === "yes") return true
if (normalized === "false" || normalized === "0" || normalized === "no") return false

return fallback
}

function setBoolSelect(el, value) {
if (!el) return
el.value = String(Boolean(value))
}

function setSentinelBanner(message = "", variant = "warn") {
setBanner(els.sentinelBanner, message, variant)
}

function clearSentinelBanner() {
clearBanner(els.sentinelBanner)
}

function isLoading() {
return state.loadingCount > 0
}

function refreshApiStatus() {
setText(els.apiStatusChip, isLoading() ? "Loading" : "Ready")
}

function updateControlDisabledState() {
const disabled = isLoading()

setDisabled(
[
els.refreshSentinelButton,
els.saveSentinelSettingsButton,
els.sentinelModePaperButton,
els.sentinelModeArmedButton,
els.sentinelModeLiveButton,
els.sentinelEmergencyStopButton,
],
disabled
)
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

function getActorId() {
return "admin"
}

function getOptionalBool(inputEl, fallback) {
if (!inputEl) return Boolean(fallback)
return parseBool(inputEl.value, Boolean(fallback))
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
last_error:
engine.last_error ||
engine.lastError ||
null,
current_mode:
cleanText(engine.current_mode || engine.currentMode, 64) || null,
last_tick_started_at:
engine.last_tick_started_at ||
engine.lastTickStartedAt ||
null,
last_tick_finished_at:
engine.last_tick_finished_at ||
engine.lastTickFinishedAt ||
null,
}
}

function getSentinelModeLabel(mode) {
return titleCase(cleanText(mode, 64).toLowerCase() || "paper") || "Paper"
}

function applySentinelModeToUi(mode) {
const normalizedMode = cleanText(mode, 64).toLowerCase() || "paper"
const label = getSentinelModeLabel(normalizedMode)

setText(els.sentinelModeChip, label)
setText(els.sentinelCurrentModeValue, label)

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
return
}

if (buttonMode === normalizedMode && buttonMode === "emergency_stop") {
el.className = "button button-danger"
return
}

el.className = `button ${base}`
})
}

function renderEngine(engine = null) {
const normalized = normalizeEngine(engine)
state.engine = normalized

const currentMode =
cleanText(normalized?.current_mode, 64) ||
cleanText(state.settings?.execution_mode, 64) ||
cleanText(state.summary?.execution_mode, 64) ||
"paper"

applySentinelModeToUi(currentMode)

setText(els.sentinelEngineStartedValue, normalized ? (normalized.started ? "Yes" : "No") : "—")
setText(els.sentinelEngineRunningValue, normalized ? (normalized.running ? "Yes" : "No") : "—")
setText(els.sentinelEngineRunningChip, normalized ? (normalized.running ? "Running" : "Idle") : "—")
setText(els.sentinelTickCountValue, formatNumber(normalized?.tick_count, 0))

const lastErrorObject = normalized?.last_error
const lastErrorText =
cleanText(lastErrorObject?.message, 500) ||
cleanText(lastErrorObject, 500) ||
"None"

setText(els.sentinelLastErrorValue, lastErrorText)
}

function applySentinelSettingsToInputs(settings) {
if (!settings) return

state.settings = settings

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

setText(els.sentinelWatcherEnabledValue, settings.watcher_enabled ? "Yes" : "No")
setText(
els.sentinelKillSwitchValue,
cleanText(settings.execution_mode, 64) === "emergency_stop" ? "Active" : "Inactive"
)
setText(els.sentinelSettingsStateValue, "Loaded")

applySentinelModeToUi(settings.execution_mode || "paper")
}

function renderStatus(payload) {
state.status = payload || null

if (!payload) {
setText(els.sentinelSettingsStateValue, "No payload")
return
}

if (payload.settings) {
applySentinelSettingsToInputs(payload.settings)
}

if (payload.summary) {
state.summary = payload.summary

const killSwitchActive = Boolean(
payload.summary.kill_switch_active ??
payload.summary.killSwitchActive
)

setText(els.sentinelKillSwitchValue, killSwitchActive ? "Active" : "Inactive")

const summaryMode =
cleanText(payload.summary.execution_mode || payload.summary.executionMode, 64) ||
cleanText(payload.settings?.execution_mode, 64) ||
"paper"

applySentinelModeToUi(summaryMode)
}

if (payload.engine) {
renderEngine(payload.engine)
}
}

function buildSentinelStatusQueryString() {
const params = new URLSearchParams()
params.set("period", "daily")
params.set("date", todayIso)

const mode = cleanText(state.settings?.execution_mode, 64).toLowerCase()
if (mode) params.set("mode", mode)

return params.toString()
}

async function loadSentinelStatus({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const queryString = buildSentinelStatusQueryString()

try {
const payload = await apiFetchFirst([
`/api/compliance-admin/sentinel/status${queryString ? `?${queryString}` : ""}`,
])

renderStatus(payload)
return payload
} catch (primaryError) {
try {
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

renderStatus(merged)
return merged
} catch {
throw primaryError
}
}
} finally {
if (manageLoading) endLoading()
}
}

function buildSentinelSettingsPayload() {
const base = {
...(state.settings || {}),
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
renderEngine(payload.engine)
}

await loadSentinelStatus({ manageLoading: false })

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
confirm_live:
requestedMode === "armed_mainnet" || requestedMode === "live_mainnet",
}),
})

const currentMode = cleanText(payload?.current_mode, 64) || requestedMode

await loadSentinelStatus({ manageLoading: false })

setSentinelBanner(`Sentinel mode switched to ${getSentinelModeLabel(currentMode)}.`, "good")
} catch (error) {
setSentinelBanner(error?.message || "Failed to change Sentinel mode.", "bad")
} finally {
endLoading()
}
}

function bindActions() {
els.refreshSentinelButton?.addEventListener("click", async () => {
beginLoading()

try {
await loadSentinelStatus({ manageLoading: false })
clearSentinelBanner()
setSentinelBanner("Sentinel settings refreshed.", "good")
} catch (error) {
setSentinelBanner(error?.message || "Failed to refresh Sentinel settings.", "bad")
} finally {
endLoading()
}
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
}

function initDefaults() {
setText(els.sentinelSettingsStateValue, "Awaiting refresh")
setText(els.sentinelWatcherEnabledValue, "—")
setText(els.sentinelKillSwitchValue, "—")
setText(els.sentinelEngineRunningChip, "—")
setText(els.sentinelEngineStartedValue, "—")
setText(els.sentinelEngineRunningValue, "—")
setText(els.sentinelTickCountValue, "—")
setText(els.sentinelLastErrorValue, "—")

refreshApiStatus()
updateControlDisabledState()
applySentinelModeToUi("paper")
}

async function init() {
initDefaults()
bindActions()
await loadSentinelStatus()
}

init().catch((error) => {
console.error("Failed to initialize Sentinel settings page", error)
setSentinelBanner(error?.message || "Failed to initialize Sentinel settings.", "bad")
})
