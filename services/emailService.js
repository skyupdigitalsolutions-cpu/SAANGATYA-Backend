import { BrevoClient } from "@getbrevo/brevo";

// ── Initialize Brevo client ──────────────────────────────────────────────────
const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

// ── Number → Indian words ────────────────────────────────────────────────────
function numberToWords(num) {
  if (!num || num === 0) return "Zero";
  const ones  = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine"];
  const teens = ["Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens  = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const sub = (n) => {
    if (n === 0)  return "";
    if (n < 10)   return ones[n];
    if (n < 20)   return teens[n - 10];
    if (n < 100)  return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + sub(n % 100) : "");
  };
  const cr = Math.floor(num / 10000000);
  const lk = Math.floor((num % 10000000) / 100000);
  const th = Math.floor((num % 100000) / 1000);
  const rm = num % 1000;
  return [cr && sub(cr) + " Crore", lk && sub(lk) + " Lakh", th && sub(th) + " Thousand", rm && sub(rm)]
    .filter(Boolean).join(" ").trim();
}

// Plain integer formatting — matches frontend (no .00 decimals)
const fmt = (n) => Number(n || 0).toLocaleString("en-IN");

// ── Build a minimal valid PDF from a JPEG base64 string ─────────────────────
// No puppeteer, no external packages — pure PDF spec (works on any machine)
// ── Read actual pixel dimensions from a JPEG buffer ─────────────────────────
function readJpegDimensions(buf) {
  let i = 2; // skip initial FFD8
  while (i < buf.length - 4) {
    if (buf[i] !== 0xFF) break;
    const marker = buf[i + 1];
    const segLen = buf.readUInt16BE(i + 2);
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    i += 2 + segLen;
  }
  return { w: 3176, h: 4492 }; // fallback: scale:4 canvas
}

function buildPDFFromJpeg(base64Jpeg) {
  const raw = base64Jpeg.replace(/^data:image\/\w+;base64,/, "");
  const imgBuffer = Buffer.from(raw, "base64");

  // Read REAL pixel dimensions from the JPEG header
  const { w: imgW, h: imgH } = readJpegDimensions(imgBuffer);

  // A4 page in PDF points (72dpi): 595 x 842
  const W = 595, H = 842;

  const lines = [];
  const offsets = [];

  const push = (s) => lines.push(s);

  push("%PDF-1.4");
  push("%\xFF\xFF\xFF\xFF");

  offsets[1] = lines.join("\n").length + 1;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");

  offsets[2] = lines.join("\n").length + 1;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");

  offsets[3] = lines.join("\n").length + 1;
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj`);

  // Draw image scaled to fill the full A4 page
  const contentStr = `q ${W} 0 0 ${H} 0 0 cm /Im1 Do Q`;
  const contentBytes = Buffer.from(contentStr, "latin1");
  offsets[4] = lines.join("\n").length + 1;
  push(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n${contentStr}\nendstream\nendobj`);

  // Use REAL imgW/imgH here — this was the bug causing the tiny "S" corner
  offsets[5] = lines.join("\n").length + 1;
  push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBuffer.length} >>\nstream`);

  // Build the PDF buffer in parts (image is binary, rest is text)
  const textBefore = Buffer.from(lines.join("\n") + "\n", "latin1");
  const afterImage = `\nendstream\nendobj\n`;

  // Cross-reference table
  const xrefOffset = textBefore.length + imgBuffer.length + afterImage.length;
  const xrefLines = [
    "xref",
    `0 6`,
    "0000000000 65535 f \n",
  ];
  for (let i = 1; i <= 5; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  xrefLines.push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.concat([
    textBefore,
    imgBuffer,
    Buffer.from(afterImage, "latin1"),
    Buffer.from(xrefLines.join(""), "latin1"),
  ]);
}

// ── Email body ───────────────────────────────────────────────────────────────
function buildEmailBody(data) {
  const { employeeName, payMonth, isNewJoinee } = data;

  const totalEarnings  = (Number(data.basicSalary) || 0) + (Number(data.incentivePay) || 0) + (Number(data.travelAllowance) || 0);
  const totalDeduction = Number(data.lossOfPay) || 0;
  const netSalary      = totalEarnings - totalDeduction;

  const payMonthLabel = payMonth
    ? new Date(payMonth + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "—";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0 20px 20px 20px;background:#ffffff;font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.8;">

  <p>Dear ${employeeName},</p>

  <p>
    ${isNewJoinee
      ? `Welcome to <strong>Skyup Digital Solutions!</strong> We are pleased to have you on board.`
      : `Hope this email finds you well.`}
    Please find your salary slip for <strong>${payMonthLabel}</strong> attached to this email.
  </p>

  <p>
    <strong>Net Salary: &#x20B9; ${fmt(netSalary)}</strong><br/>
    (${numberToWords(Math.round(netSalary))} Rupees Only)
  </p>

  <p>
    Total Earnings: &#x20B9; ${fmt(totalEarnings)}<br/>
    Total Deductions: &#x20B9; ${fmt(totalDeduction)}
  </p>

  <p>This is a system-generated email. Please do not reply to this email directly.<br/>
  For any queries, contact HR at <a href="mailto:contact@skyupdigitalsolutions.com" style="color:#0037CA;">contact@skyupdigitalsolutions.com</a> or call +91 8867867775.</p>

  <br/>
  <p>
    Regards,<br/>
    <strong>HR Team</strong><br/>
    Skyup Digital Solutions<br/>
    Parinidhi #23, E Block, 14A Main Road, 2nd Floor,<br/>
    Sahakaranagar, Bangalore – 560092
  </p>

</body>
</html>`;
}

