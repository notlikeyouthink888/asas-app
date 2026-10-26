using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

namespace AISim
{
    /// <summary>
    /// قارئ وكاتب JSON صغير (JsonUtility لا يقرأ القواميس والقوائم الحرة).
    /// الكائنات تصير Dictionary&lt;string, object&gt;، والقوائم List&lt;object&gt;، والأرقام double.
    /// </summary>
    public static class MiniJson
    {
        public static object Parse(string s)
        {
            var p = new Parser(s);
            p.Ws();
            var v = p.Value();
            return v;
        }

        /// <summary>يستخرج أول كائن JSON من رد النموذج (حتى لو أحاطه بنص أو ```json).</summary>
        public static Dictionary<string, object> ExtractObject(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            int start = text.IndexOf('{');
            while (start >= 0)
            {
                int end = text.LastIndexOf('}');
                while (end > start)
                {
                    try
                    {
                        if (Parse(text.Substring(start, end - start + 1)) is Dictionary<string, object> d) return d;
                    }
                    catch (Exception) { }
                    end = text.LastIndexOf('}', end - 1);
                }
                start = text.IndexOf('{', start + 1);
            }
            return null;
        }

        sealed class Parser
        {
            readonly string s;
            int i;
            public Parser(string s) { this.s = s ?? ""; }

            public void Ws() { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

            Exception Err(string m) => new FormatException($"JSON: {m} عند {i}");

            public object Value()
            {
                Ws();
                if (i >= s.Length) throw Err("نهاية غير متوقعة");
                char c = s[i];
                switch (c)
                {
                    case '{': return Obj();
                    case '[': return Arr();
                    case '"': return Str();
                    case 't': Lit("true"); return true;
                    case 'f': Lit("false"); return false;
                    case 'n': Lit("null"); return null;
                    default: return Num();
                }
            }

            void Lit(string w)
            {
                if (string.CompareOrdinal(s, i, w, 0, w.Length) != 0) throw Err("قيمة غير معروفة");
                i += w.Length;
            }

            Dictionary<string, object> Obj()
            {
                var d = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                i++;
                Ws();
                if (i < s.Length && s[i] == '}') { i++; return d; }
                for (;;)
                {
                    Ws();
                    if (i >= s.Length || s[i] != '"') throw Err("متوقع مفتاح");
                    var k = Str();
                    Ws();
                    if (i >= s.Length || s[i] != ':') throw Err("متوقع :");
                    i++;
                    d[k] = Value();
                    Ws();
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == '}') { i++; return d; }
                    throw Err("متوقع , أو }");
                }
            }

            List<object> Arr()
            {
                var l = new List<object>();
                i++;
                Ws();
                if (i < s.Length && s[i] == ']') { i++; return l; }
                for (;;)
                {
                    l.Add(Value());
                    Ws();
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == ']') { i++; return l; }
                    throw Err("متوقع , أو ]");
                }
            }

            string Str()
            {
                var sb = new StringBuilder();
                i++;
                while (i < s.Length)
                {
                    char c = s[i++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (i >= s.Length) break;
                    char e = s[i++];
                    switch (e)
                    {
                        case 'n': sb.Append('\n'); break;
                        case 't': sb.Append('\t'); break;
                        case 'r': sb.Append('\r'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw Err("\\u ناقص");
                            sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber));
                            i += 4;
                            break;
                        default: sb.Append(e); break;
                    }
                }
                throw Err("نص غير مغلق");
            }

            object Num()
            {
                int st = i;
                while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
                if (st == i) throw Err("حرف غير متوقع");
                return double.Parse(s.Substring(st, i - st), NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }

        public static string Serialize(object o)
        {
            var sb = new StringBuilder();
            Write(sb, o);
            return sb.ToString();
        }

        static void Write(StringBuilder sb, object o)
        {
            switch (o)
            {
                case null: sb.Append("null"); break;
                case string str: WriteStr(sb, str); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case IDictionary d:
                {
                    sb.Append('{');
                    bool first = true;
                    foreach (DictionaryEntry kv in d)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteStr(sb, kv.Key.ToString());
                        sb.Append(':');
                        Write(sb, kv.Value);
                    }
                    sb.Append('}');
                    break;
                }
                case IEnumerable e:
                {
                    sb.Append('[');
                    bool first = true;
                    foreach (var x in e)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        Write(sb, x);
                    }
                    sb.Append(']');
                    break;
                }
                case float f: sb.Append(f.ToString("0.###", CultureInfo.InvariantCulture)); break;
                case double db: sb.Append(db.ToString("0.###", CultureInfo.InvariantCulture)); break;
                case IFormattable n: sb.Append(n.ToString(null, CultureInfo.InvariantCulture)); break;
                default: WriteStr(sb, o.ToString()); break;
            }
        }

        static void WriteStr(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        /* ── قراءة مريحة لحقول الأوامر ───────────────────── */

        public static object Get(this Dictionary<string, object> d, string key)
            => d != null && d.TryGetValue(key, out var v) ? v : null;

        public static bool Has(this Dictionary<string, object> d, string key) => d.Get(key) != null;

        public static string Str(this Dictionary<string, object> d, string key, string def = null)
        {
            var v = d.Get(key);
            return v == null ? def : v as string ?? Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static float Num(this Dictionary<string, object> d, string key, float def = 0f)
            => ToFloat(d.Get(key), def);

        public static bool Bool(this Dictionary<string, object> d, string key, bool def = false)
        {
            var v = d.Get(key);
            if (v is bool b) return b;
            if (v is double n) return n != 0;
            if (v is string s) return s == "true" || s == "1" || s == "yes" || s == "on";
            return def;
        }

        public static float ToFloat(object v, float def = 0f)
        {
            if (v is double n) return (float)n;
            if (v is bool b) return b ? 1 : 0;
            if (v is string s && float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var f)) return f;
            return def;
        }

        /// <summary>يقبل [x,y,z] أو {"x":..} أو رقمًا واحدًا (لكل المحاور).</summary>
        public static Vector3? Vec(this Dictionary<string, object> d, string key) => ToVec(d.Get(key));

        public static Vector3? ToVec(object v)
        {
            switch (v)
            {
                case List<object> l when l.Count > 0:
                    return new Vector3(ToFloat(l[0]), l.Count > 1 ? ToFloat(l[1]) : 0, l.Count > 2 ? ToFloat(l[2]) : 0);
                case Dictionary<string, object> o:
                    return new Vector3(o.Num("x"), o.Num("y"), o.Num("z"));
                case double n:
                    return Vector3.one * (float)n;
                default:
                    return null;
            }
        }
    }
}
