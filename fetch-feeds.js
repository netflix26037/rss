const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const GROQ_API_KEY = process.env.GROQ_API_KEY;

function cleanAndExtractText(html) {
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

async function translateText(text) {
  if (!text || text.length < 2) return '';
  if (!GROQ_API_KEY) {
    console.warn('⚠️ GROQ_API_KEY غير معرف في GitHub Secrets!');
    return text;
  }

  const shortText = text.substring(0, 400);

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a professional translator. Translate the given text accurately to Arabic. Output ONLY the Arabic translation, with no explanation or extra quotes.'
          },
          {
            role: 'user',
            content: shortText
          }
        ],
        temperature: 0.2
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const result = response.data?.choices?.[0]?.message?.content?.trim();
    if (result) return result;
  } catch (e) {
    console.error(`❌ خطأ أثناء الترجمة عبر Groq: ${e.response?.data?.error?.message || e.message}`);
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
    console.log(`🚀 بدء جلب وترجمة العناوين والمواضيع عبر Groq API...`);

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
          const topItems = feed.items.slice(0, 10);
          const processedItems = [];

          for (const item of topItems) {
            const rawTitle = item.title || '';
            const rawDesc = cleanAndExtractText(item.contentSnippet || item.content || item.summary || '');

            const translatedTitle = await translateText(rawTitle);
            await delay(100);

            let finalArabicDesc = '';
            if (rawDesc && rawDesc.length > 5) {
              finalArabicDesc = await translateText(rawDesc);
            } else {
              finalArabicDesc = `آخر الأخبار والتحديثات حول "${translatedTitle || rawTitle}" من مجتمع ${source.name}.`;
            }

            await delay(100);

            processedItems.push({
              id: item.guid || item.link || item.title,
              title: translatedTitle || rawTitle,
              arabicTitle: translatedTitle || rawTitle,
              originalTitle: rawTitle,
              link: item.link || '',
              pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
              description: finalArabicDesc,
              arabicDescription: finalArabicDesc,
              originalDescription: rawDesc || rawTitle,
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

      await delay(500);
    }

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (allArticles.length > 0) {
      fs.writeFileSync('articles.json', JSON.stringify(allArticles, null, 2), 'utf8');
      console.log(`\n✅ تم حفظ جميع المقالات والخلاصات المترجمة بنجاح في articles.json`);
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
