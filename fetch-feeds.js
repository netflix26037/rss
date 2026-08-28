```js
const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');

const parser = new Parser();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 WebDashboard/2.0';

// ============================================================
// إعدادات عمر الأخبار
// ============================================================

// الحد الأقصى لعمر الخبر: 48 ساعة
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000;

// لا نسمح بتاريخ مستقبلي أكثر من هذا الحد.
// هذا يمنع بعض المصادر التي يكون فيها التاريخ خاطئاً.
const MAX_FUTURE_MS = 5 * 60 * 1000;

// ============================================================
// الترجمة
// ============================================================

// الترجمة تتم حالياً من الواجهة الأمامية.
// نترك الدالة كما هي للحفاظ على نظام المشروع الحالي.
async function translateText(text) {
  return '';
}

// ============================================================
// جلب RSS مع بديل عند 429
// ============================================================

async function fetchXmlWithFallback(rawUrl) {
  try {
    const res = await axios.get(rawUrl, {
      headers: {
        'User-Agent': USER_AGENT
      },
      timeout: 8000
    });

    return res.data;

  } catch (err) {

    if (err.response && err.response.status === 429) {

      console.log(`تم حظر المصدر مؤقتاً، تجربة البروكسي: ${rawUrl}`);

      const proxyUrl =
        `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`;

      const proxyRes = await axios.get(proxyUrl, {
        timeout: 10000
      });

      return proxyRes.data;
    }

    throw err;
  }
}

// ============================================================
// تجميع مصادر Reddit
// ============================================================

function groupRedditSources(sources) {

  const redditSubreddits = [];
  const nonRedditSources = [];

  sources.forEach(src => {

    const match = src.url.match(
      /reddit\.com\/r\/([^/]+)\/\.rss/i
    );

    if (match && match[1]) {
      redditSubreddits.push(match[1]);
    } else {
      nonRedditSources.push(src);
    }
  });

  const groupedSources = [...nonRedditSources];

  const CHUNK_SIZE = 12;

  for (
    let i = 0;
    i < redditSubreddits.length;
    i += CHUNK_SIZE
  ) {

    const chunk = redditSubreddits.slice(
      i,
      i + CHUNK_SIZE
    );

    const combinedSubs = chunk.join('+');

    groupedSources.push({
      name: `مجموعة ريديت (${i / CHUNK_SIZE + 1})`,
      url: `https://www.reddit.com/r/${combinedSubs}/.rss`,
      category: 'مُدمج'
    });
  }

  return groupedSources;
}

// ============================================================
// تحميل كاش الترجمات
// ============================================================

function loadTranslationCache() {

  const cache = new Map();

  try {

    const raw = fs.readFileSync(
      './feed.json',
      'utf8'
    );

    const previousArticles = JSON.parse(raw);

    for (const article of previousArticles) {

      const titleOk =
        article.arabicTitle &&
        article.arabicTitle !== article.title;

      const descOk =
        article.arabicDescription &&
        article.arabicDescription !== article.description;

      if (titleOk || descOk) {

        cache.set(article.id, {

          arabicTitle:
            titleOk
              ? article.arabicTitle
              : null,

          arabicDescription:
            descOk
              ? article.arabicDescription
              : null
        });
      }
    }

    console.log(
      `تم تحميل ${cache.size} ترجمة محفوظة مسبقاً من feed.json.`
    );

  } catch (e) {

    console.log(
      'لا يوجد feed.json سابق، سيبدأ الأرشيف من الصفر.'
    );
  }

  return cache;
}

// ============================================================
// استخراج تاريخ المقال
// ============================================================

function getArticleDate(item) {

  // نفضل pubDate
  if (item.pubDate) {
    return item.pubDate;
  }

  // ثم isoDate
  if (item.isoDate) {
    return item.isoDate;
  }

  // بعض المصادر قد تستخدم created / updated
  if (item.created) {
    return item.created;
  }

  if (item.updated) {
    return item.updated;
  }

  return null;
}

// ============================================================
// التحقق الصارم من عمر الخبر
// ============================================================

