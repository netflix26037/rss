const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

// استخدام User-Agent يتوافق مع شروط Reddit الرسمية لمنع الحظر
const USER_AGENT = 'RedditNewsDashboard/1.0.0 (by /u/RedditArabicNews)';

const parser = new Parser({
  headers: {
    'User-Agent': USER_AGENT,
    'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*'
  },
  timeout: 30000, // زيادة المهلة إلى 30 ثانية
  customFields: {
    item: ['media:content', 'media:thumbnail']
  }
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchFeedContent(url) {
  let targetUrl = url.trim();

  if (targetUrl.includes('reddit.com')) {
    targetUrl = targetUrl.replace(/\/$/, '');
    if (!targetUrl.endsWith('.rss')) {
      targetUrl += '/.rss';
    }
  }

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      timeout: 20000
    });
    return response.data;
  } catch (e) {
    console.warn(`⚠️ فشل جلب الرابط (${targetUrl}): ${e.message}`);
    return null;
  }
}

async function run() {
  try {
    if (!fs.existsSync('feed.json')) {
      console.error('❌ خطأ: ملف feed.json غير موجود!');
      return;
    }

    let sources = [];
    try {
      const rawFeeds = fs.readFileSync('feed.json', 'utf8');
      const parsedData = JSON.parse(rawFeeds);

      if (Array.isArray(parsedData)) {
        sources = parsedData;
      } else if (parsedData.sources && Array.isArray(parsedData.sources)) {
        sources = parsedData.sources;
      } else if (parsedData.feeds && Array.isArray(parsedData.feeds)) {
        sources = parsedData.feeds;
      }
    } catch (parseError) {
      console.error('❌ خطأ في تنسيق ملف feed.json!');
      return;
    }

    let allArticles = [];
    console.log(`🚀 بدء جلب الأخبار من إجمالي (${sources.length}) مصدر...`);

    for (const source of sources) {
      if (!source.url) {
        console.warn(`⚠️ تم تخطي عنصر بدون رابط url: ${source.name || 'بدون اسم'}`);
        continue;
      }

      try {
        const xmlData = await fetchFeedContent(source.url);
        
        if (!xmlData) {
          console.warn(`❌ تعذر استلام بيانات من: ${source.name}`);
          await delay(1000);
          continue;
        }

        const feed = await parser.parseString(xmlData);
        
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
          console.log(`✓ [نجاح] تم جلب ${items.length} مقال من: ${source.name}`);
        } else {
          console.warn(`⚠️ المصدر لا يحتوي على أي مقالات حالياً: ${source.name}`);
        }
      } catch (err) {
        console.error(`✗ خطأ أثناء تحليل RSS لـ (${source.name}):`, err.message);
      }

      // انتظر ثانية واحدة فقط بين كل مصدر والأخر
      await delay(1000);
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`\n✅ تم الحفظ بنجاح! إجمالي المقالات المحدثة في articles.json: ${allArticles.length}`);
    } else {
      console.error('\n❌ لم يتم الوصول لأي مقال من جميع المصادر المذكورة.');
    }

  } catch (error) {
    console.error('خطأ عام في السكربت:', error);
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