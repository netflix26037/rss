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

async function translateViaGoogle(cleanText) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(cleanText)}`;
        const response = await axios.get(url, { timeout: 6000 });
        if (response.data && response.data[0]) {
            return response.data[0].map(part => part[0]).join('');
        }
    } catch (e) {
        console.log(`فشل Google Translate: ${e.message}`);
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

    // المحاولة 3: Google Translate (نفس المزوّد الذي تستخدمه الصفحة نفسها، وهو الأكثر ثباتاً)
    result = await translateViaGoogle(cleanText);
    if (result) return result;

    // فشلت كل المحاولات — نُرجع فارغاً (وليس النص الإنجليزي) حتى تلتقطه الصفحة
    // وتحاول ترجمته من طرف المتصفح بدل أن يعلق بالإنجليزي بشكل دائم
    console.log(`⚠️ تعذّرت ترجمة النص من كل المزوّدين، ستحاول الصفحة ترجمته لاحقاً: "${cleanText.substring(0, 40)}..."`);
    return '';
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

function loadTranslationCache() {
    const cache = new Map();
    try {
        const raw = fs.readFileSync('./feed.json', 'utf8');
        const previousArticles = JSON.parse(raw);
        for (const article of previousArticles) {
            // نخزّن فقط المقالات التي تُرجمت فعلاً بنجاح (الترجمة تختلف عن النص الأصلي)
            const titleOk = article.arabicTitle && article.arabicTitle !== article.title;
            const descOk = article.arabicDescription && article.arabicDescription !== article.description;
            if (titleOk || descOk) {
                cache.set(article.id, {
                    arabicTitle: titleOk ? article.arabicTitle : null,
                    arabicDescription: descOk ? article.arabicDescription : null
                });
            }
        }
        console.log(`تم تحميل ${cache.size} ترجمة محفوظة مسبقاً من feed.json (لن تُعاد ترجمتها).`);
    } catch (e) {
        console.log('لا يوجد feed.json سابق، سيبدأ الأرشيف من الصفر.');
    }
    return cache;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isWithinLast24Hours(pubDateStr) {
    if (!pubDateStr) return true; // لو ما فيه تاريخ، نعتبره حديث احتياطاً
    const pubTime = new Date(pubDateStr).getTime();
    if (isNaN(pubTime)) return true; // تاريخ غير قابل للتحليل، نعتبره حديث احتياطاً
    return (Date.now() - pubTime) <= ONE_DAY_MS;
}

async function run() {
    const translationCache = loadTranslationCache();
    let translatedCount = 0;
    let reusedCount = 0;
    let skippedOldCount = 0;

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
                const itemPubDate = item.pubDate || item.isoDate || null;
                if (!isWithinLast24Hours(itemPubDate)) {
                    skippedOldCount++;
                    continue; // تجاهل المقالات الأقدم من 24 ساعة قبل حتى ترجمتها
                }

                const rawTitle = item.title || '';
                const rawDesc = item.contentSnippet || item.content || item.summary || '';

                let imageUrl = null;
                if (item['media:content'] && item['media:content'].$.url) imageUrl = item['media:content'].$.url;
                else if (item['media:thumbnail'] && item['media:thumbnail'].$.url) imageUrl = item['media:thumbnail'].$.url;
                else if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;

                const articleId = item.guid || item.link || `id-${rawTitle}-${source.name}`;
                const cached = translationCache.get(articleId);

                let arabicTitle;
                if (cached && cached.arabicTitle) {
                    arabicTitle = cached.arabicTitle;
                    reusedCount++;
                } else {
                    arabicTitle = await translateText(rawTitle);
                    await sleep(300); // فاصل زمني آمن للترجمة
                    translatedCount++;
                }

                let arabicDescription;
                if (cached && cached.arabicDescription) {
                    arabicDescription = cached.arabicDescription;
                    reusedCount++;
                } else {
                    arabicDescription = await translateText(rawDesc);
                    await sleep(300); // فاصل زمني آمن للترجمة
                    translatedCount++;
                }

                allArticles.push({
                    id: articleId,
                    title: rawTitle,
                    arabicTitle: arabicTitle || '',
                    description: rawDesc,
                    arabicDescription: arabicDescription || '',
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
    console.log(`تمت العملية بنجاح! إجمالي المقالات (آخر 24 ساعة فقط): ${allArticles.length} | متجاهلة لقدمها: ${skippedOldCount} | ترجمات معاد استخدامها: ${reusedCount} | طلبات ترجمة جديدة فعلية: ${translatedCount}`);
}

run();
