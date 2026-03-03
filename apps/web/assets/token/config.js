export const API_BASE = `${location.protocol}//${location.hostname.replace("-3000.", "-8787.")}`;

export const SAMPLE_MINT =
"DezXAZ8z7PnnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

export const ENDPOINTS = {
token: (mint) => `${API_BASE}/api/sol/token/${mint}`,
market: (mint) => `${API_BASE}/api/sol/market/${mint}`,
holders: (mint) => `${API_BASE}/api/sol/holders/${mint}`,
health: () => `${API_BASE}/health`,
};