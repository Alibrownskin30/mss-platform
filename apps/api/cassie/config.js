export const CASSIE = {
// global limits
maxBodyBytes: 1_000_000, // aligns with express.json limit
maxHeaderBytes: 16_000,

// scoring thresholds
scoreThrottle: 35,
scoreChallenge: 55,
scoreTarpit: 70,
scoreBlock: 85,

// block durations
blockMs: 20 * 60 * 1000, // 20 minutes
banEscalationMs: 6 * 60 * 60 * 1000, // 6 hours

// route groups (stricter on auth/alerts/admin)
sensitivePrefixes: ["/api/login", "/api/register", "/api/alerts", "/api/admin"],
scanPrefixes: ["/api/sol/"],

// rate limiting (token bucket-ish)
limits: {
scan: { windowMs: 10_000, max: 30 }, // 30 req / 10s
sensitive: { windowMs: 10_000, max: 10 }, // 10 req / 10s
default: { windowMs: 10_000, max: 20 }, // 20 req / 10s
},

// concurrency caps
concurrency: {
scan: 6,
sensitive: 2,
default: 4,
},
};
