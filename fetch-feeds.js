const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');

const parser = new Parser();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 WebDashboard/2.0';

// دالة الترجمة السريعة
async function translateText(text) {
    if (!text || !text.trim()) return '';
    const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 250);
    if (!cleanText) return '';

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(cleanText)}`;
        const response = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 4000 });
        if (response.data && response.data[0]) {
            return response.data[0].map(item => item[0]).join('');
        }
    } catch (e) {
        // العودة للنص الأصلي عند التعثر
    }
    return cleanText;
}

// دالة جلب RSS مع محاولة استخدام Proximity Proxy عند حظر 429
async function fetchXmlWithFallback(rawUrl) {
    try {
        const res = await axios.get(rawUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 8000
        });
        return res.data;
    } catch (err) {
        if (err.response && err.response.status === 429) {
            // تجربة الجلب عبر وكيل مفتوح في حال الحظر
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`;
            const proxyRes = await axios.get(proxyUrl, { timeout: 10000 });
            return proxyRes.data;
        }
        throw err;
    }
}

// دالة تحويل قائمة sources إلى مجموعات مدمجة (Multi-subreddits)
function groupRedditSources(sources) {
    const redditSubreddits = [];
    const nonRedditSources = [];

    sources.forEach(src => {
        const match = src.url.match(/reddit\.com\/r\/([^/]+)/i);
        if (match && match[1]) {
            redditSubreddits.push(match[1]);
        } else {
            nonRedditSources.push(src);
        }
    });

    const groupedSources = [...nonRedditSources];

    // تقسيم المجتمعات إلى مجموعات (كل مجموعة تحتوي 12 مجتمعاً)
    const CHUNK_SIZE = 12;
    for (let i = 0; i < redditSubreddits.length; i += CHUNK_SIZE) {
        const chunk = redditSubreddits.slice(i, i + CHUNK_SIZE);
        const combinedSubs = chunk.join('+');
        groupedSources.push({
            name: `مجموعة ريديت (${i / CHUNK_SIZE + 1})`,
            url: `https://www.reddit.com/r/${combinedSubs}/.rss`,
            category: 'مُدمج'
        });
    }

    return groupedSources;
}

async function run() {
    let rawSources = [];
    try {
        const sourcesData = fs.readFileSync('./sources.json', 'utf8');
        rawSources = JSON.parse(sourcesData);
    } catch (e) {
        console.log('استخدام القائمة الافتراضية...');
        rawSources = [
            { name: 'WorldNews', url: 'https://www.reddit.com/r/worldnews/.rss', category: 'أخبار' }
        ];
    }

    // دمج الـ 110 مصدر إلى مجموعات قليلة لتفادي حظر 429
    const sources = groupRedditSources(rawSources);
    console.log(`تم تقليص الطلبات من ${rawSources.length} إلى ${sources.length} طلباً مدمجاً لتفادي الحظر.`);

    let allArticles = [];

    for (const source of sources) {
        try {
            console.log(`جاري جلب: ${source.name}...`);
            const xmlData = await fetchXmlWithFallback(source.url);
            const feed = await parser.parseString(xmlData);

            const items = (feed.items || []).slice(0, 4);

            for (const item of items) {
                const rawTitle = item.title || '';
                const rawDesc = item.contentSnippet || item.content || item.summary || '';

                let imageUrl = null;
                if (item['media:content'] && item['media:content'].$.url) imageUrl = item['media:content'].$.url;
                else if (item['media:thumbnail'] && item['media:thumbnail'].$.url) imageUrl = item['media:thumbnail'].$.url;
                else if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;

                const arabicTitle = await translateText(rawTitle);
                await sleep(100);
                const arabicDescription = await translateText(rawDesc);
                await sleep(100);

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

            // مهلة ثانيتين بين كل مجموعة وأخرى
            await sleep(2000);

        } catch (err) {
            console.log(`تخطي المصدر ${source.name}: (سبب: ${err.message})`);
            await sleep(2000);
        }
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    fs.writeFileSync('./feed.json', JSON.stringify(allArticles, null, 2), 'utf8');
    console.log(`تمت العملية بنجاح! إجمالي المقالات المحدثة: ${allArticles.length}`);
}

run();
