import express from "express";
import multer from "multer";
import path from "path";

const router = express.Router();

const storage = multer.diskStorage({
destination: "uploads/",
filename: (req, file, cb) => {
const ext = path.extname(file.originalname);
const name = Date.now() + "-" + Math.random().toString(36).slice(2);
cb(null, name + ext);
}
});

const upload = multer({ storage });

router.post("/launch-logo", upload.single("logo"), (req, res) => {
if (!req.file) {
return res.status(400).json({ error: "no file uploaded" });
}

const url = `/uploads/${req.file.filename}`;

res.json({
ok: true,
url
});
});

export default router;
