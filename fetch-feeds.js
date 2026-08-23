const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

// هويات متصفحات عشوائية حديثة
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function cleanText(text) {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

async function translateText(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return '';
  const shortText = cleaned.substring(0, 400);

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
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
        timeout: 20000
      });
      return response.data;
    } catch (e) {
      if (e.response && e.response.status === 429) {
        // زيادة مدة الانتظار تصاعدياً مع كل محاولة (10 ثوانٍ، ثم 15، ثم 20)
        const waitTime = attempt * 10000;
        console.warn(`⏳ حظر 429 على (${targetUrl}). انتظار ${waitTime / 1000} ثوانٍ... [محاولة ${attempt}/${retries}]`);
        await delay(waitTime);
      } else {
        if (attempt === retries) {
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
      } else if (parsedData.sources) {
        sources = parsedData.sources;
      }
    } catch (parseError) {
      console.error('❌ خطأ في ملف feed.json!');
      return;
    }

    let allArticles = [];
    console.log(`🚀 بدء جلب الأخبار وترجمتها من إجمالي (${sources.length}) مصدر...`);

    for (const source of sources) {
      if (!source.url) continue;

      try {
        const xmlData = await fetchFeedContent(source.url);
        
        if (!xmlData) {
          console.warn(`❌ تعذر استلام بيانات من: ${source.name}`);
          await delay(3000);
          continue;
        }

        const parser = new Parser({
          headers: { 'User-Agent': getRandomUserAgent() },
          timeout: 15000,
          customFields: { item: ['media:content', 'media:thumbnail'] }
        });

        const feed = await parser.parseString(xmlData);
        
        if (feed && feed.items && feed.items.length > 0) {
          const topItems = feed.items.slice(0, 3);
          const processedItems = [];

          for (const item of topItems) {
            const rawTitle = item.title || '';
            const rawDesc = item.contentSnippet || item.content || item.summary || '';

            const translatedTitle = await translateText(rawTitle);
            await delay(120);
            const translatedDesc = await translateText(rawDesc);
            await delay(120);

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
          console.log(`✓ [نجاح وترجمة] تم جلب ${processedItems.length} مقال من: ${source.name}`);
        }
      } catch (err) {
        console.error(`✗ خطأ في (${source.name}):`, err.message);
      }

      // انتظر 4 ثوانٍ كاملة بين كل مصدر لضمان عدم تجاوز قيود Reddit
      await delay(4000);
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`\n✅ تم الحفظ بنجاح! إجمالي المقالات المترجمة: ${allArticles.length}`);
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
