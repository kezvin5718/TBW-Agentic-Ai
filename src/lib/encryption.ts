import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
// Derive a 32-byte key from ENCRYPTION_KEY or use a robust fallback key for local environments
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY 
  ? crypto.scryptSync(process.env.ENCRYPTION_KEY, "salt", 32)
  : Buffer.from("f4fa96c56dccff238ccbc01d125588832a818c39e248b6103b41d20059530467", "hex"); // 32 bytes hex key
const IV_LENGTH = 16;

/**
 * Encrypt a text string
 */
export function encrypt(text: string): string {
  if (!text) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt an encrypted text string
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";
  const [ivHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !encrypted) {
    throw new Error("Invalid encrypted credentials format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
