const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');

// إضافة User-Agent مخصص لمنع حظر Reddit 429
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 RedditNewsDashboard/1.0'
    },
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure']
    }
});

// دالة تأخير لمنع تتابع الطلبات السريع
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// دالة الترجمة
async function translateText(text) {
    if (!text || !text.trim()) return '';
    const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 300);
    if (!cleanText) return '';

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(cleanText)}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 5000
        });
        
        if (response.data && response.data[0]) {
            return response.data[0].map(item => item[0]).join('');
        }
    } catch (error) {
        console.log(`تعثرت الترجمة لـ: "${cleanText.substring(0, 15)}..."`);
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
            console.log(`جاري جلب: ${source.name}...`);
            const feed = await parser.parseURL(source.url);
            
            // قصر المقالات على أول 4 من كل مصدر لمنع تجاوز الحصة والترجمة بسرعة
            const items = feed.items.slice(0, 4);

            for (const item of items) {
                const rawTitle = item.title || '';
                const rawDesc = item.contentSnippet || item.content || item.summary || '';

                let imageUrl = null;
                if (item['media:content'] && item['media:content'].$.url) imageUrl = item['media:content'].$.url;
                else if (item['media:thumbnail'] && item['media:thumbnail'].$.url) imageUrl = item['media:thumbnail'].$.url;
                else if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;

                // ترجمة مع فترات توقف صغيرة تجنباً لإنذارات Rate-Limit
                const arabicTitle = await translateText(rawTitle);
                await sleep(150);
                const arabicDescription = await translateText(rawDesc);
                await sleep(150);

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

            // مهلة زمنية نصف ثانية بين كل المصادر (Subreddits)
            await sleep(500);

        } catch (err) {
            console.log(`تخطي المصدر ${source.name}: (سبب: ${err.message})`);
        }
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    fs.writeFileSync('./feed.json', JSON.stringify(allArticles, null, 2), 'utf8');
    console.log(`تمت العملية بنجاح! إجمالي المقالات المترجمة في feed.json: ${allArticles.length}`);
}

run();
