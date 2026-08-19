const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

const parser = new Parser();

// دالة جلب المحتوى مع التغلب على حظر Reddit
async function fetchFeedContent(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  };

  // محاولة 1: جلب مباشر بـ User-Agent قوي
  try {
    let targetUrl = url;
    if (targetUrl.includes('reddit.com') && !targetUrl.endsWith('.rss')) {
      targetUrl = targetUrl.replace(/\/$/, '') + '/.rss';
    }
    const response = await axios.get(targetUrl, { headers, timeout: 8000 });
    if (response.data) return response.data;
  } catch (e) {
    console.warn(`محاولة الجلب المباشر فشلت لـ (${url})، جاري المحاولة عبر البروكسي...`);
  }

  // محاولة 2: جلب عبر Worker Proxy في حال فشل المباشر
  try {
    const proxyUrl = 'https://rss-proxy.red-108.workers.dev/?url=' + encodeURIComponent(url);
    const response = await axios.get(proxyUrl, { timeout: 10000 });
    if (response.data) return response.data;
  } catch (e) {
    console.error(`فشل الجلب عبر البروكسي أيضاً: ${e.message}`);
  }

  return null;
}

async function run() {
  try {
    if (!fs.existsSync('feed.json')) {
      console.error('ملف feed.json غير موجود!');
      return;
    }

    const rawFeeds = fs.readFileSync('feed.json', 'utf8');
    const sources = JSON.parse(rawFeeds);
    let allArticles = [];

    console.log(`بدء جلب الأخبار من ${sources.length} مصدر...`);

    for (const source of sources) {
      try {
        const xmlData = await fetchFeedContent(source.url);
        if (!xmlData) continue;

        const feed = await parser.parseStringPromise(xmlData);
        
        if (feed && feed.items && feed.items.length > 0) {
          const items = feed.items.map(item => ({
            id: item.link || item.guid || item.title,
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
        }
      } catch (err) {
        console.error(`✗ خطأ أثناء تحليل (${source.name}):`, err.message);
      }
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`✅ تم تحديث articles.json بنجاح! إجمالي المقالات: ${allArticles.length}`);
    } else {
      console.warn('⚠️ لم يتم العثور على مقالات جيدة للحفظ.');
    }

  } catch (error) {
    console.error('خطأ عام:', error);
  }
}

function extractImage(item) {
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