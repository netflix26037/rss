const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// تنظيف وتجريد الوصف تماماً من أكواد HTML لضمان نجاح الترجمة
function extractPlainText(html) {
  if (!html) return '';
  
  let cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<a[^>]*>.*?<\/a>/gi, '') // إزالة الروابط النصية
    .replace(/<[^>]+>/g, ' ')           // إزالة كل وسوم HTML
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // تنظيف نصوص ريديت التلقائية
  cleaned = cleaned.replace(/submitted by\s+\/u\/\S+/gi, '');
  cleaned = cleaned.replace(/to\s+r\/\S+/gi, '');
  cleaned = cleaned.replace(/\[link\]/gi, '');
  cleaned = cleaned.replace(/\[comments\]/gi, '');

  return cleaned.trim();
}

// دالة الترجمة المزدوجة والمخصصة للنصوص المنظفة
async function translateText(text) {
  const cleanedText = extractPlainText(text);
  if (!cleanedText || cleanedText.length < 3) return '';

  const shortText = cleanedText.substring(0, 350); // تقليم النص لضمان استجابة السيرفر

  // 1. المحاولة الأولى: Google GTX POST
  try {
    const res = await axios({
      method: 'post',
      url: 'https://translate.googleapis.com/translate_a/single',
      params: { client: 'gtx', sl: 'auto', tl: 'ar', dt: 't', q: shortText },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 5000
    });

    if (res.data && res.data[0]) {
      const translated = res.data[0].map(item => item[0]).join('');
      if (translated && translated.trim().length > 0) {
        return translated.trim();
      }
    }
  } catch (e) {
    // الانتقال للمحرك البديل
  }

  // 2. المحاولة الثانية: Lingva Translate API (بديل مجاني ممتاز)
  try {
    const lingvaUrl = `https://lingva.ml/api/v1/auto/ar/${encodeURIComponent(shortText)}`;
    const res = await axios.get(lingvaUrl, { timeout: 5000 });
    if (res.data && res.data.translation) {
      return res.data.translation.trim();
    }
  } catch (e) {
    // إرجاع النص المنظف بدون ترجمة في حال فشل السيرفرين
  }

  return shortText;
}

async function fetchFeedContent(url, retries = 2) {
  let targetUrl = url.trim();

  if (targetUrl.includes('reddit.com')) {
    targetUrl = targetUrl.replace(/\/$/, '');
    if (!targetUrl.endsWith('.rss')) {
      targetUrl += '/.rss';
    }
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });
      return response.data;
    } catch (e) {
      if (attempt === retries) return null;
      await delay(2000);
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

    const rawFeeds = fs.readFileSync('feed.json', 'utf8');
    const sources = JSON.parse(rawFeeds);

    let allArticles = [];
    console.log(`🚀 بدء جلب وترجمة العناوين والمواضيع...`);

    for (const source of sources) {
      if (!source.url) continue;

      try {
        const xmlData = await fetchFeedContent(source.url);
        if (!xmlData) continue;

        const parser = new Parser({
          timeout: 10000,
          customFields: { item: ['media:content', 'media:thumbnail'] }
        });

        const feed = await parser.parseString(xmlData);
        
        if (feed && feed.items && feed.items.length > 0) {
          const topItems = feed.items.slice(0, 5);
          const processedItems = [];

          for (const item of topItems) {
            const rawTitle = item.title || '';
            const rawDesc = item.contentSnippet || item.content || item.summary || '';

            // ترجمة العنوان
            const translatedTitle = await translateText(rawTitle);
            await delay(150);

            // ترجمة الموضوع (الوصف) بعد تنظيفه من HTML
            const translatedDesc = await translateText(rawDesc);
            await delay(150);

            const cleanOriginalDesc = extractPlainText(rawDesc);

            processedItems.push({
              id: item.guid || item.link || item.title,
              title: translatedTitle || rawTitle,
              arabicTitle: translatedTitle || rawTitle,
              originalTitle: rawTitle,
              link: item.link || '',
              pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
              description: translatedDesc || cleanOriginalDesc,
              arabicDescription: translatedDesc || cleanOriginalDesc,
              originalDescription: cleanOriginalDesc,
              sourceName: source.name,
              category: source.category || 'عام',
              media: {
                image: extractImage(item),
                video: null
              }
            });
          }

          allArticles.push(...processedItems);
          console.log(`✓ تم جلب وترجمة (${processedItems.length}) مقال من: ${source.name}`);
        }
      } catch (err) {
        console.error(`✗ خطأ في (${source.name}):`, err.message);
      }

      await delay(1500);
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`\n✅ تم حفظ جميع المقالات المترجمة بنجاح في articles.json`);
    }

  } catch (error) {
    console.error('خطأ عام:', error);
  }
}

function extractImage(item) {
  if (item['media:content'] && item['media:content'].$ && item['media:content'].$.url) return item['media:content'].$.url;
  if (item['media:thumbnail'] && item['media:thumbnail'].$ && item['media:thumbnail'].$.url) return item['media:thumbnail'].$.url;
  if (item.media && item.media['$'] && item.media['$'].url) return item.media['$'].url;
  const htmlContent = item.content || item['content:encoded'] || item.summary || '';
  const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && !imgMatch[1].includes('preview.redd.it/award_images')) return imgMatch[1];
  return null;
}

run();
