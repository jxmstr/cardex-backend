// api/image.js — Vercel serverless function
// Proxies a One Piece card image server-side, so it works even where the
// browser/webview blocks the original CDN (no hotlink/CORS issues).
//
// Called like:  GET /api/image?id=OP01-060
// Returns the card image bytes with permissive CORS + caching.

export default async function handler(req, res) {
  const { id = "" } = req.query;
  if (!/^[A-Za-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: "Invalid card id" });
  }

  // Sources tried in order (server-side fetch has no hotlink block)
  const sources = [
    `https://static.dotgg.gg/onepiece/cards/${id}.webp`,
    `https://en.onepiece-cardgame.com/images/cardlist/card/${id}.png`,
  ];

  for (const src of sources) {
    try {
      const r = await fetch(src, {
        headers: {
          // a normal-looking request so the source serves the image
          "User-Agent":
            "Mozilla/5.0 (compatible; CardexProxy/1.0)",
          Referer: "https://onepiece.gg/",
          Accept: "image/webp,image/png,image/*,*/*",
        },
      });
      if (!r.ok) continue;

      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", r.headers.get("content-type") || "image/webp");
      res.setHeader("Access-Control-Allow-Origin", "*");
      // cache aggressively — card art doesn't change
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      return res.status(200).send(buf);
    } catch {
      // try next source
    }
  }

  return res.status(404).json({ error: "Image not found for " + id });
}
