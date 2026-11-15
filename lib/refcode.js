import crypto from "node:crypto";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newReferralCode(len = 10) {
  return Array.from(crypto.randomBytes(len), b => ALPHABET[b % ALPHABET.length]).join("");
}
