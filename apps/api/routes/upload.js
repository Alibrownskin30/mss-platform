import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

const UPLOAD_DIR = path.resolve("uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const allowedMimeTypes = new Set([
"image/png",
"image/jpeg",
"image/webp",
"image/gif",
]);

const storage = multer.diskStorage({
destination: (_req, _file, cb) => {
cb(null, UPLOAD_DIR);
},
filename: (_req, file, cb) => {
const ext = path.extname(file.originalname || "").toLowerCase();
const safeExt = ext || ".png";
const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
cb(null, `${name}${safeExt}`);
},
});

const upload = multer({
storage,
limits: {
fileSize: 5 * 1024 * 1024,
files: 1,
},
fileFilter: (_req, file, cb) => {
if (!allowedMimeTypes.has(file.mimetype)) {
return cb(new Error("unsupported file type"));
}
cb(null, true);
},
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

const url = `/uploads/${req.file.filename}`;

return res.json({
ok: true,
url,
filename: req.file.filename,
});
});
});

export default router;