# api/translate.py
# نقطة API لترجمة النصوص باستخدام Azure Translator - بايثون
# متوافقة مع Vercel Python Serverless Functions
#
# الاستخدام من الفرونت إند:
#   fetch('/api/translate', {
#     method: 'POST',
#     headers: { 'Content-Type': 'application/json' },
#     body: JSON.stringify({ text: 'Hello world', to: 'ar' })
#   })
#
# لازم تضيف الـ Environment Variables دي في إعدادات Vercel:
#   AZURE_TRANSLATOR_KEY
#   AZURE_TRANSLATOR_ENDPOINT   (مثال: https://api.cognitive.microsofttranslator.com)
#   AZURE_TRANSLATOR_REGION     (مثال: qatarcentral)

import os
import json
import uuid
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        raw_body = self.rfile.read(content_length)

        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "جسم الطلب لازم يكون JSON صحيح."})
            return

        text = body.get("text")
        to_lang = body.get("to")
        from_lang = body.get("from")

        if not text or not to_lang:
            self._send_json(400, {"error": "لازم تبعت 'text' و 'to' في جسم الطلب."})
            return

        key = os.environ.get("AZURE_TRANSLATOR_KEY")
        endpoint = os.environ.get("AZURE_TRANSLATOR_ENDPOINT", "https://api.cognitive.microsofttranslator.com")
        region = os.environ.get("AZURE_TRANSLATOR_REGION")

        if not key or not region:
            self._send_json(500, {
                "error": "إعدادات Azure مش مضبوطة. تأكد من AZURE_TRANSLATOR_KEY و AZURE_TRANSLATOR_REGION في Environment Variables."
            })
            return

        params = f"api-version=3.0&to={to_lang}"
        if from_lang:
            params += f"&from={from_lang}"

        url = f"{endpoint}/translate?{params}"
        request_body = json.dumps([{"text": text}]).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=request_body,
            method="POST",
            headers={
                "Ocp-Apim-Subscription-Key": key,
                "Ocp-Apim-Subscription-Region": region,
                "Content-Type": "application/json",
                "X-ClientTraceId": str(uuid.uuid4())
            }
        )

        try:
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode("utf-8"))
                translated_text = result[0]["translations"][0]["text"]
                detected_language = result[0].get("detectedLanguage", {}).get("language")

                self._send_json(200, {
                    "translatedText": translated_text,
                    "detectedLanguage": detected_language or from_lang
                })

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            self._send_json(e.code, {"error": f"خطأ من Azure: {error_body}"})

        except Exception as e:
            self._send_json(500, {"error": f"خطأ غير متوقع: {str(e)}"})

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
