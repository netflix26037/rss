const fs = require('fs');
const Parser = require('rss-parser');

// إضافة User-Agent مخصص لمنع حظر Reddit لـ GitHub Actions
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 RedditArabicBot/1.0',
    'Accept': 'application/rss+xml, application/xml, text/xml; q=0.1'
  },
  timeout: 10000
});

async function run() {
  try {
    // 1. قراءة المصادر من feed.json
    const rawFeeds = fs.readFileSync('feed.json', 'utf8');
    const sources = JSON.parse(rawFeeds);
    
    let allArticles = [];

    console.log(`جاري جلب البيانات لـ ${sources.length} مصدر...`);

    // 2. المرور على جميع المصادر وجلب الخلاصات
    for (const source of sources) {
      try {
        const feed = await parser.parseURL(source.url);
        
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
        console.error(`✗ فشل جلب المصدر (${source.name}):`, err.message);
      }
    }

    // 3. ترتيب المقالات من الأحدث للأقدم
    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // 4. أهم شرط: عدم حفظ الملف إذا كانت النتيجة فارغة لتجنب مسح البيانات القديمة
    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`تم تحديث articles.json بنجاح! إجمالي المقالات: ${allArticles.length}`);
    } else {
      console.warn('تنبيه: لم يتم العثور على أي مقالات جديدة. تم إلغاء التحديث للحفاظ على البيانات القديمة.');
    }

  } catch (error) {
    console.error('حدث خطأ رئيسي أثناء التحديث:', error);
  }
}

// دالة استخراج الصور
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
