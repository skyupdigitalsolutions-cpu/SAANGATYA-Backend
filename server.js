import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import morgan from "morgan";
import helmet from "helmet";

import employeeRoutes from "./routes/employees.js";
import salaryRoutes   from "./routes/salary.js";
import authRoutes     from "./routes/auth.js";
import authMiddleware  from "./middleware/auth.js";

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5000;

// ─── CORS — manual middleware, runs before EVERYTHING ────────────────────────
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ─── Security & Logging ──────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
}));
app.use(morgan("dev"));

// ─── Body Parser ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Public Routes ───────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);

// ─── Protected Routes ────────────────────────────────────────────────────────
app.use("/api/employees", authMiddleware, employeeRoutes);
app.use("/api/salary",    authMiddleware, salaryRoutes);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    environment: process.env.NODE_ENV,
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// ─── Root ────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    message: "Skyup Digital – Salary Slip API",
    version: "2.0.0",
    endpoints: {
      auth: {
        "POST /api/auth/login":  "Admin login → returns JWT",
        "GET  /api/auth/me":     "Get logged-in admin info (requires token)",
        "POST /api/auth/logout": "Logout (requires token)",
      },
      employees: {
        "GET  /api/employees":     "List all employees (🔒 auth required)",
        "GET  /api/employees/:id": "Get employee by ID (🔒 auth required)",
        "POST /api/employees":     "Create new employee (🔒 auth required)",
        "PUT  /api/employees/:id": "Update employee (🔒 auth required)",
      },
      salary: {
        "POST /api/salary/send":         "Save salary + send email (🔒 auth required)",
        "GET  /api/salary/receipts":     "Get all receipts (🔒 auth required)",
        "POST /api/salary/resend-email": "Resend salary slip email (🔒 auth required)",
      },
      health: "GET /health",
    },
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[Unhandled error]", err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

// ─── Connect to MongoDB & Start Server ───────────────────────────────────────
async function startServer() {
  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB connected:", mongoose.connection.db.databaseName);

    app.listen(PORT, () => {
      console.log(`\n🚀 Salary API running on http://localhost:${PORT}`);
      console.log(`📋 API docs:    http://localhost:${PORT}/`);
      console.log(`❤️  Health:      http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Closing gracefully...");
  await mongoose.connection.close();
  process.exit(0);
});

startServer();