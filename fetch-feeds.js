const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// تنظيف HTML واستخراج النص الصافي فقط
function cleanHtmlText(html) {
  if (!html) return '';
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // إزالة روابط Reddit المفصلة في نهاية النصوص
  cleaned = cleaned.replace(/submitted by\s+\/u\/\S+/gi, '');
  cleaned = cleaned.replace(/\[link\]\s+\[comments\]/gi, '');
  
  return cleaned.trim();
}

// دالة ترجمة مضمونة مع دعم المحاولات
async function translateToArabic(text) {
  const cleaned = cleanHtmlText(text);
  if (!cleaned || cleaned.length < 3) return '';
  
  // اقتطاع النص المناسب للترجمة السريعة
  const textToTranslate = cleaned.substring(0, 400);

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(textToTranslate)}`;
    const response = await axios.get(url, { 
      timeout: 8000,
      headers: { 'User-Agent': getRandomUserAgent() }
    });
    
    if (response.data && response.data[0]) {
      const translated = response.data[0].map(item => item[0]).join('');
      if (translated && translated.trim().length > 0) {
        return translated.trim();
      }
    }
  } catch (error) {
    // فشل مؤقت في المحرك الأول
  }

  return cleaned;
}

async function fetchFeedContent(url, retries = 3) {
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
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 20000
      });
      return response.data;
    } catch (e) {
      if (e.response && e.response.status === 429) {
        const waitTime = attempt * 8000;
        console.warn(`⏳ انتظار ${waitTime / 1000} ثوانٍ لتجاوز الحظر... [محاولة ${attempt}/${retries}]`);
        await delay(waitTime);
      } else {
        if (attempt === retries) {
          console.warn(`⚠️ تعذر جلب الرابط (${targetUrl}): ${e.message}`);
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

    const rawFeeds = fs.readFileSync('feed.json', 'utf8');
    const sources = JSON.parse(rawFeeds);

    let allArticles = [];
    console.log(`🚀 بدء جلب وتأكيد ترجمة العناوين والمواضيع من (${sources.length} مجموعات)...`);

    for (const source of sources) {
      if (!source.url) continue;

      try {
        const xmlData = await fetchFeedContent(source.url);
        
        if (!xmlData) {
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
          const topItems = feed.items.slice(0, 10);
          const processedItems = [];

          for (const item of topItems) {
            const rawTitle = item.title || '';
            const rawDesc = item.contentSnippet || item.content || item.summary || '';

            // ترجمة العنوان
            const translatedTitle = await translateToArabic(rawTitle);
            await delay(150);

            // ترجمة الموضوع/الخلاصة
            const translatedDesc = await translateToArabic(rawDesc);
            await delay(150);

            processedItems.push({
              id: item.guid || item.link || item.title,
              title: translatedTitle || rawTitle,
              originalTitle: rawTitle,
              link: item.link || '',
              pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
              description: translatedDesc || cleanHtmlText(rawDesc),
              sourceName: source.name,
              category: source.category || 'عام',
              media: {
                image: extractImage(item),
                video: null
              }
            });
          }

          allArticles.push(...processedItems);
          console.log(`✓ [ترجمة كاملة] تم جلب وترجمة ${processedItems.length} مقال من: ${source.name}`);
        }
      } catch (err) {
        console.error(`✗ خطأ في مجموعة (${source.name}):`, err.message);
      }

      await delay(4000);
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`\n✅ اكتملت العملية! تم حفظ ${allArticles.length} مقال مترجم بالكامل في articles.json`);
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
