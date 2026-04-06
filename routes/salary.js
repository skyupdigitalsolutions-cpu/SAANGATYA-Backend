import { Router } from "express";
import { body, validationResult } from "express-validator";
import Employee from "../models/Employee.js";
import SalaryRecord from "../models/SalaryRecord.js";
import { sendSalarySlipEmail } from "../services/emailService.js";

const router = Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/salary/send
// Save salary record + send email to employee
// Called by the frontend when "GENERATE PDF" is clicked
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/send",
  [
    body("employeeId").trim().notEmpty().withMessage("Employee ID is required"),
    body("payMonth").trim().notEmpty().withMessage("Pay month is required (YYYY-MM)"),
    body("basicSalary").isNumeric().withMessage("Basic salary must be a number"),
    body("payDays").isNumeric().withMessage("Pay days must be a number"),
    body("email").isEmail().withMessage("Valid employee email is required"),
  ],
  validate,
  async (req, res) => {
    const {
      employeeId, employeeName, designation, department,
      dateOfJoining, payMonth, bankName, bankAcNo, email,
      payDays, lopDays, basicSalary, incentivePay,
      travelAllowance, lossOfPay, isNewJoinee, slipImageData, transactionId,
    } = req.body;

    const id = employeeId.trim().toUpperCase();

    try {
      // ── 1. If new joinee: upsert employee into DB ──────────────────────────
      if (isNewJoinee) {
        await Employee.findOneAndUpdate(
          { employeeId: id },
          {
            $set: {
              employeeId: id,
              employeeName, designation, department,
              dateOfJoining, bankName, bankAcNo, email,
              isActive: true,
            },
          },
          { upsert: true, new: true, runValidators: true }
        );
      }

      // ── 2. Compute salary figures ──────────────────────────────────────────
      const totalEarnings   = (Number(basicSalary) || 0) + (Number(incentivePay) || 0) + (Number(travelAllowance) || 0);
      const totalDeductions = Number(lossOfPay) || 0;
      const netSalary       = totalEarnings - totalDeductions;

      // ── 3. Save / update salary record ────────────────────────────────────
      const salaryRecord = await SalaryRecord.findOneAndUpdate(
        { employeeId: id, payMonth },
        {
          $set: {
            employeeId: id, employeeName, email, payMonth,
            designation:     designation     || "",
            department:      department      || "",
            dateOfJoining:   dateOfJoining   || "",
            bankName:        bankName        || "",
            bankAcNo:        bankAcNo        || "",
            basicSalary:     Number(basicSalary) || 0,
            incentivePay:    Number(incentivePay) || 0,
            travelAllowance: Number(travelAllowance) || 0,
            lossOfPay:       Number(lossOfPay) || 0,
            totalEarnings, totalDeductions, netSalary,
            payDays:  Number(payDays) || 0,
            lopDays:  Number(lopDays) || 0,
            transactionId: transactionId || "",
            isNewJoinee: Boolean(isNewJoinee),
          },
        },
        { upsert: true, new: true }
      );

      // ── 4. Send email via Brevo ────────────────────────────────────────────
      let emailSent   = false;
      let emailError  = null;

      try {
        await sendSalarySlipEmail({
          employeeId: id, employeeName, designation, department,
          dateOfJoining, payMonth, bankName, bankAcNo, email,
          payDays, lopDays, basicSalary, incentivePay,
          travelAllowance, lossOfPay, isNewJoinee, slipImageData,
        });

        // Mark email as sent in DB
        salaryRecord.emailSent   = true;
        salaryRecord.emailSentAt = new Date();
        await salaryRecord.save();
        emailSent = true;

        console.log(`[Email] ✅ Salary slip sent to ${email} for ${payMonth}`);
      } catch (emailErr) {
        // Don't fail the whole request if email fails — salary was saved
        emailError = emailErr.message || "Email sending failed";
        console.error(`[Email] ❌ Failed for ${email}:`, emailErr.message);
      }

      return res.status(200).json({
        success: true,
        message: emailSent
          ? `Salary slip saved and email sent to ${email}`
          : `Salary slip saved. Email could not be sent: ${emailError}`,
        emailSent,
        emailError,
        salaryRecord: {
          id:       salaryRecord._id,
          netSalary,
          payMonth,
        },
      });
    } catch (err) {
      console.error("[POST salary/send]", err);
      return res.status(500).json({ success: false, message: "Server error: " + err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/salary/history/:employeeId
// Get salary history for an employee
// ─────────────────────────────────────────────────────────────────────────────
router.get("/history/:employeeId", async (req, res) => {
  try {
    const id = req.params.employeeId.toUpperCase().trim();
    const records = await SalaryRecord.find({ employeeId: id })
      .sort({ payMonth: -1 })
      .lean();

    return res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    console.error("[GET salary/history]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/salary/resend-email
// Resend salary slip email for a specific record
// ─────────────────────────────────────────────────────────────────────────────
router.post("/resend-email", async (req, res) => {
  const { employeeId, payMonth } = req.body;
  if (!employeeId || !payMonth) {
    return res.status(400).json({ success: false, message: "employeeId and payMonth are required" });
  }

  try {
    const id = employeeId.toUpperCase().trim();

    // Fetch employee + salary record
    const [employee, record] = await Promise.all([
      Employee.findOne({ employeeId: id }).lean(),
      SalaryRecord.findOne({ employeeId: id, payMonth }).lean(),
    ]);

    if (!employee) return res.status(404).json({ success: false, message: "Employee not found" });
    if (!record)   return res.status(404).json({ success: false, message: "Salary record not found for this month" });

    await sendSalarySlipEmail({
      ...employee,
      ...record,
      email: employee.email,
    });

    await SalaryRecord.updateOne(
      { employeeId: id, payMonth },
      { $set: { emailSent: true, emailSentAt: new Date() } }
    );

    return res.json({ success: true, message: `Email resent to ${employee.email}` });
  } catch (err) {
    console.error("[POST salary/resend-email]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/salary/receipts
// Get all salary receipts, optionally filtered by ?month=MM&year=YYYY
// Uses aggregation to join Employee data so the full slip can be reconstructed
// ─────────────────────────────────────────────────────────────────────────────
router.get("/receipts", async (req, res) => {
  try {
    const { month, year } = req.query;
    const matchStage = {};

    if (year && month) {
      matchStage.payMonth = `${year}-${String(month).padStart(2, "0")}`;
    } else if (year) {
      matchStage.payMonth = { $regex: `^${year}-` };
    }

    const records = await SalaryRecord.aggregate([
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "employees",
          localField: "employeeId",
          foreignField: "employeeId",
          as: "empData",
        },
      },
      {
        $addFields: {
          empDoc: { $arrayElemAt: ["$empData", 0] },
        },
      },
      {
        $addFields: {
          designation:   { $ifNull: ["$empDoc.designation",   ""] },
          department:    { $ifNull: ["$empDoc.department",    ""] },
          dateOfJoining: { $ifNull: ["$empDoc.dateOfJoining", ""] },
          bankName:      { $ifNull: ["$empDoc.bankName",      ""] },
          bankAcNo:      { $ifNull: ["$empDoc.bankAcNo",      ""] },
        },
      },
      {
        $project: { empData: 0, empDoc: 0 },
      },
    ]);

    return res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    console.error("[GET salary/receipts]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
