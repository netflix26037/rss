// 1. حذف دالة البث المباشر وقارئ HLS
// قم بإزالة initLiveStream() واستدعائها من بداية التشغيل

// 2. تحديث دالة عرض عناصر الخلاصة لاستخراج الصور والفيديوهات
function renderFeedItem(item) {
    const itemContainer = document.createElement('div');
    itemContainer.className = 'feed-item';

    // دمج العنوان والرابط
    let contentHtml = `<a href="${item.link}" target="_blank" rel="noopener"><h3>${item.title}</h3></a>`;

    // دمج النص أو الوصف الموجود في XML/JSON
    const rawContent = item.content || item.description || '';
    
    // إنشاء عنصر مؤقت لاستخلاص الصور والمقاطع
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = rawContent;

    // استخراج الصور والفيديوهات
    const mediaElements = tempDiv.querySelectorAll('img, video, iframe');
    let mediaHtml = '';
    
    mediaElements.forEach(media => {
        // ضبط أبعاد الصور والفيديوهات للتناسب مع الشاشة
        media.style.maxWidth = '100%';
        media.style.height = 'auto';
        media.style.borderRadius = '8px';
        media.style.marginTop = '8px';
        mediaHtml += media.outerHTML;
    });

    // تنظيف النص من الوسائط لتجنب التكرار
    mediaElements.forEach(el => el.remove());
    const cleanText = tempDiv.textContent || tempDiv.innerText || '';

    // تجميع العنصر النهائي
    itemContainer.innerHTML = `
        ${contentHtml}
        <p>${cleanText.substring(0, 200)}...</p>
        <div class="feed-media">${mediaHtml}</div>
    `;

    return itemContainer;
}