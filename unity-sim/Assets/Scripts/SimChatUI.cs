using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace AISim
{
    /// <summary>
    /// لوحة المحادثة: تكتب ما تريد، يرسله إلى OpenRouter مع وصف العالم، وينفذ الأوامر التي يردها.
    /// مبنية بـ IMGUI حتى تعمل في أي مشروع بلا حزم إضافية.
    /// </summary>
    public class SimChatUI : MonoBehaviour
    {
        class Msg
        {
            public bool user, error;
            public string text;
            public List<string> lines;
            public float width = -1;
        }

        const int HistoryLimit = 16;
        static readonly string[] Examples =
        {
            "سويلي بيت بي باب وشباك وشجرتين يمه",
            "طيّح 30 كرة ملونة من السما وخليهن ينطّن",
            "سوي نظام شمسي والكواكب تدور حول الشمس",
            "حولها 2D وسوي هرم من 15 مكعب وفجّره",
            "خليها ليل وجاذبية القمر",
        };
        static readonly string[] Presets = { "openai/gpt-4o-mini", "google/gemini-2.5-flash", "anthropic/claude-sonnet-4.5", "deepseek/deepseek-chat", OpenRouterClient.FallbackModel };

        readonly List<Msg> chat = new List<Msg>();
        readonly List<Dictionary<string, object>> history = new List<Dictionary<string, object>>();
        SimWorld world;
        string input = "", status = "", balance = "…";
        bool busy, settings, hidden, showKey, dragging;
        string keyField, modelField;
        Vector2 scroll;
        float scale = 1f;
        Rect panel;
        GUIStyle label, labelR, bubbleUser, bubbleAi, bubbleErr, panelBg, title, small, smallR;

        void Start()
        {
            world = SimWorld.Instance;
            keyField = OpenRouterClient.ApiKey;
            modelField = OpenRouterClient.Model;
            Add(false, "هلا! اكتبلي أي شي تريده يصير بالمحاكاة وآني أسويه. مثلًا: «سويلي سيارة حمرا وخليها تمشي».");
            if (!OpenRouterClient.HasKey)
            {
                settings = true;
                Add(false, "أولًا الصق مفتاح OpenRouter بالإعدادات واضغط حفظ.", true);
            }
            else RefreshBalance();
        }

        void Add(bool user, string text, bool error = false) => chat.Add(new Msg { user = user, text = text, error = error });

        void RefreshBalance()
        {
            balance = "…";
            StartCoroutine(OpenRouterClient.Balance(b => balance = b));
        }

        /* ── الإرسال ─────────────────────────────────────── */

        void Send(string text)
        {
            text = (text ?? "").Trim();
            if (busy || text == "") return;
            input = "";
            Add(true, text);
            scroll.y = float.MaxValue;
            StartCoroutine(Ask(text));
        }

        IEnumerator Ask(string text)
        {
            busy = true;
            status = "يفكر…";
            var messages = new List<Dictionary<string, object>>
            {
                new Dictionary<string, object> { ["role"] = "system", ["content"] = SimPrompt.System },
            };
            int from = Mathf.Max(0, history.Count - HistoryLimit);
            for (int i = from; i < history.Count; i++) messages.Add(history[i]);
            messages.Add(new Dictionary<string, object>
            {
                ["role"] = "user",
                ["content"] = "Current world state:\n" + world.Describe() + "\n\nUser: " + text,
            });

            string reply = null, err = null;
            yield return OpenRouterClient.Chat(messages, r => reply = r, e => err = e);
            if (err != null)
            {
                Add(false, err, true);
                busy = false;
                status = "";
                yield break;
            }

            history.Add(new Dictionary<string, object> { ["role"] = "user", ["content"] = text });
            history.Add(new Dictionary<string, object> { ["role"] = "assistant", ["content"] = reply });

            var d = MiniJson.ExtractObject(reply);
            if (d == null)
            {
                Add(false, reply.Trim());
            }
            else
            {
                var say = d.Str("reply") ?? d.Str("message") ?? "";
                if (say != "") Add(false, say);
                var log = new List<string>();
                status = "ينفذ…";
                yield return world.Run(d.Get("actions") as List<object>, log);
                if (log.Count > 0) Add(false, string.Join("\n", log), true);
            }
            scroll.y = float.MaxValue;
            busy = false;
            status = "";
            RefreshBalance();
        }

        /* ── الواجهة ─────────────────────────────────────── */

        void Styles()
        {
            if (label != null) return;
            var font = Resources.Load<Font>("ArabicFont");
            label = new GUIStyle(GUI.skin.label) { fontSize = 16, wordWrap = false, richText = false };
            if (font) label.font = font;
            label.normal.textColor = Color.white;
            labelR = new GUIStyle(label) { alignment = TextAnchor.UpperRight };
            small = new GUIStyle(label) { fontSize = 13 };
            small.normal.textColor = new Color(0.8f, 0.85f, 0.9f);
            smallR = new GUIStyle(small) { alignment = TextAnchor.MiddleRight };
            title = new GUIStyle(label) { fontSize = 18, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleRight };
            bubbleUser = Bubble(new Color(0.15f, 0.42f, 0.85f, 0.95f));
            bubbleAi = Bubble(new Color(0.18f, 0.2f, 0.24f, 0.95f));
            bubbleErr = Bubble(new Color(0.55f, 0.16f, 0.16f, 0.95f));
            panelBg = Bubble(new Color(0.07f, 0.08f, 0.1f, 0.9f));
        }

        static GUIStyle Bubble(Color c)
        {
            var tex = new Texture2D(1, 1);
            tex.SetPixel(0, 0, c);
            tex.Apply();
            var s = new GUIStyle { padding = new RectOffset(10, 10, 6, 6), margin = new RectOffset(4, 4, 4, 4) };
            s.normal.background = tex;
            return s;
        }

        void Rtl(string text, GUIStyle style, float width, Msg cache = null)
        {
            List<string> lines;
            if (cache != null && Mathf.Approximately(cache.width, width)) lines = cache.lines;
            else
            {
                lines = ArabicText.Wrap(text, style, width);
                if (cache != null) { cache.lines = lines; cache.width = width; }
            }
            var st = ArabicText.HasRtl(text) ? (style == small ? smallR : labelR) : style;
            foreach (var l in lines) GUILayout.Label(l, st, GUILayout.Width(width));
        }

        bool Button(string text, params GUILayoutOption[] o) => GUILayout.Button(ArabicText.Fix(text), o);

        void OnGUI()
        {
            Styles();
            scale = Mathf.Max(1f, Mathf.Min(Screen.width, Screen.height) / 720f);
            GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1));
            float vw = Screen.width / scale, vh = Screen.height / scale;
            bool narrow = vw < 760;
            panel = narrow ? new Rect(0, vh * 0.45f, vw, vh * 0.55f) : new Rect(vw - 420, 0, 420, vh);
            if (hidden) panel = new Rect(vw - 1, 0, 0, 0);

            CameraInput();
            Toolbar();
            if (hidden) return;

            GUI.Box(panel, GUIContent.none, panelBg);
            GUILayout.BeginArea(new Rect(panel.x + 8, panel.y + 6, panel.width - 16, panel.height - 12));
            GUILayout.BeginHorizontal();
            if (Button(settings ? "رجوع" : "⚙ الإعدادات", GUILayout.Width(110))) settings = !settings;
            GUILayout.Label(ArabicText.Fix("الرصيد: " + balance), smallR, GUILayout.Width(110));
            GUILayout.Label(ArabicText.Fix("محاكاة الذكاء الاصطناعي"), title);
            GUILayout.EndHorizontal();

            if (settings) Settings(panel.width - 16);
            else Chat(panel.width - 16);
            GUILayout.EndArea();
        }

        void Toolbar()
        {
            GUILayout.BeginArea(new Rect(8, 8, 330, 40));
            GUILayout.BeginHorizontal();
            var cam = world ? world.Camera3D : null;
            if (GUILayout.Button("+", GUILayout.Width(40), GUILayout.Height(32)) && cam) cam.Zoom(-3);
            if (GUILayout.Button("−", GUILayout.Width(40), GUILayout.Height(32)) && cam) cam.Zoom(3);
            if (Button("كاميرا", GUILayout.Width(70), GUILayout.Height(32)) && cam) cam.ResetView();
            if (Button(hidden ? "إظهار" : "إخفاء", GUILayout.Width(70), GUILayout.Height(32))) hidden = !hidden;
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        void CameraInput()
        {
            var e = Event.current;
            var cam = world ? world.Camera3D : null;
            if (!cam) return;
            bool overUi = panel.Contains(e.mousePosition) || new Rect(0, 0, 340, 50).Contains(e.mousePosition);
            if (e.type == EventType.MouseDown && !overUi) dragging = true;
            if (e.rawType == EventType.MouseUp) dragging = false;
            if (e.type == EventType.MouseDrag && dragging) { cam.Drag(e.delta); e.Use(); }
            if (e.type == EventType.ScrollWheel && !overUi) { cam.Zoom(e.delta.y); e.Use(); }
        }

        void Chat(float w)
        {
            scroll = GUILayout.BeginScrollView(scroll);
            float bw = w - 60;
            foreach (var m in chat)
            {
                GUILayout.BeginHorizontal();
                if (m.user) GUILayout.FlexibleSpace();
                GUILayout.BeginVertical(m.error ? bubbleErr : m.user ? bubbleUser : bubbleAi);
                Rtl(m.text, label, bw, m);
                GUILayout.EndVertical();
                if (!m.user) GUILayout.FlexibleSpace();
                GUILayout.EndHorizontal();
            }
            if (chat.Count <= 2)
            {
                GUILayout.Space(6);
                GUILayout.Label(ArabicText.Fix("جرّب:"), labelR);
                foreach (var ex in Examples)
                    if (Button(ex) && !busy) Send(ex);
            }
            GUILayout.EndScrollView();

            if (status != "") GUILayout.Label(ArabicText.Fix(status), smallR);
            if (ArabicText.HasRtl(input))
            {
                var last = ArabicText.Wrap(input, small, w - 10);
                GUILayout.Label(last[last.Count - 1], smallR);
            }

            var e = Event.current;
            bool enter = e.type == EventType.KeyDown && (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.KeypadEnter) && GUI.GetNameOfFocusedControl() == "input";
            GUILayout.BeginHorizontal();
            GUI.enabled = !busy;
            if (Button("إرسال", GUILayout.Width(80), GUILayout.Height(34)) || enter)
            {
                Send(input);
                if (enter) e.Use();
            }
            GUI.enabled = true;
            GUI.SetNextControlName("input");
            input = GUILayout.TextField(input, 500, GUILayout.Height(34));
            GUILayout.EndHorizontal();
        }

        void Settings(float w)
        {
            scroll = GUILayout.BeginScrollView(scroll);
            Rtl("مفتاح OpenRouter (يبدأ بـ sk-or-). يُحفظ على هذا الجهاز فقط.", small, w - 30);
            keyField = showKey ? GUILayout.TextField(keyField ?? "") : GUILayout.PasswordField(keyField ?? "", '•');
            showKey = GUILayout.Toggle(showKey, ArabicText.Fix(" إظهار المفتاح"));
            GUILayout.Space(8);

            Rtl("النموذج (أي اسم من openrouter.ai/models). إن تعطل يتحول تلقائيًا إلى openrouter/auto.", small, w - 30);
            modelField = GUILayout.TextField(modelField ?? "");
            foreach (var p in Presets)
                if (GUILayout.Button(p)) modelField = p;
            GUILayout.Space(8);

            if (Button("حفظ", GUILayout.Height(34)))
            {
                OpenRouterClient.ApiKey = keyField;
                OpenRouterClient.Model = modelField;
                modelField = OpenRouterClient.Model;
                settings = false;
                Add(false, OpenRouterClient.HasKey ? $"تم الحفظ. النموذج: {OpenRouterClient.Model}" : "المفتاح فارغ!", !OpenRouterClient.HasKey);
                RefreshBalance();
            }
            if (Button("تحديث الرصيد")) RefreshBalance();
            if (Button("مسح المحادثة")) { chat.Clear(); history.Clear(); Add(false, "بدينا من جديد. شنو تريد أسوي؟"); }
            if (Button("تصفير العالم")) world.ResetWorld();
            GUILayout.EndScrollView();
        }
    }
}
