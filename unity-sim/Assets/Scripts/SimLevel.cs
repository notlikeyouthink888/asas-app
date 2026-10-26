using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace AISim
{
    /// <summary>
    /// المرحلة = كل التعديلات التي طلبتها من الذكاء الاصطناعي، بالترتيب (دفعة أوامر لكل رسالة).
    /// تُحفظ على الجهاز وتُعاد عند كل تشغيل، فتبقى تحديثاتك على اللعبة. التراجع يحذف آخر دفعة.
    /// أول مرة تُقرأ المرحلة الافتراضية من Assets/Resources/DefaultLevel.json.
    /// </summary>
    public static class SimLevel
    {
        public static readonly List<List<object>> Batches = new List<List<object>>();

        static string FilePath => Path.Combine(Application.persistentDataPath, "adventure_level.json");

        public static void Load()
        {
            string text = null;
            try { if (File.Exists(FilePath)) text = File.ReadAllText(FilePath); }
            catch (Exception e) { Debug.LogWarning("تعذر قراءة المرحلة: " + e.Message); }
            if (text == null) text = Resources.Load<TextAsset>("DefaultLevel")?.text;
            SetFrom(text);
        }

        /// <summary>يقبل [[أوامر], [أوامر]] أو {"batches": [...]}.</summary>
        public static bool SetFrom(string text)
        {
            object root;
            try { root = string.IsNullOrWhiteSpace(text) ? null : MiniJson.Parse(text); }
            catch (Exception) { return false; }
            if (root is Dictionary<string, object> d) root = d.Get("batches");
            if (!(root is List<object> list)) return false;
            Batches.Clear();
            foreach (var b in list)
                if (b is List<object> actions && actions.Count > 0) Batches.Add(actions);
            return true;
        }

        public static void Append(List<object> actions)
        {
            if (actions == null || actions.Count == 0) return;
            Batches.Add(actions);
            Save();
        }

        public static bool Undo()
        {
            if (Batches.Count == 0) return false;
            Batches.RemoveAt(Batches.Count - 1);
            Save();
            return true;
        }

        public static void Empty()
        {
            Batches.Clear();
            Save();
        }

        public static void ResetToDefault()
        {
            try { if (File.Exists(FilePath)) File.Delete(FilePath); }
            catch (Exception e) { Debug.LogWarning(e.Message); }
            Load();
        }

        public static string Json => MiniJson.Serialize(new Dictionary<string, object> { ["batches"] = Batches });

        public static void Save()
        {
            try { File.WriteAllText(FilePath, Json); }
            catch (Exception e) { Debug.LogWarning("تعذر حفظ المرحلة: " + e.Message); }
        }
    }
}
