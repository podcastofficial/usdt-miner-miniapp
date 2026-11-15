import crypto from "node:crypto";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newReferralCode(len = 10) {
  return Array.from(crypto.randomBytes(len), b => ALPHABET[b % ALPHABET.length]).join("");
}

/** Extracts the inviter's referral code from a Telegram start_param like "ref_ABCDEFGH23". Pure. */
export function parseRefParam(startParam) {
  const m = /^ref_([A-HJ-NP-Za-hj-np-z2-9]{10})$/.exec(String(startParam || ""));
  return m ? m[1].toUpperCase() : null;
}
