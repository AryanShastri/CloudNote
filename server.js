// server.js — Option B endpoints
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
app.use(cors()); // allow your extension/localhost to call this backend
app.use(express.json());

const REGION = process.env.AWS_REGION;               // e.g. "ap-south-1"
const BUCKET = process.env.BUCKET_NAME;              // e.g. "cloudnote-aws-bucket"
const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,      // from IAM user
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// GET /api/s3-upload-url?fileName=...&userId=...
app.get("/api/s3-upload-url", async (req, res) => {
  try {
    const { fileName, userId } = req.query;
    if (!fileName || !userId) return res.status(400).json({ error: "Missing fileName or userId" });

    const key = `${userId}/${fileName}`;
    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: "text/plain",
    });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
    res.json({ uploadUrl, key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to generate upload url" });
  }
});

// GET /api/list-files?userId=...
app.get("/api/list-files", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const out = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `${userId}/`,
    }));
    const files = (out.Contents || []).map(o => ({
      name: o.Key.replace(`${userId}/`, ""),
      key: o.Key,
    }));
    res.json(files);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to list files" });
  }
});

// GET /api/get-download-url?key=...&userId=...
app.get("/api/get-download-url", async (req, res) => {
  try {
    const { key, userId } = req.query;
    if (!key || !userId) return res.status(400).json({ error: "Missing key or userId" });
    if (!key.startsWith(`${userId}/`)) return res.status(403).json({ error: "Forbidden" });

    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
    res.json({ downloadUrl: url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to generate download url" });
  }
});

app.listen(3000, () => console.log("✅ Backend running on http://localhost:3000"));
