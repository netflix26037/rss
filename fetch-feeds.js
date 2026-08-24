const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');

const parser = new Parser({
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure']
    }
});

// دالة ترجمة مستقرة لا تحظرها السيرفرات
async function translateText(text) {
    if (!text || !text.trim()) return '';
    
    // تنظيف النص
    const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 300);
    if (!cleanText) return '';

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(cleanText)}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            timeout: 5000
        });
        
        if (response.data && response.data[0]) {
            return response.data[0].map(item => item[0]).join('');
        }
    } catch (error) {
        console.log(`تعثرت ترجمة جزيئية: ${cleanText.substring(0, 20)}`);
    }
    return cleanText;
}

async function run() {
    let sources = [];
    try {
        const sourcesData = fs.readFileSync('./sources.json', 'utf8');
        sources = JSON.parse(sourcesData);
    } catch (e) {
        console.log('استخدام القائمة الافتراضية للمصادر...');
        sources = [
            { name: 'Reddit WorldNews', url: 'https://www.reddit.com/r/worldnews/.rss', category: 'أخبار' },
            { name: 'Reddit Technology', url: 'https://www.reddit.com/r/technology/.rss', category: 'تقنية' }
        ];
    }

    let allArticles = [];

    for (const source of sources) {
        try {
            console.log(`جاري جلب وترجمة: ${source.name}...`);
            const feed = await parser.parseURL(source.url);
            const items = feed.items.slice(0, 8); // أفضل 8 مقالات لسرعة التنفيذ

            for (const item of items) {
                const rawTitle = item.title || '';
                const rawDesc = item.contentSnippet || item.content || item.summary || '';

                let imageUrl = null;
                if (item['media:content'] && item['media:content'].$.url) imageUrl = item['media:content'].$.url;
                else if (item['media:thumbnail'] && item['media:thumbnail'].$.url) imageUrl = item['media:thumbnail'].$.url;
                else if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;

                // ترجمة العنوان والوصف هنا على السيرفر
                const arabicTitle = await translateText(rawTitle);
                const arabicDescription = await translateText(rawDesc);

                allArticles.push({
                    id: item.guid || item.link || `id-${Math.random()}`,
                    title: rawTitle,
                    arabicTitle: arabicTitle || rawTitle,
                    description: rawDesc,
                    arabicDescription: arabicDescription || rawDesc,
                    link: item.link || '#',
                    sourceName: source.name,
                    category: source.category || 'عام',
                    pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
                    media: { image: imageUrl }
                });
            }
        } catch (err) {
            console.log(`خطأ في جلب ${source.name}:`, err.message);
        }
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    fs.writeFileSync('./feed.json', JSON.stringify(allArticles, null, 2), 'utf8');
    console.log(`تم حفظ ${allArticles.length} مقالة مترجمة جاهزة في feed.json`);
}

run();
