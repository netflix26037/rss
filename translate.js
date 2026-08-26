// Vercel Serverless Function — /api/translate
// يستدعي هذا الملف Google Translate من طرف الخادم (بلا قيود CORS)
// ثم يرجّع النتيجة للمتصفح بصيغة JSON بسيطة.
// استدعاء من الواجهة: /api/translate?q=النص%20هنا

export default async function handler(req, res) {
  // السماح لواجهتنا نفسها فقط (أو للكل إذا رغبت لاحقاً بتوسيع الاستخدام)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

  const text = (req.query.q || '').toString().trim();
  if (!text) {
    return res.status(400).json({ error: 'missing text (q)' });
  }

  const clipped = text.substring(0, 400);

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(clipped)}`;
    const response = await fetch(url, {
      headers: {
        // بعض الخوادم ترفض الطلبات التي لا تحمل User-Agent يشبه متصفحاً حقيقياً
        'User-Agent': 'Mozilla/5.0 (compatible; TranslateProxy/1.0)'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: `upstream status ${response.status}` });
    }

    const data = await response.json();
    const translated = Array.isArray(data?.[0])
      ? data[0].map((part) => part[0]).join('')
      : '';

    if (!translated) {
      return res.status(502).json({ error: 'empty translation' });
    }

    return res.status(200).json({ translated });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'translation failed' });
  }
}
