using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace AISim
{
    /// <summary>
    /// Unity لا يشكّل الحروف العربية ولا يعكس اتجاهها، فتظهر مقطعة ومقلوبة.
    /// هذا الصنف يحوّل النص إلى أشكال الحروف المتصلة (Presentation Forms) ويرتبه من اليمين لليسار
    /// مع إبقاء الأرقام والكلمات الإنجليزية بترتيبها الصحيح.
    /// </summary>
    public static class ArabicText
    {
        // الحرف → (منفصل، نهائي، بدائي، وسطي). 0 = لا يوجد شكل (الحرف لا يتصل بما بعده).
        static readonly Dictionary<char, char[]> Forms = new Dictionary<char, char[]>
        {
            ['ء'] = new[] { 'ﺀ', '\0', '\0', '\0' },
            ['آ'] = new[] { 'ﺁ', 'ﺂ', '\0', '\0' },
            ['أ'] = new[] { 'ﺃ', 'ﺄ', '\0', '\0' },
            ['ؤ'] = new[] { 'ﺅ', 'ﺆ', '\0', '\0' },
            ['إ'] = new[] { 'ﺇ', 'ﺈ', '\0', '\0' },
            ['ئ'] = new[] { 'ﺉ', 'ﺊ', 'ﺋ', 'ﺌ' },
            ['ا'] = new[] { 'ﺍ', 'ﺎ', '\0', '\0' },
            ['ب'] = new[] { 'ﺏ', 'ﺐ', 'ﺑ', 'ﺒ' },
            ['ة'] = new[] { 'ﺓ', 'ﺔ', '\0', '\0' },
            ['ت'] = new[] { 'ﺕ', 'ﺖ', 'ﺗ', 'ﺘ' },
            ['ث'] = new[] { 'ﺙ', 'ﺚ', 'ﺛ', 'ﺜ' },
            ['ج'] = new[] { 'ﺝ', 'ﺞ', 'ﺟ', 'ﺠ' },
            ['ح'] = new[] { 'ﺡ', 'ﺢ', 'ﺣ', 'ﺤ' },
            ['خ'] = new[] { 'ﺥ', 'ﺦ', 'ﺧ', 'ﺨ' },
            ['د'] = new[] { 'ﺩ', 'ﺪ', '\0', '\0' },
            ['ذ'] = new[] { 'ﺫ', 'ﺬ', '\0', '\0' },
            ['ر'] = new[] { 'ﺭ', 'ﺮ', '\0', '\0' },
            ['ز'] = new[] { 'ﺯ', 'ﺰ', '\0', '\0' },
            ['س'] = new[] { 'ﺱ', 'ﺲ', 'ﺳ', 'ﺴ' },
            ['ش'] = new[] { 'ﺵ', 'ﺶ', 'ﺷ', 'ﺸ' },
            ['ص'] = new[] { 'ﺹ', 'ﺺ', 'ﺻ', 'ﺼ' },
            ['ض'] = new[] { 'ﺽ', 'ﺾ', 'ﺿ', 'ﻀ' },
            ['ط'] = new[] { 'ﻁ', 'ﻂ', 'ﻃ', 'ﻄ' },
            ['ظ'] = new[] { 'ﻅ', 'ﻆ', 'ﻇ', 'ﻈ' },
            ['ع'] = new[] { 'ﻉ', 'ﻊ', 'ﻋ', 'ﻌ' },
            ['غ'] = new[] { 'ﻍ', 'ﻎ', 'ﻏ', 'ﻐ' },
            ['ف'] = new[] { 'ﻑ', 'ﻒ', 'ﻓ', 'ﻔ' },
            ['ق'] = new[] { 'ﻕ', 'ﻖ', 'ﻗ', 'ﻘ' },
            ['ك'] = new[] { 'ﻙ', 'ﻚ', 'ﻛ', 'ﻜ' },
            ['ل'] = new[] { 'ﻝ', 'ﻞ', 'ﻟ', 'ﻠ' },
            ['م'] = new[] { 'ﻡ', 'ﻢ', 'ﻣ', 'ﻤ' },
            ['ن'] = new[] { 'ﻥ', 'ﻦ', 'ﻧ', 'ﻨ' },
            ['ه'] = new[] { 'ﻩ', 'ﻪ', 'ﻫ', 'ﻬ' },
            ['و'] = new[] { 'ﻭ', 'ﻮ', '\0', '\0' },
            ['ى'] = new[] { 'ﻯ', 'ﻰ', '\0', '\0' },
            ['ي'] = new[] { 'ﻱ', 'ﻲ', 'ﻳ', 'ﻴ' },
            // حروف اللهجة العراقية والفارسية: پ چ ژ ک گ ی
            ['پ'] = new[] { 'ﭖ', 'ﭗ', 'ﭘ', 'ﭙ' },
            ['چ'] = new[] { 'ﭺ', 'ﭻ', 'ﭼ', 'ﭽ' },
            ['ژ'] = new[] { 'ﮊ', 'ﮋ', '\0', '\0' },
            ['ک'] = new[] { 'ﮎ', 'ﮏ', 'ﮐ', 'ﮑ' },
            ['گ'] = new[] { 'ﮒ', 'ﮓ', 'ﮔ', 'ﮕ' },
            ['ی'] = new[] { 'ﯼ', 'ﯽ', 'ﯾ', 'ﯿ' },
        };

        // لام + ألف → (منفصل، نهائي)
        static readonly Dictionary<char, char[]> LamAlef = new Dictionary<char, char[]>
        {
            ['آ'] = new[] { 'ﻵ', 'ﻶ' },
            ['أ'] = new[] { 'ﻷ', 'ﻸ' },
            ['إ'] = new[] { 'ﻹ', 'ﻺ' },
            ['ا'] = new[] { 'ﻻ', 'ﻼ' },
        };

        const char Tatweel = 'ـ';

        static bool IsMark(char c) => (c >= 'ً' && c <= 'ٟ') || c == 'ٰ';
        static bool Joins(char c) => c == Tatweel || (Forms.TryGetValue(c, out var f) && f[1] != '\0');
        static bool JoinsNext(char c) => c == Tatweel || (Forms.TryGetValue(c, out var f) && f[2] != '\0');

        public static bool IsRtl(char c) =>
            (c >= '֐' && c <= 'ࣿ') || (c >= 'יִ' && c <= '﷿') || (c >= 'ﹰ' && c <= '﻿');

        public static bool HasRtl(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            foreach (char c in s) if (IsRtl(c)) return true;
            return false;
        }

        /// <summary>سطر واحد جاهز للعرض.</summary>
        public static string Fix(string line)
        {
            if (!HasRtl(line)) return line;
            return Visual(Shape(line));
        }

        static string Shape(string s)
        {
            // التشكيل (الحركات) يُحذف: الخط الافتراضي يرسمه في غير مكانه بعد العكس
            var chars = new List<char>(s.Length);
            foreach (char c in s) if (!IsMark(c)) chars.Add(c);

            var sb = new StringBuilder(chars.Count);
            for (int i = 0; i < chars.Count; i++)
            {
                char c = chars[i];
                if (!Forms.TryGetValue(c, out var f)) { sb.Append(c); continue; }
                bool prev = i > 0 && JoinsNext(chars[i - 1]);
                char next = i + 1 < chars.Count ? chars[i + 1] : '\0';

                if (c == 'ل' && LamAlef.TryGetValue(next, out var la))
                {
                    sb.Append(prev ? la[1] : la[0]);
                    i++;
                    continue;
                }

                bool nxt = next != '\0' && Joins(next) && f[2] != '\0';
                char shaped = prev && nxt ? f[3] : prev ? f[1] : nxt ? f[2] : f[0];
                sb.Append(shaped == '\0' ? f[0] : shaped);
            }
            return sb.ToString();
        }

        enum Dir { L, R, N }

        static Dir DirOf(char c)
        {
            if (IsRtl(c)) return Dir.R;
            if (char.IsLetterOrDigit(c)) return Dir.L;
            return Dir.N;
        }

        static char Mirror(char c)
        {
            switch (c)
            {
                case '(': return ')';
                case ')': return '(';
                case '[': return ']';
                case ']': return '[';
                case '{': return '}';
                case '}': return '{';
                case '<': return '>';
                case '>': return '<';
                case '«': return '»';
                case '»': return '«';
                default: return c;
            }
        }

        /// <summary>ترتيب ثنائي الاتجاه مبسّط: الفقرة من اليمين لليسار، والمقاطع اللاتينية/الأرقام تبقى كما هي.</summary>
        static string Visual(string s)
        {
            int n = s.Length;
            var dirs = new Dir[n];
            for (int i = 0; i < n; i++) dirs[i] = DirOf(s[i]);
            // رموز مثل $ و % و . الملاصقة لرقم أو حرف لاتيني تبقى معه ($1.25، gpt-4o)
            for (int i = 0; i < n; i++)
            {
                if (dirs[i] != Dir.N || "$%#@.-+_/".IndexOf(s[i]) < 0) continue;
                bool prevL = i > 0 && s[i - 1] < 128 && char.IsLetterOrDigit(s[i - 1]);
                bool nextL = i + 1 < n && s[i + 1] < 128 && char.IsLetterOrDigit(s[i + 1]);
                if (prevL || nextL) dirs[i] = Dir.L;
            }
            // المحايد (مسافة، علامة) بين مقطعين لاتينيين يتبعهما، وإلا فهو من اليمين لليسار
            for (int i = 0; i < n; i++)
            {
                if (dirs[i] != Dir.N) continue;
                int a = i - 1;
                while (a >= 0 && dirs[a] == Dir.N) a--;
                int b = i + 1;
                while (b < n && dirs[b] == Dir.N) b++;
                bool ltr = a >= 0 && b < n && dirs[a] == Dir.L && dirs[b] == Dir.L;
                dirs[i] = ltr ? Dir.L : Dir.R;
            }

            var runs = new List<string>();
            int st = 0;
            for (int i = 1; i <= n; i++)
            {
                if (i < n && dirs[i] == dirs[st]) continue;
                string run = s.Substring(st, i - st);
                if (dirs[st] == Dir.R)
                {
                    var arr = run.ToCharArray();
                    System.Array.Reverse(arr);
                    for (int k = 0; k < arr.Length; k++) arr[k] = Mirror(arr[k]);
                    run = new string(arr);
                }
                runs.Add(run);
                st = i;
            }
            runs.Reverse();
            return string.Concat(runs);
        }

        /// <summary>
        /// يلف النص على أسطر بعرض معين (بالترتيب المنطقي) ثم يجهز كل سطر للعرض،
        /// لأن لف IMGUI بعد العكس يقلب ترتيب الأسطر.
        /// </summary>
        public static List<string> Wrap(string text, GUIStyle style, float width)
        {
            var lines = new List<string>();
            if (string.IsNullOrEmpty(text)) { lines.Add(""); return lines; }
            var tmp = new GUIContent();
            foreach (var para in text.Replace("\r", "").Split('\n'))
            {
                var words = para.Split(' ');
                var cur = new StringBuilder();
                foreach (var w in words)
                {
                    string trial = cur.Length == 0 ? w : cur + " " + w;
                    tmp.text = Fix(trial);
                    if (cur.Length > 0 && style.CalcSize(tmp).x > width)
                    {
                        lines.Add(Fix(cur.ToString()));
                        cur.Clear().Append(w);
                    }
                    else
                    {
                        cur.Clear().Append(trial);
                    }
                }
                lines.Add(Fix(cur.ToString()));
            }
            return lines;
        }
    }
}
