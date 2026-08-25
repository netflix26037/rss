const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');

const parser = new Parser();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 WebDashboard/2.0';

// ==== خدمات الترجمة (بالترتيب: نجرب كل واحدة قبل الانتقال للتالية) ====

async function translateViaMyMemory(cleanText) {
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=en|ar`;
        const response = await axios.get(url, { timeout: 6000 });
        const translated = response.data?.responseData?.translatedText;
        // MyMemory أحياناً يرجّع رسالة تحذير نصية بدل ترجمة حقيقية عند تجاوز الحد اليومي
        if (translated && !translated.toUpperCase().includes('MYMEMORY WARNING')) {
            return translated;
        }
    } catch (e) {
        console.log(`فشل MyMemory: ${e.message}`);
    }
    return null;
}

const LINGVA_MIRRORS = [
    'https://lingva.ml',
    'https://lingva.garudalinux.org',
    'https://translate.plausibility.cloud'
];

async function translateViaLingva(cleanText) {
    for (const base of LINGVA_MIRRORS) {
        try {
            const url = `${base}/api/v1/en/ar/${encodeURIComponent(cleanText)}`;
            const response = await axios.get(url, { timeout: 6000 });
            if (response.data && response.data.translation) {
                return response.data.translation;
            }
        } catch (e) {
            console.log(`فشل Lingva (${base}): ${e.message}`);
            // نجرب المرآة (mirror) التالية
        }
    }
    return null;
}

async function translateText(text) {
    if (!text || !text.trim()) return '';
    const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 250);
    if (!cleanText) return '';

    // المحاولة 1: MyMemory (مزوّد أساسي، مجاني وبدون مفتاح)
    let result = await translateViaMyMemory(cleanText);
    if (result) return result;

    // المحاولة 2: Lingva Translate (يجرب عدة مرايا)
    result = await translateViaLingva(cleanText);
    if (result) return result;

    // فشلت كل المحاولات — نرجع النص الأصلي مع تنبيه واضح في اللوق
    console.log(`⚠️ تعذّرت ترجمة النص بالكامل، سيُعرض بالإنجليزي: "${cleanText.substring(0, 40)}..."`);
    return cleanText;
}

// ==== جلب الخلاصات ====

async function fetchXmlWithFallback(rawUrl) {
    try {
        const res = await axios.get(rawUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 8000
        });
        return res.data;
    } catch (err) {
        if (err.response && err.response.status === 429) {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`;
            const proxyRes = await axios.get(proxyUrl, { timeout: 10000 });
            return proxyRes.data;
        }
        throw err;
    }
}

function groupRedditSources(sources) {
    const redditSubreddits = [];
    const nonRedditSources = [];

    sources.forEach(src => {
        const match = src.url.match(/reddit\.com\/r\/([^/]+)\/\.rss/i);
        if (match && match[1]) {
            redditSubreddits.push(match[1]);
        } else {
            nonRedditSources.push(src);
        }
    });

    const groupedSources = [...nonRedditSources];
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

    const sources = groupRedditSources(rawSources);
    console.log(`تم تقليص الطلبات من ${rawSources.length} إلى ${sources.length} طلباً مدمجاً لتفادي الحظر.`);

    let allArticles = [];

    for (const source of sources) {
        try {
            console.log(`جاري جلب: ${source.name}...`);
            const xmlData = await fetchXmlWithFallback(source.url);
            const feed = await parser.parseString(xmlData);

            // تم رفع العدد هنا إلى 10 مقالات لكل مصدر لضمان تدفق ممتاز مع الحفاظ على استقرار الأداء
            const items = (feed.items || []).slice(0, 10);

            for (const item of items) {
                const rawTitle = item.title || '';
                const rawDesc = item.contentSnippet || item.content || item.summary || '';

                let imageUrl = null;
                if (item['media:content'] && item['media:content'].$.url) imageUrl = item['media:content'].$.url;
                else if (item['media:thumbnail'] && item['media:thumbnail'].$.url) imageUrl = item['media:thumbnail'].$.url;
                else if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;

                const arabicTitle = await translateText(rawTitle);
                await sleep(300); // فاصل زمني آمن للترجمة (تم رفعه لتفادي حظر المرايا المجانية)
                const arabicDescription = await translateText(rawDesc);
                await sleep(300); // فاصل زمني آمن للترجمة

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

            await sleep(2000); // مهلة بين المصادر لتجنب ضغط الخوادم

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
