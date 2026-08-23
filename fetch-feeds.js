const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  cleaned = cleaned.replace(/submitted by\s+\/u\/\S+/gi, '');
  cleaned = cleaned.replace(/to\s+r\/\S+/gi, '');
  cleaned = cleaned.replace(/\[link\]/gi, '');
  cleaned = cleaned.replace(/\[comments\]/gi, '');
  
  return cleaned.trim();
}

// دالة الترجمة المجمعة (تترجم العنوان والوصف في طلب واحد لتفادي 429)
async function translateBatch(title, desc) {
  const cleanT = cleanHtmlText(title);
  const cleanD = cleanHtmlText(desc).substring(0, 250);

  if (!cleanT && !cleanD) return { title: '', desc: '' };

  // دمج النصوص باستخدام فاصل فريد
  const combinedText = `${cleanT} ||| ${cleanD}`;

  // 1. تجربة Google Translate
  try {
    const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(combinedText)}`;
    const res = await axios.get(gtxUrl, {
      timeout: 6000,
      headers: { 'User-Agent': getRandomUserAgent() }
    });

    if (res.data && res.data[0]) {
      const fullTranslated = res.data[0].map(item => item[0]).join('');
      const parts = fullTranslated.split('|||');

      return {
        title: parts[0] ? parts[0].trim() : cleanT,
        desc: parts[1] ? parts[1].trim() : cleanD
      };
    }
  } catch (e) {
    // في حال حظر جوجل، الانتقال للمحرك الاحتياطي
  }

  // 2. المحرك الاحتياطي MyMemory (طلب لكل جزئية)
  try {
    const translateSingle = async (text) => {
      if (!text) return '';
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ar`;
      const res = await axios.get(url, { timeout: 5000 });
      if (res.data && res.data.responseData && res.data.responseData.translatedText) {
        const val = res.data.responseData.translatedText;
        if (!val.includes('MYMEMORY WARNING')) return val.trim();
      }
      return text;
    };

    const tAr = await translateSingle(cleanT);
    const dAr = await translateSingle(cleanD);
    return { title: tAr, desc: dAr };
  } catch (e) {
    return { title: cleanT, desc: cleanD };
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
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 20000
      });
      return response.data;
    } catch (e) {
      if (e.response && e.response.status === 429) {
        const waitTime = attempt * 8000;
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

    const rawFeeds = fs.readFileSync('feed.json', 'utf8');
    const sources = JSON.parse(rawFeeds);

    let allArticles = [];
    console.log(`🚀 بدء جلب الأخبار بالترجمة المجمعة الذكية...`);

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
          const topItems = feed.items.slice(0, 8); // 8 مقالات من كل مجموعة لتقليل العبء
          const processedItems = [];

          for (const item of topItems) {
            const rawTitle = item.title || '';
            const rawDesc = item.contentSnippet || item.content || item.summary || '';

            // ترجمة مجمعة في طلب واحد متكامل
            const translated = await translateBatch(rawTitle, rawDesc);
            await delay(350); // تأخير بسيط لعدم تجاوز حدود جوجل

            processedItems.push({
              id: item.guid || item.link || item.title,
              title: translated.title || rawTitle,
              originalTitle: rawTitle,
              link: item.link || '',
              pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
              description: translated.desc || cleanHtmlText(rawDesc),
              sourceName: source.name,
              category: source.category || 'عام',
              media: {
                image: extractImage(item),
                video: null
              }
            });
          }

          allArticles.push(...processedItems);
          console.log(`✓ [تمت الترجمة بنجاح] جلب ${processedItems.length} مقال من: ${source.name}`);
        }
      } catch (err) {
        console.error(`✗ خطأ في مجموعة (${source.name}):`, err.message);
      }

      await delay(3000);
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`\n✅ اكتملت العملية بنجاح! تم حفظ ${allArticles.length} مقال مترجم بالكامل.`);
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
