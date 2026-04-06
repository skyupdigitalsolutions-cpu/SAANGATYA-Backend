import mongoose from "mongoose";

const salaryRecordSchema = new mongoose.Schema(
  {
    employeeId:     { type: String, required: true, uppercase: true, trim: true },
    employeeName:   { type: String, required: true },
    email:          { type: String, required: true },
    designation:    { type: String, default: "" },
    department:     { type: String, default: "" },
    dateOfJoining:  { type: String, default: "" },
    bankName:       { type: String, default: "" },
    bankAcNo:       { type: String, default: "" },
    payMonth:       { type: String, required: true }, // "YYYY-MM"
    basicSalary:    { type: Number, required: true },
    incentivePay:   { type: Number, default: 0 },
    travelAllowance:{ type: Number, default: 0 },
    lossOfPay:      { type: Number, default: 0 },
    totalEarnings:  { type: Number, required: true },
    totalDeductions:{ type: Number, required: true },
    netSalary:      { type: Number, required: true },
    payDays:        { type: Number, required: true },
    lopDays:        { type: Number, default: 0 },
    transactionId:  { type: String, default: "" },
    emailSent:      { type: Boolean, default: false },
    emailSentAt:    { type: Date },
    isNewJoinee:    { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: "salary_records",
  }
);

// Compound index to avoid duplicate slip for same employee + month
salaryRecordSchema.index({ employeeId: 1, payMonth: 1 }, { unique: true });

export default mongoose.model("SalaryRecord", salaryRecordSchema);
