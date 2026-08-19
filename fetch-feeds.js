const fs = require('fs');
const Parser = require('rss-parser');

// إعداد RSS Parser مع هيدر ممتاز لتخطي حظر Reddit مباشرة
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  },
  timeout: 10000
});

async function run() {
  try {
    if (!fs.existsSync('feed.json')) {
      console.error('خطأ: ملف feed.json غير موجود في المجلد الرئيسي!');
      return;
    }

    const rawFeeds = fs.readFileSync('feed.json', 'utf8');
    const sources = JSON.parse(rawFeeds);
    let allArticles = [];

    console.log(`بدء جلب الأخبار من ${sources.length} مصدر...`);

    for (const source of sources) {
      try {
        console.log(`جاري الجلب من: ${source.name} (${source.url})`);
        
        // الجلب المباشر مع استبدال امتداد Reddit إذا لزم
        let targetUrl = source.url;
        if (targetUrl.includes('reddit.com') && !targetUrl.endsWith('.rss')) {
          targetUrl = targetUrl.replace(/\/$/, '') + '/.rss';
        }

        const feed = await parser.parseURL(targetUrl);
        
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
          console.log(` SUCCESS: تم جلب ${items.length} مقال من ${source.name}`);
        } else {
          console.warn(` WARNING: القناة ${source.name} لم ترجع أي مقالات.`);
        }
      } catch (err) {
        console.error(` ERROR: فشل جلب (${source.name}): ${err.message}`);
      }
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    console.log(`إجمالي المقالات المجمعة: ${allArticles.length}`);

    // كتابة الملف
    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`✅ تم تحديث ملف articles.json بنجاح بأعلى حجم!`);
    } else {
      // إجبار كتابة مصفوفة تجريبية إذا كان الكل يفشل حتى تتأكد من عمل السكربت
      console.warn('⚠️ لم يتم جلب أي مقال من كافة المصادر. يرجى مراجعة روابط feed.json');
    }

  } catch (error) {
    console.error('خطأ رئيسي في النظام:', error);
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