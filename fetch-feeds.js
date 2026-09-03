const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');

const parser = new Parser();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 WebDashboard/2.0';

// ==== الترجمة عبر Azure Translator ====
// يعتمد على مفتاح API حقيقي (وليس خدمات مجانية عامة كانت تُحظر سابقاً بسبب IP
// خوادم GitHub Actions المشتركة). المفتاح والمنطقة يُقرآن من متغيرات البيئة
// AZURE_TRANSLATOR_KEY و AZURE_TRANSLATOR_REGION، ويجب ضبطهما كـ GitHub Secrets
// (Settings → Secrets and variables → Actions) — لا تضع القيم هنا مباشرة أبداً.

const AZURE_TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY;
const AZURE_TRANSLATOR_REGION = process.env.AZURE_TRANSLATOR_REGION || 'qatarcentral';
const AZURE_TRANSLATOR_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';

// إعادة محاولة بسيطة عند فشل مؤقت (مثل تجاوز حد الطلبات اللحظي 429/5xx)
async function translateText(text, retries = 2) {
    if (!text || !text.trim()) return '';

    if (!AZURE_TRANSLATOR_KEY) {
        console.log('  ⚠️  AZURE_TRANSLATOR_KEY غير مضبوط — سيتم تخطي الترجمة لهذا النص.');
        return '';
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await axios({
                baseURL: AZURE_TRANSLATOR_ENDPOINT,
                url: '/translate',
                method: 'post',
                headers: {
                    'Ocp-Apim-Subscription-Key': AZURE_TRANSLATOR_KEY,
                    'Ocp-Apim-Subscription-Region': AZURE_TRANSLATOR_REGION,
                    'Content-type': 'application/json',
                },
                params: {
                    'api-version': '3.0',
                    'from': 'en',
                    'to': 'ar',
                },
                data: [{ text }],
                timeout: 8000,
            });

            return res.data?.[0]?.translations?.[0]?.text || '';
        } catch (err) {
            const status = err.response?.status;
            const isRetryable = status === 429 || (status && status >= 500);
            if (isRetryable && attempt < retries) {
                await sleep(1000 * (attempt + 1));
                continue;
            }
            console.log('  ⚠️  فشل استدعاء Azure Translator:', err.response?.data || err.message);
            return '';
        }
    }
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
    // خريطة: اسم الساب-ريديت (بأحرف صغيرة) -> التصنيف والاسم الحقيقيين من sources.json
    const subredditMeta = {};

    sources.forEach(src => {
        const match = src.url.match(/reddit\.com\/r\/([^/]+)\/\.rss/i);
        if (match && match[1]) {
            redditSubreddits.push(match[1]);
            subredditMeta[match[1].toLowerCase()] = {
                category: src.category || 'اخبار',
                name: src.name
            };
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
            category: 'مُدمج', // احتياطي فقط — يُستبدل لكل مقالة بتصنيفها الحقيقي أدناه
            isGrouped: true
        });
    }

    return { groupedSources, subredditMeta };
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
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000; // لا نعرض أخباراً أقدم من 48 ساعة من صدورها

function isWithinAllowedAge(pubDateStr) {
  // مهم: لو ما فيه تاريخ أو التاريخ غير قابل للتحليل، نستبعد المقالة احتياطاً
  // (بدل قبولها) — لأن الهدف هو ضمان عدم تجاوز 48 ساعة بشكل صارم، لا التساهل.
  if (!pubDateStr) {
    console.log('  ⚠️  مقالة بدون تاريخ نشر — تم استبعادها احتياطاً');
    return false;
  }
  const pubTime = new Date(pubDateStr).getTime();
  if (isNaN(pubTime)) {
    console.log(`  ⚠️  تاريخ غير قابل للتحليل ("${pubDateStr}") — تم استبعاد المقالة احتياطاً`);
    return false;
  }
  return (Date.now() - pubTime) <= MAX_ARTICLE_AGE_MS;
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

    const { groupedSources: sources, subredditMeta } = groupRedditSources(rawSources);
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
                // isoDate تنسّقه مكتبة rss-parser بصيغة ISO موحّدة وقابلة للتحليل دائماً،
                // بينما pubDate هو النص الخام من المصدر وقد يأتي بصيغ غريبة لا يفهمها Date().
                // لذلك نعطي الأولوية لـ isoDate ونستخدم pubDate فقط كحل بديل.
                const itemPubDate = item.isoDate || item.pubDate || null;
                if (!isWithinAllowedAge(itemPubDate)) {
                    skippedOldCount++;
                    continue; // تجاهل المقالات الأقدم من 48 ساعة قبل حتى ترجمتها
                }

                const rawTitle = item.title || '';
                const rawDesc = item.contentSnippet || item.content || item.summary || '';
                // النص الكامل للخبر كما ورد بالفيد (content:encoded إن وجد، وإلا content العادي)،
                // يُستخدم لعرضه عند الضغط على زر "ملخص" بدل الوصف المختصر فقط.
                const rawFullContent = item['content:encoded'] || item.content || rawDesc;

                let imageUrl = null;
                if (item['media:content'] && item['media:content'].$.url) imageUrl = item['media:content'].$.url;
                else if (item['media:thumbnail'] && item['media:thumbnail'].$.url) imageUrl = item['media:thumbnail'].$.url;
                else if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;

                const articleId = item.guid || item.link || `id-${rawTitle}-${source.name}`;
                const cached = translationCache.get(articleId);

                // لو المقالة من مجموعة ريديت مدمجة، نستخرج اسم الساب-ريديت الحقيقي
                // من رابط المقالة نفسه ونرجعها لتصنيفها واسم مصدرها الأصليين
                // (بدل التصنيف العام "مُدمج") — هذا يحافظ على دقة التصنيف رغم
                // تحسين الأداء بدمج طلبات Reddit
                let articleCategory = source.category || 'اخبار';
                let articleSourceName = source.name;
                if (source.isGrouped) {
                    const linkMatch = (item.link || '').match(/reddit\.com\/r\/([^/]+)\//i);
                    const meta = linkMatch && subredditMeta[linkMatch[1].toLowerCase()];
                    if (meta) {
                        articleCategory = meta.category;
                        articleSourceName = meta.name;
                    }
                }


                let arabicTitle;
                if (cached && cached.arabicTitle) {
                    arabicTitle = cached.arabicTitle;
                    reusedCount++;
                } else {
                    arabicTitle = await translateText(rawTitle);
                    translatedCount++;
                }

                let arabicDescription;
                if (cached && cached.arabicDescription) {
                    arabicDescription = cached.arabicDescription;
                    reusedCount++;
                } else {
                    arabicDescription = await translateText(rawDesc);
                    translatedCount++;
                }

                allArticles.push({
                    id: articleId,
                    title: rawTitle,
                    arabicTitle: arabicTitle || '',
                    description: rawDesc,
                    arabicDescription: arabicDescription || '',
                    fullContent: rawFullContent,
                    link: item.link || '#',
                    sourceName: articleSourceName,
                    category: articleCategory,
                    pubDate: itemPubDate || new Date().toISOString(),
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
