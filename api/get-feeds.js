export default async function handler(req, res) {
    // إعدادات الترويسة للتخزين المؤقت ومنع البطء
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    try {
        // 1. قراءة ملف feed.json الخاص بك
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const feedRes = await fetch(`${protocol}://${host}/feed.json`);
        
        if (!feedRes.ok) throw new Error('فشل قراءة feed.json');
        const sources = await feedRes.json();
        const sourcesList = Array.isArray(sources) ? sources : (sources.sources || []);

        // 2. دالة الترجمة السريعة عبر السيرفر
        async function translateText(text) {
            if (!text || !text.trim()) return text;
            try {
                const trRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(text)}`);
                const data = await trRes.json();
                if (data && data[0]) {
                    return data[0].map(item => item[0]).join('');
                }
            } catch (e) {}
            return text;
        }

        // 3. جلب الأخبار وترجمتها مباشرة من السيرفر
        let allArticles = [];

        for (const source of sourcesList.slice(0, 5)) { // أحدث المصادر
            try {
                const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}`;
                const rRes = await fetch(rssUrl);
                const rData = await rRes.json();

                if (rData.status === 'ok' && rData.items) {
                    for (const item of rData.items.slice(0, 6)) { // أحدث 6 منشورات من كل مصدر
                        const cleanDesc = item.description ? item.description.replace(/<[^>]*>?/gm, '').trim().substring(0, 180) : '';
                        
                        // ترجمة العنوان والوصف في السيرفر قبل إرسالهما للجوال
                        const [translatedTitle, translatedDesc] = await Promise.all([
                            translateText(item.title),
                            translateText(cleanDesc)
                        ]);

                        allArticles.push({
                            id: item.link || item.guid,
                            title: translatedTitle,
                            link: item.link,
                            pubDate: item.pubDate || new Date().toISOString(),
                            description: translatedDesc,
                            sourceName: source.name,
                            media: { image: item.thumbnail || null }
                        });
                    }
                }
            } catch (e) {}
        }

        // ترتيب الأخبار من الأحدث للأقدم
        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        return res.status(200).json({ articles: allArticles });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}