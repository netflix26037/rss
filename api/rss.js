export default async function handler(req, res) {
    // السماح للموقع بقراءة البيانات وتجاوز حظر CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'يرجى تقديم رابط الخلاصة URL' });
    }

    try {
        const response = await fetch(url, {
            headers: {
                // التظاهر بطلب البيانات من متصفح عادي لمنع الحظر
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`فشل الجلب: ${response.statusText}`);
        }

        const data = await response.text();
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
