import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

const createAdmin = async () => {
  try {
    console.log("1️⃣  Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("2️⃣  Connected!");

    console.log("3️⃣  Importing Admin model...");
    const { default: Admin } = await import("../models/Admin.js");
    console.log("4️⃣  Admin model imported!");

    console.log("5️⃣  Checking existing admin...");
    const existingAdmin = await Admin.findOne({ email: "skyupdigitalsolutions@gmail.com" });
    if (existingAdmin) {
      console.log("⚠️  Admin already exists.");
      process.exit(0);
    }
    console.log("6️⃣  No existing admin found, creating...");

    const admin = new Admin({
      name: "SAANGATYA",
      email: "skyupdigitalsolutions@gmail.com",
      password: "Salary@2026",
      isActive: true,
    });
    console.log("7️⃣  Admin object created, saving...");

    await admin.save();
    console.log("✅ Admin created successfully!");
    console.log("📧 Login Email : skyupdigitalsolutions@gmail.com");
    console.log("🔑 Password    : Salary@2026");
    console.log("🔐 Owner Email : " + (process.env.OWNER_EMAIL || "NOT SET in .env"));

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error("📍 Stack:", err.stack);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected.");
    process.exit(0);
  }
};

createAdmin();
