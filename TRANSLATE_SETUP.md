# إضافة خدمة الترجمة (Python) لمشروع rss

## الملفات
ضيف الملفين دول للريبو:
```
api/translate.py       ← جوه مجلد api/ الموجود عندك بالفعل
requirements.txt       ← في جذر المشروع (لو عندك واحد بالفعل، ضيف السطر مش هيأثر لأنه تعليق بس)
```

Vercel بيتعرف تلقائيًا إن فيه ملف `.py` جوه `api/` ويشغله كـ Python Serverless Function من غير أي إعداد إضافي.

## إعداد الـ Environment Variables في Vercel

1. روح لـ [Vercel Dashboard](https://vercel.com/dashboard)
2. افتح مشروع `rss`
3. روح لـ **Settings > Environment Variables**
4. ضيف المتغيرات التلاتة دي:

| Name | Value |
|------|-------|
| `AZURE_TRANSLATOR_KEY` | المفتاح بتاعك من Azure (Keys and Endpoint) |
| `AZURE_TRANSLATOR_ENDPOINT` | `https://api.cognitive.microsofttranslator.com` |
| `AZURE_TRANSLATOR_REGION` | المنطقة بتاعتك (مثال: `qatarcentral`) |

5. اضغط **Save** واعمل **Redeploy** للمشروع عشان المتغيرات تتفعل.

⚠️ **لا تحط المفتاح مباشرة في الكود أو ترفعه على GitHub.**

## طريقة الاستخدام من الفرونت إند

في `index.html` أو `iphone.html`:

```javascript
async function translateText(text, targetLang) {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, to: targetLang })
  });
  const data = await response.json();
  if (data.error) {
    console.error(data.error);
    return null;
  }
  return data.translatedText;
}

// مثال استخدام
translateText('Hello world', 'ar').then(result => {
  console.log(result); // مرحبا بالعالم
});
```

## اختبار محلي قبل الرفع

```bash
npm install -g vercel
vercel dev
```
هيسألك تحط الـ Environment Variables في ملف `.env.local` (بيتضاف تلقائيًا لملف `.gitignore` بتاع Vercel).
