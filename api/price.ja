// api/price.js — Vercel serverless function
// Holds your eBay key (via environment variables) and returns card pricing
// from the eBay Browse API (current live listings).
//
// Called by cardex.html like:
//   GET /api/price?q=Monkey.D.Luffy%20OP01-060&grade=PSA%2010&market=us
//
// Your eBay credentials are read from environment variables — NEVER hard-coded:
//   EBAY_CLIENT_ID      = your Production App ID (Client ID)
//   EBAY_CLIENT_SECRET  = your Production Cert ID (Client Secret)
//
// These are set in the Vercel dashboard (Project → Settings → Environment
// Variables), so they live on the server and are never exposed to the browser.

let cachedToken = null;
let tokenExpiry = 0;

// ── Get (and cache) an eBay OAuth application token ──────────────────────────
async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing eBay credentials in environment variables");

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const resp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`eBay token error ${resp.status}: ${txt}`);
  }
  const data = await resp.json();
  cachedToken = data.access_token;
  // refresh a minute before it actually expires
  tokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// ── Marketplace per region ───────────────────────────────────────────────────
const MARKETPLACE = {
  us: "EBAY_US",
  uk: "EBAY_GB",
};

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS so your local HTML file can call this
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { q = "", grade = "", market = "us" } = req.query;
    if (!q) return res.status(400).json({ error: "Missing q (search query)" });

    const token = await getToken();

    // Build the eBay search term: card name + ID + grade
    const term = `${q} ${grade}`.trim();
    const region = MARKETPLACE[String(market).toLowerCase()] || "EBAY_US";

    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search" +
      `?q=${encodeURIComponent(term)}` +
      `&category_ids=183454` + // Collectible Card Games > CCG Individual Cards
      `&limit=50` +
      `&filter=buyingOptions:{FIXED_PRICE}`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": region,
        "Content-Type": "application/json",
      },
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: `eBay search error: ${txt}` });
    }

    const data = await r.json();
    const items = data.itemSummaries || [];

    // Extract prices and compute simple stats
    const prices = items
      .map((it) => parseFloat(it.price?.value))
      .filter((n) => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);

    const currency = items[0]?.price?.currency || (region === "EBAY_GB" ? "GBP" : "USD");

    const stats =
      prices.length === 0
        ? null
        : {
            count: prices.length,
            currency,
            low: prices[0],
            high: prices[prices.length - 1],
            avg: +(prices.reduce((s, n) => s + n, 0) / prices.length).toFixed(2),
            median: prices[Math.floor(prices.length / 2)],
          };

    // Return a compact set of listings too (for the "live listings" view)
    const listings = items.slice(0, 12).map((it) => ({
      title: it.title,
      price: parseFloat(it.price?.value),
      currency: it.price?.currency,
      condition: it.condition || "—",
      url: it.itemWebUrl,
      image: it.image?.imageUrl || null,
      seller: it.seller?.username || "—",
    }));

    return res.status(200).json({
      query: term,
      market: region,
      stats,
      listings,
      note: "Live eBay listings (Browse API). For sold/completed prices, Marketplace Insights API access is required.",
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
