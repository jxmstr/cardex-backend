// api/price.js — Vercel serverless function
// Holds your eBay key (env vars) and returns card pricing from the eBay
// Browse API (current live listings), with tighter matching + outlier trimming
// so one absurd listing can't distort the price.
//
//   GET /api/price?q=Monkey.D.Luffy OP01-060&grade=PSA 10&market=us
//
// Env vars (set in Vercel, never in code):
//   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing eBay credentials in environment variables");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const resp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  if (!resp.ok) throw new Error(`eBay token error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

const MARKETPLACE = { us: "EBAY_US", uk: "EBAY_GB" };

// trimmed stats: drop the cheapest/most-expensive 10% before averaging,
// so a single junk listing can't wreck the numbers
function robustStats(prices, currency) {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(cut, sorted.length - cut || sorted.length);
  const arr = trimmed.length ? trimmed : sorted;
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    count: sorted.length,
    currency,
    low: sorted[0],
    high: sorted[sorted.length - 1],
    median,
    avg: +(arr.reduce((s, n) => s + n, 0) / arr.length).toFixed(2), // trimmed mean
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { q = "", grade = "", market = "us" } = req.query;
    if (!q) return res.status(400).json({ error: "Missing q (search query)" });

    const token = await getToken();
    const region = MARKETPLACE[String(market).toLowerCase()] || "EBAY_US";

    // Pull the card ID out of the query (e.g. "OP01-060") to filter strictly.
    const idMatch = q.match(/\b([A-Z]{2,4}\d{2}-\d{3})\b/i);
    const cardId = idMatch ? idMatch[1].toUpperCase() : null;

    const term = `${q} ${grade}`.trim();
    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search" +
      `?q=${encodeURIComponent(term)}` +
      `&category_ids=183454` +
      `&limit=100` +
      `&filter=buyingOptions:{FIXED_PRICE}`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": region,
        "Content-Type": "application/json",
      },
    });
    if (!r.ok) return res.status(r.status).json({ error: `eBay search error: ${await r.text()}` });

    const data = await r.json();
    let items = data.itemSummaries || [];

    // STRICT MATCH. Priority:
    //  1) listings whose title contains the exact card ID  → best
    //  2) else listings containing all significant name words → good
    //  3) else keep nothing rather than show wrong cards     → honest
    const nameOnly = q.replace(/\b[A-Z]{2,4}\d{2}-\d{3}\b/i, "").trim();
    const nameWords = nameOnly.split(/[^A-Za-z]+/).filter((w) => w.length >= 3);

    if (cardId) {
      const idLoose = cardId.replace("-", "[- ]?");
      const reId = new RegExp(idLoose, "i");
      const byId = items.filter((it) => reId.test(it.title || ""));
      if (byId.length >= 1) {
        items = byId;                       // any exact-ID match wins
      } else if (nameWords.length) {
        // fall back to NAME match (all words present), not loose keyword soup
        const byName = items.filter((it) =>
          nameWords.every((w) => new RegExp("\\b" + w, "i").test(it.title || ""))
        );
        items = byName; // may be empty → we report "no clean matches" honestly
      }
    }

    // If a grade was requested, prefer listings that mention it
    if (grade && grade.toLowerCase() !== "raw") {
      const g = grade.replace(/\s+/g, "\\s*");
      const re = new RegExp(g, "i");
      const graded = items.filter((it) => re.test(it.title || ""));
      if (graded.length >= 3) items = graded;
    } else if (grade.toLowerCase() === "raw") {
      // exclude obviously graded listings for a "raw" lookup
      items = items.filter((it) => !/\b(PSA|BGS|CGC|graded)\b/i.test(it.title || ""));
    }

    const prices = items
      .map((it) => parseFloat(it.price?.value))
      .filter((n) => !isNaN(n) && n > 0);

    const currency = items[0]?.price?.currency || (region === "EBAY_GB" ? "GBP" : "USD");
    const stats = robustStats(prices, currency);

    const listings = items.slice(0, 15).map((it) => ({
      title: it.title,
      price: parseFloat(it.price?.value),
      currency: it.price?.currency,
      condition: it.condition || "—",
      url: it.itemWebUrl,
      image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
      seller: it.seller?.username || "—",
    }));

    return res.status(200).json({
      query: term,
      cardId,
      market: region,
      stats,
      listings,
      note: "Live eBay listings (Browse API), strict-matched to the card ID with outlier trimming. Sold prices require Marketplace Insights API.",
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
