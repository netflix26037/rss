const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

// مصفوفة هويات متصفحات عشوائية لمنع كشف السكريبت
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0',
  'RedditNewsDashboard/1.0.0 (by /u/RedditArabicNews)'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// دالة تنظيف النص
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// دالة الترجمة المحسنة
async function translateText(text) {
  const cleaned = cleanText(text);
  if (!cleaned || cleaned.length === 0) return '';
  const shortText = cleaned.substring(0, 500);

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(shortText)}`;
    const response = await axios.get(url, { 
      timeout: 5000,
      headers: { 'User-Agent': getRandomUserAgent() }
    });
    
    if (response.data && response.data[0]) {
      return response.data[0].map(item => item[0]).join('');
    }
    return cleaned;
  } catch (error) {
    return cleaned;
  }
}

// دالة جلب محتوى RSS مع محاولة إعادة الطلب عند الحظر (Retry mechanism)
async function fetchFeedContent(url, retries = 2) {
  let targetUrl = url.trim();

  if (targetUrl.includes('reddit.com')) {
    targetUrl = targetUrl.replace(/\/$/, '');
    if (!targetUrl.endsWith('.rss')) {
      targetUrl += '/.rss';
    }
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await axios.get(targetUrl, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 15000
      });
      return response.data;
    } catch (e) {
      if (e.response && e.response.status === 429 && attempt <= retries) {
        console.warn(`⏳ حظر مؤقت (429) على (${targetUrl}). إعادة المحاولة بعد 6 ثوانٍ... [محاولة ${attempt}]`);
        await delay(6000); // الانتظار 6 ثوانٍ قبل التكرار
      } else {
        if (attempt === retries + 1) {
          console.warn(`⚠️ فشل جلب الرابط (${targetUrl}): ${e.message}`);
        }
      }
    }
  }
  return null;
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
    console.log(`🚀 بدء جلب الأخبار وترجمتها من إجمالي (${sources.length}) مصدر...`);

    for (const source of sources) {
      if (!source.url) {
        console.warn(`⚠️ تم تخطي عنصر بدون رابط url: ${source.name || 'بدون اسم'}`);
        continue;
      }

      try {
        const xmlData = await fetchFeedContent(source.url);
        
        if (!xmlData) {
          console.warn(`❌ تعذر استلام بيانات من: ${source.name}`);
          await delay(2000);
          continue;
        }

        const parser = new Parser({
          headers: { 'User-Agent': getRandomUserAgent() },
          timeout: 15000,
          customFields: { item: ['media:content', 'media:thumbnail'] }
        });

        const feed = await parser.parseString(xmlData);
        
        if (feed && feed.items && feed.items.length > 0) {
          const topItems = feed.items.slice(0, 3); // أخذ أول 3 مقالات لتقليل الحمل
          const processedItems = [];

          for (const item of topItems) {
            const rawTitle = item.title || '';
            const rawDesc = item.contentSnippet || item.content || item.summary || '';

            const translatedTitle = await translateText(rawTitle);
            await delay(100);
            const translatedDesc = await translateText(rawDesc);
            await delay(100);

            processedItems.push({
              id: item.guid || item.link || item.title,
              title: translatedTitle || rawTitle,
              originalTitle: rawTitle,
              link: item.link || '',
              pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
              description: translatedDesc || cleanText(rawDesc),
              sourceName: source.name,
              category: source.category || 'عام',
              media: {
                image: extractImage(item),
                video: null
              }
            });
          }

          allArticles.push(...processedItems);
          console.log(`✓ [نجاح وترجمة] تم جلب وحفظ ${processedItems.length} مقال من: ${source.name}`);
        } else {
          console.warn(`⚠️ المصدر لا يحتوي على أي مقالات حالياً: ${source.name}`);
        }
      } catch (err) {
        console.error(`✗ خطأ أثناء تحليل RSS لـ (${source.name}):`, err.message);
      }

      // تأخير ديناميكي عشوائي بين 2.5 إلى 4 ثوانٍ لتجاوز رادار الحظر
      const randomWait = Math.floor(Math.random() * 1500) + 2500;
      await delay(randomWait);
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`\n✅ تم الحفظ بنجاح! إجمالي المقالات المترجمة في articles.json: ${allArticles.length}`);
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
