import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

function cleanText(value, max = 1000) {
return String(value ?? "").trim().slice(0, max);
}

function resolveUploadDir() {
const explicitPath = cleanText(
process.env.UPLOAD_DIR ||
process.env.UPLOAD_PATH ||
process.env.MSS_UPLOAD_DIR ||
"",
1000
);

if (explicitPath) {
return path.resolve(explicitPath);
}

return path.resolve("uploads");
}

const UPLOAD_DIR = resolveUploadDir();

if (!fs.existsSync(UPLOAD_DIR)) {
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const allowedMimeTypes = new Set([
"image/png",
"image/jpeg",
"image/webp",
"image/gif",
]);

const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function getSafeExtension(file = {}) {
const rawExt = path.extname(file.originalname || "").toLowerCase();

if (allowedExtensions.has(rawExt)) {
return rawExt;
}

if (file.mimetype === "image/png") return ".png";
if (file.mimetype === "image/jpeg") return ".jpg";
if (file.mimetype === "image/webp") return ".webp";
if (file.mimetype === "image/gif") return ".gif";

return ".png";
}

function buildPublicUploadUrl(filename) {
return `/uploads/${encodeURIComponent(filename)}`;
}

const storage = multer.diskStorage({
destination: (_req, _file, cb) => {
cb(null, UPLOAD_DIR);
},
filename: (_req, file, cb) => {
const safeExt = getSafeExtension(file);
const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
cb(null, `${name}${safeExt}`);
},
});

const upload = multer({
storage,
limits: {
fileSize: Number(process.env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024),
files: 1,
},
fileFilter: (_req, file, cb) => {
if (!allowedMimeTypes.has(file.mimetype)) {
return cb(new Error("unsupported file type"));
}

cb(null, true);
},
});

router.get("/health", (_req, res) => {
res.json({
ok: true,
uploadDir: UPLOAD_DIR,
maxBytes: Number(process.env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024),
});
});

router.post("/launch-logo", (req, res) => {
upload.single("logo")(req, res, (err) => {
if (err) {
return res.status(400).json({
ok: false,
error: err.message || "upload failed",
});
}

if (!req.file) {
return res.status(400).json({
ok: false,
error: "no file uploaded",
});
}

const url = buildPublicUploadUrl(req.file.filename);

return res.json({
ok: true,
url,
filename: req.file.filename,
mimetype: req.file.mimetype,
size: req.file.size,
});
});
});

export { UPLOAD_DIR };
export default router;
