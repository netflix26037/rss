const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

const parser = new Parser({
  customFields: {
    item: ['media:content', 'media:thumbnail']
  }
});

// دالة جلب المحتوى مع تحسين مهلة الاتصال والروابط
async function fetchFeedContent(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*'
  };

  let targetUrl = url.trim();
  
  // معالجة روابط Reddit بشكل أدق
  if (targetUrl.includes('reddit.com')) {
    targetUrl = targetUrl.replace(/\/$/, '');
    if (!targetUrl.endsWith('.rss')) {
      targetUrl += '/.rss';
    }
  }

  // محاولة 1: جلب مباشر بمهلة أطول (15 ثانية)
  try {
    const response = await axios.get(targetUrl, { headers, timeout: 15000 });
    if (response.data) return response.data;
  } catch (e) {
    console.warn(`⚠️ فشل الجلب المباشر لـ (${url}) [${e.message}]، جاري المحاولة عبر البروكسي...`);
  }

  // محاولة 2: جلب عبر Worker Proxy
  try {
    const proxyUrl = 'https://rss-proxy.red-108.workers.dev/?url=' + encodeURIComponent(targetUrl);
    const response = await axios.get(proxyUrl, { timeout: 15000 });
    if (response.data) return response.data;
  } catch (e) {
    console.error(`❌ فشل الجلب عبر البروكسي أيضاً لـ (${url}): ${e.message}`);
  }

  return null;
}

async function run() {
  try {
    if (!fs.existsSync('feed.json')) {
      console.error('❌ ملف feed.json غير موجود!');
      return;
    }

    const rawFeeds = fs.readFileSync('feed.json', 'utf8');
    const sources = JSON.parse(rawFeeds);
    let allArticles = [];

    console.log(`🚀 بدء جلب الأخبار من ${sources.length} مصدر...`);

    for (const source of sources) {
      if (!source.url) continue;

      try {
        const xmlData = await fetchFeedContent(source.url);
        if (!xmlData) {
          console.warn(`⚠️ تم تخطي المصدر لعدم استجابة الرابط: ${source.name}`);
          continue;
        }

        const feed = await parser.parseStringPromise(xmlData);
        
        if (feed && feed.items && feed.items.length > 0) {
          const items = feed.items.map(item => ({
            id: item.guid || item.link || item.title,
            title: item.title || '',
            link: item.link || '',
            pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
            description: item.contentSnippet || item.content || item.summary || '',
            sourceName: source.name,
            media: {
              image: extractImage(item),
              video: null
            }
          }));

          allArticles.push(...items);
          console.log(`✓ تم جلب ${items.length} مقال من: ${source.name}`);
        } else {
          console.warn(`⚠️ لا توجد مقالات داخل الخلاصة: ${source.name}`);
        }
      } catch (err) {
        console.error(`✗ خطأ أثناء تحليل xml لـ (${source.name}):`, err.message);
      }
    }

    // ترتيب المقالات حسب التاريخ من الأحدث للأقدم
    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`\n✅ تم تحديث articles.json بنجاح! إجمالي المقالات المجلوبة: ${allArticles.length}`);
    } else {
      console.warn('⚠️ لم يتم استخراج أي مقالات من المصادر.');
    }

  } catch (error) {
    console.error('خطأ عام أثناء التشغيل:', error);
  }
}

function extractImage(item) {
  if (item['media:content'] && item['media:content'].$ && item['media:content'].$.url) {
    return item['media:content'].$.url;
  }
  if (item['media:thumbnail'] && item['media:thumbnail'].$ && item['media:thumbnail'].$.url) {
    return item['media:thumbnail'].$.url;
  }
  if (item.media && item.media['$'] && item.media['$'].url) {
    return item.media['$'].url;
  }
  const htmlContent = item.content || item['content:encoded'] || item.summary || '';
  const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && !imgMatch[1].includes('preview.redd.it/award_images')) {
    return imgMatch[1];
  }
  return null;
}

run();
