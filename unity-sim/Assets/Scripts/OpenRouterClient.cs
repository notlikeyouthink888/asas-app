using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace AISim
{
    /// <summary>اتصال مباشر بـ OpenRouter (chat/completions والرصيد).</summary>
    public static class OpenRouterClient
    {
        public const string BaseUrl = "https://openrouter.ai/api/v1";
        public const string FallbackModel = "openrouter/auto";

        const string PrefKey = "aisim.openrouter.key";
        const string PrefModel = "aisim.openrouter.model";
        public const string DefaultModel = "openai/gpt-4o-mini";

        /// <summary>
        /// المفتاح بالترتيب: ما لُصق في الإعدادات داخل التطبيق ← ملف Assets/Resources/OpenRouterKey.txt
        /// ← متغير البيئة OPENROUTER_API_KEY.
        /// </summary>
        public static string ApiKey
        {
            get
            {
                var k = PlayerPrefs.GetString(PrefKey, "");
                if (!string.IsNullOrWhiteSpace(k)) return k.Trim();
                var asset = Resources.Load<TextAsset>("OpenRouterKey");
                if (asset != null && !string.IsNullOrWhiteSpace(asset.text)) return asset.text.Trim();
                return (Environment.GetEnvironmentVariable("OPENROUTER_API_KEY") ?? "").Trim();
            }
            set { PlayerPrefs.SetString(PrefKey, (value ?? "").Trim()); PlayerPrefs.Save(); }
        }

        public static string Model
        {
            get
            {
                var m = PlayerPrefs.GetString(PrefModel, "");
                return string.IsNullOrWhiteSpace(m) ? DefaultModel : m.Trim();
            }
            set { PlayerPrefs.SetString(PrefModel, (value ?? "").Trim()); PlayerPrefs.Save(); }
        }

        public static bool HasKey => !string.IsNullOrEmpty(ApiKey);

        static UnityWebRequest Request(string method, string path, string body = null)
        {
            var req = new UnityWebRequest(BaseUrl + path, method) { downloadHandler = new DownloadHandlerBuffer(), timeout = 120 };
            if (body != null)
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
                req.SetRequestHeader("Content-Type", "application/json");
            }
            req.SetRequestHeader("Authorization", "Bearer " + ApiKey);
            req.SetRequestHeader("HTTP-Referer", "https://github.com/notlikeyouthink888/asas-app");
            req.SetRequestHeader("X-Title", "Unity AI Simulation");
            return req;
        }

        static string ErrorOf(UnityWebRequest req)
        {
            var text = req.downloadHandler?.text;
            var d = MiniJson.ExtractObject(text);
            var msg = (d.Get("error") as Dictionary<string, object>).Str("message");
            if (string.IsNullOrEmpty(msg)) msg = string.IsNullOrEmpty(text) ? req.error : text;
            switch (req.responseCode)
            {
                case 401: return "المفتاح غير صحيح أو معطل (401). افتح الإعدادات وتأكد منه.\n" + msg;
                case 402: return "الرصيد في محفظة OpenRouter لا يكفي (402).\n" + msg;
                case 429: return "طلبات كثيرة أو حد مؤقت (429). جرّب بعد قليل.\n" + msg;
                case 0: return "تعذر الاتصال بالإنترنت: " + req.error;
                default: return $"خطأ {req.responseCode}: {msg}";
            }
        }

        /// <summary>يرسل المحادثة ويعيد نص رد النموذج.</summary>
        public static IEnumerator Chat(List<Dictionary<string, object>> messages, Action<string> onOk, Action<string> onErr)
        {
            if (!HasKey) { onErr("لا يوجد مفتاح OpenRouter. افتح ⚙ الإعدادات والصق المفتاح."); yield break; }
            var model = Model;
            var body = new Dictionary<string, object>
            {
                ["model"] = model,
                // بديل تلقائي إن تعطل النموذج المختار أو لم يعد موجودًا
                ["models"] = model == FallbackModel ? new List<object> { model } : new List<object> { model, FallbackModel },
                ["messages"] = messages,
                ["temperature"] = 0.4,
                ["max_tokens"] = 3000,
                ["response_format"] = new Dictionary<string, object> { ["type"] = "json_object" },
            };
            using (var req = Request("POST", "/chat/completions", MiniJson.Serialize(body)))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) { onErr(ErrorOf(req)); yield break; }
                var d = MiniJson.ExtractObject(req.downloadHandler.text);
                var choices = d.Get("choices") as List<object>;
                var msg = (choices != null && choices.Count > 0 ? choices[0] as Dictionary<string, object> : null).Get("message") as Dictionary<string, object>;
                var content = msg.Str("content");
                if (string.IsNullOrEmpty(content))
                {
                    var err = (d.Get("error") as Dictionary<string, object>).Str("message");
                    onErr(err ?? "رد فارغ من النموذج. جرّب نموذجًا آخر من الإعدادات.");
                    yield break;
                }
                onOk(content);
            }
        }

        /// <summary>رصيد المحفظة: /credits (المشحون − المستهلك)، وإن لم يتوفر فحد المفتاح من /key.</summary>
        public static IEnumerator Balance(Action<string> done)
        {
            if (!HasKey) { done("بلا مفتاح"); yield break; }
            using (var req = Request("GET", "/credits"))
            {
                yield return req.SendWebRequest();
                if (req.result == UnityWebRequest.Result.Success)
                {
                    var data = MiniJson.ExtractObject(req.downloadHandler.text).Get("data") as Dictionary<string, object>;
                    if (data.Has("total_credits"))
                    {
                        double left = data.Num("total_credits") - data.Num("total_usage");
                        done("$" + left.ToString("0.###", CultureInfo.InvariantCulture));
                        yield break;
                    }
                }
            }
            using (var req = Request("GET", "/key"))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) { done(req.responseCode == 401 ? "مفتاح غير صالح" : "غير معروف"); yield break; }
                var data = MiniJson.ExtractObject(req.downloadHandler.text).Get("data") as Dictionary<string, object>;
                var usage = data.Num("usage").ToString("0.###", CultureInfo.InvariantCulture);
                done(data.Has("limit_remaining")
                    ? "$" + data.Num("limit_remaining").ToString("0.###", CultureInfo.InvariantCulture)
                    : "المستهلك $" + usage);
            }
        }
    }
}
