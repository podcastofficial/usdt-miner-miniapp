const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return res.status(500).json({
      ok: false,
      error: "Server configuration missing"
    });
  }

  const initData = req.body && req.body.initData;

  if (typeof initData !== "string" || !initData) {
    return res.status(400).json({
      ok: false,
      error: "Missing Telegram initData"
    });
  }

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");

    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
      return res.status(401).json({
        ok: false,
        error: "Invalid Telegram authentication data"
      });
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const received = Buffer.from(receivedHash, "hex");
    const calculated = Buffer.from(calculatedHash, "hex");

    if (
      received.length !== calculated.length ||
      !crypto.timingSafeEqual(received, calculated)
    ) {
      return res.status(401).json({
        ok: false,
        error: "Telegram verification failed"
      });
    }

    const authDate = Number(params.get("auth_date"));
    const now = Math.floor(Date.now() / 1000);

    if (
      !Number.isFinite(authDate) ||
      authDate > now + 30 ||
      now - authDate > 3600
    ) {
      return res.status(401).json({
        ok: false,
        error: "Telegram authentication data expired"
      });
    }

    let user;

    try {
      user = JSON.parse(params.get("user") || "null");
    } catch {
      user = null;
    }

    if (!user || !Number.isSafeInteger(user.id)) {
      return res.status(401).json({
        ok: false,
        error: "Invalid Telegram user"
      });
    }

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        first_name: user.first_name || "",
        last_name: user.last_name || "",
        username: user.username || null
      }
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request"
    });
  }
};