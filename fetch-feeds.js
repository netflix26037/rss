const fs = require('fs');
const Parser = require('rss-parser');

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  timeout: 15000
});

// البروكسي الخاص بك لتخطي حظر سيرفرات GitHub
const PROXY_URL = 'https://rss-proxy.red-108.workers.dev/?url=';

async function run() {
  try {
    const rawFeeds = fs.readFileSync('feed.json', 'utf8');
    const sources = JSON.parse(rawFeeds);
    let allArticles = [];

    console.log(`بدء جلب الخلاصات لـ ${sources.length} مصدر...`);

    for (const source of sources) {
      try {
        // الاستدعاء من خلال الـ Worker لتفادي حظر Reddit
        const targetUrl = PROXY_URL + encodeURIComponent(source.url);
        const feed = await parser.parseURL(targetUrl);
        
        const items = feed.items.map(item => ({
          id: item.link || item.guid || item.title,
          title: item.title,
          link: item.link,
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
      } catch (err) {
        console.error(`✗ فشل جلب (${source.name}):`, err.message);
      }
    }

    // ترتيب المقالات حسب التاريخ من الأحدث للأقدم
    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`تم حفظ البيانات بنجاح! عدد المقالات المكتوبة: ${allArticles.length}`);
    } else {
      console.warn('تنبيه: لم يتم جلب مقالات جديدة، تم الاحتفاظ بالملف الأصلي.');
    }

  } catch (error) {
    console.error('حدث خطأ رئيسي:', error);
  }
}

// دالة استخراج الصور من محتوى المقال
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
