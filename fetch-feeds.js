const fs = require('fs');

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

function parseFeedItems(xmlText, sourceName) {
    const articles = [];
    const now = new Date();

    // استخراج العناصر عبر REGEX لضمان السرعة والتوافق في Node.js
    const itemMatches = xmlText.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];

    for (const itemXml of itemMatches) {
        const getTagContent = (tag) => {
            const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
            return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim() : '';
        };

        const title = getTagContent('title');
        let link = getTagContent('link');

        if (!link) {
            const linkHrefMatch = itemXml.match(/<link[^>]*href=["']([^"']+)["']/i);
            if (linkHrefMatch) link = linkHrefMatch[1];
        }

        const pubDateStr = getTagContent('pubDate') || getTagContent('published') || getTagContent('updated');
        const description = getTagContent('description') || getTagContent('content') || getTagContent('summary');

        const pubDate = new Date(pubDateStr);
        const diffHours = (now - pubDate) / (1000 * 60 * 60);

        // الاحتفاظ فقط بمقالات آخر 24 ساعة
        if (isNaN(diffHours) || diffHours <= 24) {
            const media = extractMediaFromXml(itemXml, description);

            articles.push({
                id: link || title,
                title: title.replace(/<[^>]*>?/gm, ''),
                link: link,
                pubDate: pubDateStr || new Date().toISOString(),
                description: description,
                sourceName: sourceName,
                media: media
            });
        }
    }
    return articles;
}

function extractMediaFromXml(xmlStr, descStr) {
    let media = { image: null, video: null };

    // فحص وسائط enclosure
    const encMatch = xmlStr.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']([^"']+)["']/i);
    if (encMatch) {
        const url = encMatch[1];
        const type = encMatch[2];
        if (type.includes('image') || url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) media.image = url;
        if (type.includes('video') || url.match(/\.(mp4|webm|ogg)$/i)) media.video = url;
    }

    // فحص الصور داخل الوصف
    if (!media.image) {
        const imgMatch = descStr.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch && !imgMatch[1].includes('preview.redd.it/award_images')) {
            media.image = imgMatch[1];
        }
    }

    // فحص الصور المصغرة thumbnail
    if (!media.image) {
        const thumbMatch = xmlStr.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i);
        if (thumbMatch) media.image = thumbMatch[1];
    }

    return media;
}

async function run() {
    try {
        console.log('قراءة ملف feeds.json...');
        const rawFeeds = fs.readFileSync('./feeds.json', 'utf8');
        const sources = JSON.parse(rawFeeds);

        let allArticles = [];

        console.log(`جاري جلب الخلاصات لـ ${sources.length} مصدر...`);

        for (const source of sources) {
            try {
                const res = await fetchWithTimeout(source.url, { timeout: 7000 });
                if (res.ok) {
                    const xmlText = await res.text();
                    const articles = parseFeedItems(xmlText, source.name);
                    allArticles = allArticles.concat(articles);
                    console.log(`✓ تم جلب: ${source.name} (${articles.length} مقال)`);
                }
            } catch (err) {
                console.log(`✕ فشل جلب: ${source.name}`);
            }
        }

        // إزالة التكرار وفرز المقالات حسب الأحدث
        const uniqueArticles = Array.from(new Map(allArticles.map(a => [a.id, a])).values());
        uniqueArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        fs.writeFileSync('./articles.json', JSON.stringify(uniqueArticles, null, 2));
        console.log(`تم الحفظ بنجاح! إجمالي المقالات المجمعة: ${uniqueArticles.length}`);

    } catch (err) {
        console.error('خطأ في التنفيذ:', err);
        process.exit(1);
    }
}

run();