// ── Build a plain-text fallback PDF when no image is available (resend case) ─
function buildFallbackPDF(data) {
  const fmt = (n) => Number(n || 0).toLocaleString("en-IN");
  const totalEarnings  = (Number(data.basicSalary) || 0) + (Number(data.incentivePay) || 0) + (Number(data.travelAllowance) || 0);
  const totalDeduction = Number(data.lossOfPay) || 0;
  const netSalary      = totalEarnings - totalDeduction;
  const payMonthLabel  = data.payMonth
    ? new Date(data.payMonth + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "—";

  // Build a minimal PDF with embedded text (no image dependency)
  const lines = [];
  const offsets = [];
  const push = (s) => lines.push(s);

  const text = [
    `BT`,
    `/F1 18 Tf`,
    `50 800 Td`,
    `(Skyup Digital Solutions — Salary Slip) Tj`,
    `/F1 12 Tf`,
    `0 -30 Td`,
    `(Employee: ${data.employeeName || ""}) Tj`,
    `0 -18 Td`,
    `(Employee ID: ${data.employeeId || ""}) Tj`,
    `0 -18 Td`,
    `(Pay Month: ${payMonthLabel}) Tj`,
    `0 -18 Td`,
    `(Designation: ${data.designation || ""}) Tj`,
    `0 -18 Td`,
    `(Department: ${data.department || ""}) Tj`,
    `0 -30 Td`,
    `/F1 13 Tf`,
    `(EARNINGS) Tj`,
    `/F1 12 Tf`,
    `0 -20 Td`,
    `(Basic Salary: Rs. ${fmt(data.basicSalary)}) Tj`,
    `0 -18 Td`,
    `(Incentive Pay: Rs. ${fmt(data.incentivePay)}) Tj`,
    `0 -18 Td`,
    `(Travel Allowance: Rs. ${fmt(data.travelAllowance)}) Tj`,
    `0 -18 Td`,
    `(Total Earnings: Rs. ${fmt(totalEarnings)}) Tj`,
    `0 -30 Td`,
    `/F1 13 Tf`,
    `(DEDUCTIONS) Tj`,
    `/F1 12 Tf`,
    `0 -20 Td`,
    `(Loss of Pay: Rs. ${fmt(data.lossOfPay)}) Tj`,
    `0 -30 Td`,
    `/F1 14 Tf`,
    `(NET SALARY: Rs. ${fmt(netSalary)}) Tj`,
    `0 -30 Td`,
    `/F1 11 Tf`,
    `(Bank: ${data.bankName || ""}) Tj`,
    `0 -18 Td`,
    `(Account No: ${data.bankAcNo || ""}) Tj`,
    `0 -18 Td`,
    `(Transaction ID: ${data.transactionId || ""}) Tj`,
    `ET`,
  ].join("\n");

  push("%PDF-1.4");
  push("%\xFF\xFF\xFF\xFF");

  offsets[1] = lines.join("\n").length + 1;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");

  offsets[2] = lines.join("\n").length + 1;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");

  offsets[3] = lines.join("\n").length + 1;
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj`);

  const contentBytes = Buffer.from(text, "latin1");
  offsets[4] = lines.join("\n").length + 1;
  push(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n${text}\nendstream\nendobj`);

  offsets[5] = lines.join("\n").length + 1;
  push(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);

  const textBuf = Buffer.from(lines.join("\n") + "\n", "latin1");
  const xrefOffset = textBuf.length;
  const xrefLines = ["xref", `0 6`, "0000000000 65535 f \n"];
  for (let i = 1; i <= 5; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  xrefLines.push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.concat([textBuf, Buffer.from(xrefLines.join(""), "latin1")]);
}

// ── Send salary slip email with PDF attachment ───────────────────────────────
export async function sendSalarySlipEmail(data) {
  const { email, employeeName, payMonth, slipImageData } = data;

  console.log(`[Email] Generating PDF for ${employeeName} → ${email}`);

  // Use image-based PDF if canvas image is available (initial send),
  // otherwise fall back to text-based PDF (resend from history)
  const pdfBuffer = slipImageData
    ? buildPDFFromJpeg(slipImageData)
    : buildFallbackPDF(data);

  console.log(`[Email] Using ${slipImageData ? "image" : "fallback text"} PDF`);
  const pdfBase64 = pdfBuffer.toString("base64");

  const payMonthLabel = payMonth
    ? new Date(payMonth + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "Slip";

  const fileName = `Salary_Slip_${(employeeName || "Employee").replace(/\s+/g, "_")}_${payMonth || "Slip"}.pdf`;

  console.log(`[Email] PDF generated (${Math.round(pdfBase64.length / 1024)} KB), attaching as ${fileName}`);

  const payload = {
    subject: `Salary Slip for ${payMonthLabel} – Skyup Digital Solutions`,
    htmlContent: buildEmailBody(data),
    sender: {
      name:  process.env.BREVO_SENDER_NAME  || "Skyup Digital Solutions",
      email: process.env.BREVO_SENDER_EMAIL || "skyupdigitalsolutions@gmail.com",
    },
    to: [{ email, name: employeeName }],
    replyTo: {
      email: process.env.BREVO_SENDER_EMAIL || "skyupdigitalsolutions@gmail.com",
      name:  "Skyup HR",
    },
    attachment: [{ name: fileName, content: pdfBase64 }],
  };

  let result;
  if (client.smtp?.sendTransacEmail) {
    result = await client.smtp.sendTransacEmail(payload);
  } else if (client.transactionalEmails?.sendTransacEmail) {
    result = await client.transactionalEmails.sendTransacEmail(payload);
  } else {
    throw new Error("Brevo send method not found. Check @getbrevo/brevo version.");
  }

  console.log(`[Email] ✅ Email with PDF sent to ${email}`);
  return result;
}

// ── Send OTP email for forgot-password ──────────────────────────────────────
export async function sendOtpEmail({ email, name, otp }) {
  const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0 20px 20px 20px;background:#ffffff;font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.6;">
  <p style="margin:0 0 8px 0;">Dear ${name},</p>
  <p style="margin:0 0 8px 0;">You requested to reset your password for the <strong>Skyup Digital Salary L L P</strong>.</p>
  <p style="margin:0 0 8px 0;">Your One-Time Password (OTP) is:</p>
  <div style="margin:12px 0;text-align:center;">
    <span style="display:inline-block;font-size:32px;font-weight:800;letter-spacing:12px;color:#0037CA;background:#f0f4ff;padding:12px 28px;border-radius:12px;border:2px solid #c7d7ff;">${otp}</span>
  </div>
  <p style="margin:0 0 8px 0;">This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
  <p style="margin:0 0 8px 0;">If you did not request a password reset, please ignore this email.</p>
  <br/>
  <p style="margin:0;">Regards,<br/><strong>HR Team</strong><br/>Skyup Digital Solutions</p>
</body>
</html>`;

  const payload = {
    subject: "Password Reset OTP – Skyup Digital Solutions",
    htmlContent,
    sender: {
      name:  process.env.BREVO_SENDER_NAME  || "Skyup Digital Solutions",
      email: process.env.BREVO_SENDER_EMAIL || "skyupdigitalsolutions@gmail.com",
    },
    to: [{ email, name }],
  };

  let result;
  if (client.smtp?.sendTransacEmail) {
    result = await client.smtp.sendTransacEmail(payload);
  } else if (client.transactionalEmails?.sendTransacEmail) {
    result = await client.transactionalEmails.sendTransacEmail(payload);
  } else {
    throw new Error("Brevo send method not found.");
  }

  console.log(`[Email] ✅ OTP email sent to ${email}`);
  return result;
}