function getArticleAgeStatus(pubDateStr) {

  // لا يوجد تاريخ = مرفوض
  if (!pubDateStr) {
    return {
      valid: false,
      reason: 'missing-date'
    };
  }

  const pubTime = new Date(pubDateStr).getTime();

  // تاريخ غير صالح = مرفوض
  if (Number.isNaN(pubTime)) {
    return {
      valid: false,
      reason: 'invalid-date'
    };
  }

  const now = Date.now();

  // تاريخ مستقبلي بشكل غير طبيعي = مرفوض
  if (pubTime > now + MAX_FUTURE_MS) {
    return {
      valid: false,
      reason: 'future-date'
    };
  }

  const age = now - pubTime;

  // أقدم من 48 ساعة = مرفوض
  if (age > MAX_ARTICLE_AGE_MS) {
    return {
      valid: false,
      reason: 'older-than-48-hours',
      age
    };
  }

  // صالح
  return {
    valid: true,
    reason: 'within-48-hours',
    age
  };
}

// ============================================================
// التحقق من أن المقال حديث
// ============================================================

function isWithinAllowedAge(pubDateStr) {

  const status = getArticleAgeStatus(pubDateStr);

  return status.valid;
}

// ============================================================
// البرنامج الرئيسي
// ============================================================

async function run() {

  const translationCache =
    loadTranslationCache();

  let translatedCount = 0;
  let reusedCount = 0;

  let skippedOldCount = 0;
  let skippedNoDateCount = 0;
  let skippedInvalidDateCount = 0;
  let skippedFutureCount = 0;

  let rawSources = [];

  // ==========================================================
  // تحميل المصادر
  // ==========================================================

  try {

    const sourcesData =
      fs.readFileSync(
        './sources.json',
        'utf8'
      );

    rawSources =
      JSON.parse(sourcesData);

  } catch (e) {

    console.log(
      'استخدام القائمة الافتراضية...'
    );

    rawSources = [

      {
        name: 'WorldNews',
        url: 'https://www.reddit.com/r/worldnews/.rss',
        category: 'أخبار'
      }

    ];
  }

  const sources =
    groupRedditSources(rawSources);

  console.log(
    `تم تقليص الطلبات من ${rawSources.length} إلى ${sources.length} طلباً مدمجاً.`
  );

  let allArticles = [];

  // ==========================================================
  // جلب المصادر
  // ==========================================================

  for (const source of sources) {

    try {

      console.log(
        `جاري جلب: ${source.name}...`
      );

      const xmlData =
        await fetchXmlWithFallback(
          source.url
        );

      const feed =
        await parser.parseString(
          xmlData
        );

      // ========================================================
      // مهم جداً:
      //
      // لا نستخدم slice(0, 10) هنا.
      //
      // نفحص جميع عناصر RSS أولاً،
      // ثم نطبق فلتر الـ48 ساعة.
      // ========================================================

      const items =
        feed.items || [];

      let sourceArticleCount = 0;

      for (const item of items) {

        // ------------------------------------------------------
        // استخراج التاريخ
        // ------------------------------------------------------

        const itemPubDate =
          getArticleDate(item);

        const dateStatus =
          getArticleAgeStatus(
            itemPubDate
          );

        // ------------------------------------------------------
        // رفض المقالات غير الصالحة
        // ------------------------------------------------------

        if (!dateStatus.valid) {

          if (
            dateStatus.reason ===
            'older-than-48-hours'
          ) {

            skippedOldCount++;

          } else if (
            dateStatus.reason ===
            'missing-date'
          ) {

            skippedNoDateCount++;

          } else if (
            dateStatus.reason ===
            'invalid-date'
          ) {

            skippedInvalidDateCount++;

          } else if (
            dateStatus.reason ===
            'future-date'
          ) {

            skippedFutureCount++;
          }

          continue;
        }

        // ------------------------------------------------------
        // بيانات المقال
        // ------------------------------------------------------

        const rawTitle =
          item.title || '';

        const rawDesc =
          item.contentSnippet ||
          item.content ||
          item.summary ||
          '';

        // إذا لم يكن هناك عنوان فلا فائدة من المقال
        if (!rawTitle.trim()) {
          continue;
        }

        // ------------------------------------------------------
        // الصورة
        // ------------------------------------------------------

        let imageUrl = null;

        if (
          item['media:content'] &&
          item['media:content'].$ &&
          item['media:content'].$.url
        ) {

          imageUrl =
            item['media:content'].$.url;

        } else if (
          item['media:thumbnail'] &&
          item['media:thumbnail'].$ &&
          item['media:thumbnail'].$.url
        ) {

          imageUrl =
            item['media:thumbnail'].$.url;

        } else if (
          item.enclosure &&
          item.enclosure.url
        ) {

          imageUrl =
            item.enclosure.url;
        }

        // ------------------------------------------------------
        // ID المقال
        // ------------------------------------------------------

        const articleId =
          item.guid ||
          item.id ||
          item.link ||
          `id-${rawTitle}-${source.name}`;

        // ------------------------------------------------------
        // الترجمة المحفوظة
        // ------------------------------------------------------

        const cached =
          translationCache.get(
            articleId
          );

        // ------------------------------------------------------
        // ترجمة العنوان
        // ------------------------------------------------------

        let arabicTitle;

        if (
          cached &&
          cached.arabicTitle
        ) {

          arabicTitle =
            cached.arabicTitle;

          reusedCount++;

        } else {

          arabicTitle =
            await translateText(
              rawTitle
            );

          translatedCount++;
        }

        // ------------------------------------------------------
        // ترجمة الوصف
        // ------------------------------------------------------

        let arabicDescription;

        if (
          cached &&
          cached.arabicDescription
        ) {

          arabicDescription =
            cached.arabicDescription;

          reusedCount++;

        } else {

          arabicDescription =
            await translateText(
              rawDesc
            );

          translatedCount++;
        }

        // ------------------------------------------------------
        // إضافة المقال
        // ------------------------------------------------------

        allArticles.push({

          id: articleId,

          title: rawTitle,

          arabicTitle:
            arabicTitle || '',

          description:
            rawDesc,

          arabicDescription:
            arabicDescription || '',

          link:
            item.link || '#',

          sourceName:
            source.name,

          category:
            source.category || 'عام',

          // مهم:
          // لا نضع تاريخاً افتراضياً مثل new Date()
          // لأن ذلك كان يمكن أن يجعل مقالاً بلا تاريخ
          // يبدو وكأنه خبر جديد.
          pubDate:
            itemPubDate,

          media: {
            image: imageUrl
          }
        });

        sourceArticleCount++;
      }

      console.log(
        `${source.name}: تم قبول ${sourceArticleCount} خبر حديث.`
      );

      // مهلة بين المصادر
      await sleep(2000);

    } catch (err) {

      console.log(
        `تخطي المصدر ${source.name}: ${err.message}`
      );

      await sleep(2000);
    }
  }

  // ==========================================================
  // إزالة التكرارات
  // ==========================================================

  const uniqueArticles = [];
  const seenIds = new Set();

  for (const article of allArticles) {

    if (seenIds.has(article.id)) {
      continue;
    }

    seenIds.add(article.id);

    uniqueArticles.push(article);
  }

  // ==========================================================
  // ترتيب الأخبار
  // ==========================================================

  uniqueArticles.sort(
    (a, b) =>
      new Date(b.pubDate).getTime() -
      new Date(a.pubDate).getTime()
  );

  // ==========================================================
  // حماية إضافية قبل حفظ feed.json
  //
  // حتى لو حدث أي خطأ في مرحلة سابقة،
  // لا نحفظ أي خبر يتجاوز 48 ساعة.
  // ==========================================================

  const finalArticles =
    uniqueArticles.filter(article => {

      return isWithinAllowedAge(
        article.pubDate
      );
    });

  // ==========================================================
  // حفظ البيانات
  // ==========================================================

  fs.writeFileSync(
    './feed.json',
    JSON.stringify(
      finalArticles,
      null,
      2
    ),
    'utf8'
  );

  // ==========================================================
  // الإحصائيات
  // ==========================================================

  console.log('');
  console.log('========================================');
  console.log('اكتملت عملية تحديث الأخبار');
  console.log('========================================');

  console.log(
    `إجمالي الأخبار الحديثة: ${finalArticles.length}`
  );

  console.log(
    `المستبعدة لأنها أقدم من 48 ساعة: ${skippedOldCount}`
  );

  console.log(
    `المستبعدة لعدم وجود تاريخ: ${skippedNoDateCount}`
  );

  console.log(
    `المستبعدة بسبب تاريخ غير صالح: ${skippedInvalidDateCount}`
  );

  console.log(
    `المستبعدة بسبب تاريخ مستقبلي: ${skippedFutureCount}`
  );

  console.log(
    `الترجمات المعاد استخدامها: ${reusedCount}`
  );

  console.log(
    `طلبات الترجمة الجديدة: ${translatedCount}`
  );

  console.log('========================================');
}

run();
```
