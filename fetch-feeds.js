const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');

const parser = new Parser({
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure']
    }
});

// دالة الانتظار والمهلة الزمنية
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// مصفوفة متغيرة لـ User-Agents لتخطي حظر الحماية
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'RedditNewsBot/2.0 (by /u/custom_dashboard)'
];

function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// دالة الترجمة الآمنة
async function translateText(text) {
    if (!text || !text.trim()) return '';
    const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 250);
    if (!cleanText) return '';

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(cleanText)}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': getRandomUserAgent() },
            timeout: 4000
        });
        
        if (response.data && response.data[0]) {
            return response.data[0].map(item => item[0]).join('');
        }
    } catch (error) {
        // في حال فشل الترجمة نعيد النص الأصلي فوراً دون إيقاف السكريبت
    }
    return cleanText;
}

// دالة جلب RSS وتخطى حظر 429 عبر Axios
async function fetchRssFeed(url) {
    const response = await axios.get(url, {
        headers: { 
            'User-Agent': getRandomUserAgent(),
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 8000
    });
    return await parser.parseString(response.data);
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
    console.log(`بدء معالجة ${sources.length} مصدراً...`);

    for (const source of sources) {
        try {
            console.log(`جاري جلب: ${source.name}...`);
            const feed = await fetchRssFeed(source.url);
            
            // نأخذ أحدث مقالتين فقط من كل subreddit لتفادي ضغط الطلبات والحدود
            const items = (feed.items || []).slice(0, 2);

            for (const item of items) {
                const rawTitle = item.title || '';
                const rawDesc = item.contentSnippet || item.content || item.summary || '';

                let imageUrl = null;
                if (item['media:content'] && item['media:content'].$.url) imageUrl = item['media:content'].$.url;
                else if (item['media:thumbnail'] && item['media:thumbnail'].$.url) imageUrl = item['media:thumbnail'].$.url;
                else if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;

                // ترجمة مع توقف 200ms
                const arabicTitle = await translateText(rawTitle);
                await sleep(200);
                const arabicDescription = await translateText(rawDesc);
                await sleep(200);

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

            // مهلة زمنية (1.5 ثانية) بين كل مصدر لتفادي حظر Reddit 429
            await sleep(1500);

        } catch (err) {
            console.log(`تخطي المصدر ${source.name}: (سبب: ${err.response?.status || err.message})`);
            // انتظار ثانية قبل المحاولة مع المصدر التالي عند حدوث أخطاء
            await sleep(1000);
        }
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    fs.writeFileSync('./feed.json', JSON.stringify(allArticles, null, 2), 'utf8');
    console.log(`تمت العملية بنجاح! إجمالي المقالات المحدثة في feed.json: ${allArticles.length}`);
}

run();
