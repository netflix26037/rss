const fs = require('fs');
const Parser = require('rss-parser');

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*'
  },
  timeout: 15000,
  customFields: {
    item: ['media:content', 'media:thumbnail']
  }
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// دالة تحويل رابط Reddit ليمر عبر بروكسي مجاني لتجاوز حظر IP وحظر 429
function formatRedditUrl(url) {
  let targetUrl = url.trim();
  if (targetUrl.includes('reddit.com')) {
    targetUrl = targetUrl.replace(/\/$/, '');
    if (!targetUrl.endsWith('.rss')) {
      targetUrl += '/.rss';
    }
    // تمرير الرابط عبر خدمة AllOrigins لتفادي حظر 429
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  }
  return targetUrl;
}

async function run() {
  try {
    if (!fs.existsSync('feed.json')) {
      console.error('❌ خطأ: ملف feed.json غير موجود في المجلد الحالي!');
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

      const fetchUrl = formatRedditUrl(source.url);

      try {
        const feed = await parser.parseURL(fetchUrl);
        
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
        console.error(`✗ خطأ أثناء جلب/تحليل RSS لـ (${source.name}):`, err.message);
      }

      // تأخير لمدة ثانية ونصف لتخفيف الضغط
      await delay(1500);
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