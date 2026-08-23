export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    try {
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        
        let sourcesList = [];
        try {
            const feedRes = await fetch(`${protocol}://${host}/feed.json`);
            if (feedRes.ok) {
                const sources = await feedRes.json();
                sourcesList = Array.isArray(sources) ? sources : (sources.sources || []);
            }
        } catch (e) {}

        const requestedUrl = req.query.url;
        const requestedCategory = req.query.category;
        const requestedName = req.query.name;

        let filteredSources = sourcesList;
        if (requestedUrl) {
            filteredSources = [{ name: requestedName || 'المصدر', url: requestedUrl }];
        } else if (requestedCategory) {
            filteredSources = sourcesList.filter(s => (s.category || 'عام') === requestedCategory);
        }

        async function translateText(text) {
            if (!text || !text.trim()) return text;
            try {
                const trRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(text.substring(0, 500))}`);
                const data = await trRes.json();
                if (data && data[0]) {
                    return data[0].map(item => item[0]).join('');
                }
            } catch (e) {}
            return text;
        }

        let allArticles = [];

        for (const source of filteredSources.slice(0, 10)) {
            try {
                const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}`;
                const rRes = await fetch(rssUrl);
                const rData = await rRes.json();

                if (rData.status === 'ok' && rData.items) {
                    for (const item of rData.items.slice(0, 8)) {
                        const cleanDesc = item.description ? item.description.replace(/<[^>]*>?/gm, '').trim().substring(0, 250) : '';
                        
                        const [translatedTitle, translatedDesc] = await Promise.all([
                            translateText(item.title),
                            translateText(cleanDesc)
                        ]);

                        const imgMatch = item.description ? item.description.match(/<img[^>]+src="([^">]+)"/) : null;
                        const image = item.thumbnail || (imgMatch ? imgMatch[1] : null);

                        allArticles.push({
                            id: item.link || item.guid || (item.title + Math.random()),
                            title: translatedTitle || item.title,
                            link: item.link,
                            pubDate: item.pubDate || new Date().toISOString(),
                            description: translatedDesc || cleanDesc,
                            sourceName: source.name,
                            media: { image: image }
                        });
                    }
                }
            } catch (e) {}
        }

        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        return res.status(200).json({ articles: allArticles });
    } catch (error) {
        return res.status(200).json({ articles: [], error: error.message });
    }
}