using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using UnityEngine;

namespace AISim
{
    /// <summary>العالم الذي ينفذ فيه الذكاء الاصطناعي أوامره (إنشاء، تحريك، فيزياء، كاميرا...).</summary>
    public class SimWorld : MonoBehaviour
    {
        public const int MaxObjects = 300;
        public static bool Is2D { get; private set; }
        public static SimWorld Instance { get; private set; }

        readonly List<GameObject> objects = new List<GameObject>();
        List<GameObject> lastSpawned = new List<GameObject>();
        Transform root;
        GameObject ground;
        Light sun;
        SimCamera cam;
        Font font;
        Vector3 sunDefaultEuler = new Vector3(50, -30, 0);

        void Awake()
        {
            Instance = this;
            root = new GameObject("AI Objects").transform;
            SetupScene();
        }

        void SetupScene()
        {
            var c = Camera.main;
            if (!c)
            {
                var go = new GameObject("Main Camera") { tag = "MainCamera" };
                c = go.AddComponent<Camera>();
                go.AddComponent<AudioListener>();
            }
            c.farClipPlane = 500f;
            if (!c.TryGetComponent(out cam)) cam = c.gameObject.AddComponent<SimCamera>();
            cam.ResetView();

            sun = FindAll<Light>().FirstOrDefault(l => l.type == LightType.Directional);
            if (!sun)
            {
                sun = new GameObject("Sun").AddComponent<Light>();
                sun.type = LightType.Directional;
                sun.shadows = LightShadows.Soft;
            }
            sun.transform.rotation = Quaternion.Euler(sunDefaultEuler);

            ground = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ground.name = "Ground";
            ground.transform.localScale = new Vector3(50, 1, 50);
            ground.transform.position = new Vector3(0, -0.5f, 0);
            ground.GetComponent<Renderer>().material.color = new Color(0.36f, 0.55f, 0.33f);

#if UNITY_2022_2_OR_NEWER
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
#else
            font = Resources.GetBuiltinResource<Font>("Arial.ttf");
#endif
            var custom = Resources.Load<Font>("ArabicFont");
            if (custom) font = custom;
        }

        static T[] FindAll<T>() where T : UnityEngine.Object
        {
#if UNITY_2023_1_OR_NEWER
            return UnityEngine.Object.FindObjectsByType<T>(FindObjectsSortMode.None);
#else
            return UnityEngine.Object.FindObjectsOfType<T>();
#endif
        }

        public SimCamera Camera3D => cam;
        public Font Font => font;
        // أثناء إعادة بناء المرحلة: بلا انتظار وبلا حركة تدريجية
        bool instant;

        /* ── وصف العالم للنموذج ──────────────────────────── */

        static double F(float v) => Math.Round(v, 2);
        static List<object> V(Vector3 v) => new List<object> { F(v.x), F(v.y), F(v.z) };

        public string Describe()
        {
            objects.RemoveAll(o => !o);
            var list = new List<object>();
            foreach (var o in objects.Take(120))
            {
                var tag = o.GetComponent<SimTag>();
                var d = new Dictionary<string, object>
                {
                    ["name"] = o.name,
                    ["shape"] = tag ? tag.shape : "?",
                    ["pos"] = V(o.transform.position),
                    ["scale"] = V(o.transform.localScale),
                };
                if (tag && tag.shape != "text") d["color"] = "#" + ColorUtility.ToHtmlStringRGB(tag.color);
                if (tag && tag.role != "") d["role"] = tag.role;
                if (o.TryGetComponent<Enemy>(out var en)) d["enemyHealth"] = en.health;
                if (o.TryGetComponent<Npc>(out var npc)) d["title"] = npc.title;
                var beh = o.GetComponents<SimBehaviour>().Select(b => (object)b.Kind).ToList();
                if (beh.Count > 0) d["behaviors"] = beh;
                if (o.TryGetComponent<Rigidbody>(out var rb) && !rb.isKinematic) d["physics"] = true;
                list.Add(d);
            }
            var state = new Dictionary<string, object>
            {
                ["mode"] = Is2D ? "2d" : "3d",
                ["gravity"] = V(Physics.gravity),
                ["timeScale"] = F(Time.timeScale),
                ["objectCount"] = objects.Count,
                ["game"] = SimGame.Instance ? SimGame.Instance.Describe() : null,
                ["objects"] = list,
            };
            if (objects.Count > list.Count) state["note"] = $"only first {list.Count} objects listed";
            return MiniJson.Serialize(state);
        }

        /* ── تنفيذ الأوامر ───────────────────────────────── */

        public IEnumerator Run(List<object> actions, List<string> log, bool instant = false)
        {
            if (actions == null) yield break;
            this.instant = instant;
            foreach (var a in actions)
            {
                if (!(a is Dictionary<string, object> act)) continue;
                var type = (act.Str("type") ?? act.Str("action") ?? "").ToLowerInvariant();
                if (type == "wait")
                {
                    if (instant) continue;
                    yield return new WaitForSecondsRealtime(Mathf.Clamp(act.Num("seconds", 1f), 0f, 10f));
                    continue;
                }
                try { Do(type, act, log); }
                catch (Exception e) { log.Add($"{type}: {e.Message}"); Debug.LogException(e); }
            }
            this.instant = false;
        }

        void Do(string type, Dictionary<string, object> a, List<string> log)
        {
            var role = SimGame.RoleOf(type, a) ?? (type == "spawn" || type == "create" ? SimGame.RoleOf(a.Str("role") ?? "", a) : null);
            if (role != null) { Spawn(SimGame.WithDefaults(role, a), log, role); return; }
            switch (type)
            {
                case "spawn": case "create": Spawn(a, log); break;
                case "delete": case "remove": case "destroy":
                    foreach (var o in Targets(a)) { if (IsPlayer(o)) continue; objects.Remove(o); Destroy(o); }
                    break;
                case "player": case "quest": case "message": case "banner": case "score": case "heal":
                    SimGame.Instance.Command(type, a, log);
                    break;
                case "clear": Clear(); break;
                case "reset": ResetWorld(); break;
                case "move": foreach (var o in Targets(a)) Move(o, a); break;
                case "rotate":
                    foreach (var o in Targets(a))
                    {
                        if (a.Vec("rotation") is Vector3 r) o.transform.rotation = Quaternion.Euler(r);
                        if (a.Vec("by") is Vector3 b) o.transform.Rotate(b, Space.World);
                    }
                    break;
                case "scale":
                    foreach (var o in Targets(a))
                        if (a.Vec("scale") is Vector3 s) { o.transform.localScale = s; if (o.TryGetComponent<Pulse>(out var pl)) pl.Rebase(); }
                    break;
                case "color": foreach (var o in Targets(a)) Paint(o, a.Str("color")); break;
                case "rename":
                {
                    var t = Targets(a);
                    var n = a.Str("name");
                    for (int i = 0; i < t.Count && !string.IsNullOrEmpty(n); i++) t[i].name = t.Count == 1 ? n : $"{n}_{i + 1}";
                    break;
                }
                case "behavior": case "behaviour": foreach (var o in Targets(a)) Behave(o, a); break;
                case "physics": foreach (var o in Targets(a)) if (!IsPlayer(o)) Physic(o, a); break;
                case "force": case "push": case "jump":
                {
                    var f = a.Vec("force") ?? new Vector3(0, 6, 0);
                    foreach (var o in Targets(a))
                    {
                        if (o.TryGetComponent<SimPlayer>(out var pl)) pl.Knock(f);
                        else Body(o).AddForce(f, ForceMode.VelocityChange);
                    }
                    break;
                }
                case "explode": Explode(a); break;
                case "gravity": if (a.Vec("value") is Vector3 g) Physics.gravity = g; break;
                case "time": Time.timeScale = Mathf.Clamp(a.Num("scale", 1f), 0f, 10f); break;
                case "sky":
                {
                    var c = Camera.main;
                    if (c) { c.clearFlags = CameraClearFlags.SolidColor; c.backgroundColor = ParseColor(a.Str("color"), out _); }
                    break;
                }
                case "light":
                    if (a.Has("intensity")) sun.intensity = Mathf.Clamp(a.Num("intensity", 1f), 0f, 8f);
                    if (a.Has("color")) sun.color = ParseColor(a.Str("color"), out _);
                    if (a.Vec("rotation") is Vector3 lr) sun.transform.rotation = Quaternion.Euler(lr);
                    break;
                case "ground":
                    if (a.Has("color")) ground.GetComponent<Renderer>().material.color = ParseColor(a.Str("color"), out _);
                    if (a.Has("visible")) ground.SetActive(a.Bool("visible", true));
                    if (a.Has("size")) { var s = Mathf.Clamp(a.Num("size", 50), 2, 500); ground.transform.localScale = new Vector3(s, 1, Is2D ? 4 : s); }
                    break;
                case "camera": CameraCmd(a); break;
                case "text": case "label": Text(a, log); break;
                case "say": case "reply": case "": break;
                default: log.Add($"أمر غير معروف: {type}"); break;
            }
        }

        /* ── إنشاء الأجسام ───────────────────────────────── */

        static readonly Dictionary<string, PrimitiveType> Shapes = new Dictionary<string, PrimitiveType>(StringComparer.OrdinalIgnoreCase)
        {
            ["cube"] = PrimitiveType.Cube, ["box"] = PrimitiveType.Cube, ["square"] = PrimitiveType.Cube,
            ["sphere"] = PrimitiveType.Sphere, ["ball"] = PrimitiveType.Sphere, ["circle"] = PrimitiveType.Sphere,
            ["capsule"] = PrimitiveType.Capsule, ["cylinder"] = PrimitiveType.Cylinder,
            ["plane"] = PrimitiveType.Plane, ["quad"] = PrimitiveType.Quad,
        };

        static bool IsPlayer(GameObject o) => o.TryGetComponent<SimPlayer>(out _);

        void Spawn(Dictionary<string, object> a, List<string> log, string role = null)
        {
            var shapeName = (a.Str("shape") ?? "cube").ToLowerInvariant();
            if (!Shapes.TryGetValue(shapeName, out var prim)) { prim = PrimitiveType.Cube; shapeName = "cube"; }
            int count = Mathf.Clamp(Mathf.RoundToInt(a.Num("count", 1)), 1, 100);
            objects.RemoveAll(o => !o);
            if (objects.Count + count > MaxObjects)
            {
                count = MaxObjects - objects.Count;
                log.Add($"الحد الأقصى {MaxObjects} جسم في المشهد.");
                if (count <= 0) return;
            }

            var scale = a.Vec("scale") ?? Vector3.one;
            var basePos = a.Vec("position") ?? new Vector3(0, scale.y * 0.5f, 0);
            var pattern = (a.Str("pattern") ?? (count > 1 ? "line" : "single")).ToLowerInvariant();
            float spacing = a.Num("spacing", Mathf.Max(scale.x, scale.z, Is2D ? scale.y : 0) * 1.5f);
            var name = a.Str("name") ?? shapeName;
            var color = a.Str("color");
            var spawned = new List<GameObject>();

            for (int i = 0; i < count; i++)
            {
                var go = GameObject.CreatePrimitive(prim);
                go.transform.SetParent(root, true);
                go.name = Unique(count == 1 ? name : $"{name}_{i + 1}");
                go.transform.localScale = scale;
                go.transform.position = basePos + Offset(pattern, i, count, spacing, scale);
                if (a.Vec("rotation") is Vector3 r) go.transform.rotation = Quaternion.Euler(r);
                var tag = go.AddComponent<SimTag>();
                tag.shape = shapeName;
                Paint(go, color);
                if (a.Bool("physics") || a.Has("mass")) Physic(go, a);
                if (a.Has("behavior") || a.Has("behaviour")) Behave(go, a);
                if (role != null) SimGame.Instance.SetupRole(go, role, a);
                objects.Add(go);
                spawned.Add(go);
            }
            lastSpawned = spawned;
        }

        Vector3 Offset(string pattern, int i, int n, float sp, Vector3 scale)
        {
            switch (pattern)
            {
                case "circle": case "ring":
                {
                    float ang = i * Mathf.PI * 2f / n, rad = Mathf.Max(sp * n / (2f * Mathf.PI), sp);
                    return Is2D ? new Vector3(Mathf.Cos(ang) * rad, Mathf.Sin(ang) * rad + rad, 0) : new Vector3(Mathf.Cos(ang) * rad, 0, Mathf.Sin(ang) * rad);
                }
                case "grid":
                {
                    int side = Mathf.CeilToInt(Mathf.Sqrt(n));
                    float x = (i % side - (side - 1) / 2f) * sp, z = (i / side - (side - 1) / 2f) * sp;
                    return Is2D ? new Vector3(x, (i / side) * sp, 0) : new Vector3(x, 0, z);
                }
                case "random": case "scatter":
                {
                    var r = UnityEngine.Random.insideUnitCircle * Mathf.Max(5f, sp * Mathf.Sqrt(n));
                    return Is2D ? new Vector3(r.x, Mathf.Abs(r.y), 0) : new Vector3(r.x, 0, r.y);
                }
                case "stack": case "tower": return new Vector3(0, i * scale.y, 0);
                case "pyramid":
                {
                    // الصف السفلي أعرض صف، وكل صف أعلى ينقص جسمًا
                    int rows = RowsFor(n), row = 0, left = i;
                    while (row < rows - 1 && left >= rows - row) { left -= rows - row; row++; }
                    int width = rows - row;
                    float x = (left - (width - 1) / 2f) * scale.x * 1.02f;
                    return new Vector3(x, row * scale.y, 0);
                }
                case "single": return Vector3.zero;
                default: // line
                    return new Vector3((i - (n - 1) / 2f) * sp, 0, 0);
            }
        }

        static int RowsFor(int n)
        {
            int rows = 1;
            while (rows * (rows + 1) / 2 < n) rows++;
            return rows;
        }

        string Unique(string n)
        {
            if (!objects.Any(o => o && o.name == n)) return n;
            for (int k = 2; ; k++) if (!objects.Any(o => o && o.name == $"{n}_{k}")) return $"{n}_{k}";
        }

        /* ── الأهداف ──────────────────────────────────────── */

        List<GameObject> Targets(Dictionary<string, object> a)
        {
            objects.RemoveAll(o => !o);
            var t = a.Get("target") ?? a.Get("targets") ?? a.Get("name");
            if (t == null) return lastSpawned.Where(o => o).ToList();
            var keys = t is List<object> l ? l.Select(x => Convert.ToString(x, CultureInfo.InvariantCulture)) : new[] { Convert.ToString(t, CultureInfo.InvariantCulture) };
            var result = new List<GameObject>();
            foreach (var k in keys) foreach (var o in Find(k)) if (!result.Contains(o)) result.Add(o);
            return result;
        }

        public List<GameObject> Find(string key)
        {
            key = (key ?? "").Trim();
            if (key == "") return new List<GameObject>();
            var low = key.ToLowerInvariant();
            if (low == "all" || low == "*" || low == "everything" || key == "الكل" || key == "كلشي")
                return objects.Where(o => o).ToList();
            if (low == "last") return lastSpawned.Where(o => o).ToList();
            if (low == "player" || key == "اللاعب") return SimGame.Instance && SimGame.Instance.Player ? new List<GameObject> { SimGame.Instance.Player.gameObject } : new List<GameObject>();
            var exact = objects.Where(o => o && string.Equals(o.name, key, StringComparison.OrdinalIgnoreCase)).ToList();
            if (exact.Count > 0) return exact;
            var prefix = objects.Where(o => o && o.name.StartsWith(key, StringComparison.OrdinalIgnoreCase)).ToList();
            if (prefix.Count > 0) return prefix;
            var byShape = objects.Where(o => o && o.TryGetComponent<SimTag>(out var s) && string.Equals(s.shape, key, StringComparison.OrdinalIgnoreCase)).ToList();
            if (byShape.Count > 0) return byShape;
            return objects.Where(o => o && o.TryGetComponent<SimTag>(out var s) && s.colorName != "" && string.Equals(s.colorName, NormalizeColorName(key), StringComparison.OrdinalIgnoreCase)).ToList();
        }

        Transform FindOne(object key)
        {
            if (key is string s) return Find(s).FirstOrDefault()?.transform;
            return null;
        }

        /* ── تعديل الأجسام ───────────────────────────────── */

        void Move(GameObject o, Dictionary<string, object> a)
        {
            var target = a.Vec("position") ?? a.Vec("to");
            var by = a.Vec("by");
            var dest = target ?? o.transform.position + (by ?? Vector3.zero);
            float dur = instant ? 0f : a.Num("duration", 0f);
            if (dur > 0f) StartCoroutine(Glide(o.transform, dest, dur));
            else Teleport(o.transform, dest);
        }

        static void Teleport(Transform t, Vector3 p)
        {
            if (t.TryGetComponent<SimPlayer>(out var player)) { player.Teleport(p); return; }
            t.position = p;
            if (t.TryGetComponent<Bounce>(out var b)) b.Rebase();
            if (t.TryGetComponent<Rigidbody>(out var rb) && !rb.isKinematic) rb.position = p;
        }

        IEnumerator Glide(Transform t, Vector3 to, float dur)
        {
            var from = t.position;
            for (float e = 0; e < dur && t; e += Time.deltaTime)
            {
                Teleport(t, Vector3.Lerp(from, to, Mathf.SmoothStep(0, 1, e / dur)));
                yield return null;
            }
            if (t) Teleport(t, to);
        }

        void Paint(GameObject o, string color)
        {
            var tag = o.GetComponent<SimTag>();
            var c = ParseColor(color, out var cname);
            if (o.TryGetComponent<TextMesh>(out var tm)) tm.color = c;
            else if (o.TryGetComponent<Renderer>(out var r)) r.material.color = c;
            if (tag) { tag.color = c; tag.colorName = cname; }
        }

        Rigidbody Body(GameObject o)
        {
            if (!o.TryGetComponent<Rigidbody>(out var rb)) rb = o.AddComponent<Rigidbody>();
            rb.isKinematic = false;
            if (Is2D) rb.constraints = RigidbodyConstraints.FreezePositionZ | RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationY;
            // الحركات المبرمجة تعطل الفيزياء، فتُزال حين تُفعّل الفيزياء
            foreach (var b in o.GetComponents<SimBehaviour>()) if (b is Bounce || b is Wander || b is Orbit || b is Follow) Destroy(b);
            return rb;
        }

        void Physic(GameObject o, Dictionary<string, object> a)
        {
            if (a.Has("enabled") && !a.Bool("enabled", true))
            {
                if (o.TryGetComponent<Rigidbody>(out var old)) Destroy(old);
                return;
            }
            var rb = Body(o);
            rb.mass = Mathf.Clamp(a.Num("mass", 1f), 0.01f, 10000f);
            rb.useGravity = a.Bool("gravity", true);
            if (a.Has("bounciness") && o.TryGetComponent<Collider>(out var col))
            {
#if UNITY_6000_0_OR_NEWER
                col.material = new PhysicsMaterial { bounciness = Mathf.Clamp01(a.Num("bounciness")), bounceCombine = PhysicsMaterialCombine.Maximum };
#else
                col.material = new PhysicMaterial { bounciness = Mathf.Clamp01(a.Num("bounciness")), bounceCombine = PhysicMaterialCombine.Maximum };
#endif
            }
        }

        void Behave(GameObject o, Dictionary<string, object> a)
        {
            var kind = (a.Str("behavior") ?? a.Str("behaviour") ?? "").ToLowerInvariant();
            float speed = a.Num("speed", 1f);
            SimBehaviour b;
            switch (kind)
            {
                case "none": case "stop":
                    foreach (var x in o.GetComponents<SimBehaviour>()) Destroy(x);
                    return;
                case "spin": case "rotate":
                {
                    var s = o.AddComponent<Spin>();
                    s.axis = a.Vec("axis") ?? (Is2D ? Vector3.forward : Vector3.up);
                    b = s;
                    break;
                }
                case "bounce": case "jump":
                {
                    var s = o.AddComponent<Bounce>();
                    s.height = a.Num("height", 1f);
                    b = s;
                    break;
                }
                case "orbit":
                {
                    var s = o.AddComponent<Orbit>();
                    s.enabled = false;
                    var around = a.Get("around") ?? a.Get("center");
                    s.center = FindOne(around);
                    s.point = MiniJson.ToVec(around) ?? Vector3.zero;
                    s.radius = a.Num("radius", s.center ? Vector3.Distance(o.transform.position, s.center.position) : 3f);
                    if (s.radius < 0.1f) s.radius = 3f;
                    s.enabled = true;
                    b = s;
                    break;
                }
                case "wander": case "walk":
                {
                    var s = o.AddComponent<Wander>();
                    s.area = a.Num("radius", 15f);
                    b = s;
                    break;
                }
                case "follow":
                {
                    var s = o.AddComponent<Follow>();
                    s.target = FindOne(a.Get("follow") ?? a.Get("around"));
                    s.distance = a.Num("distance", 2f);
                    b = s;
                    break;
                }
                case "pulse": b = o.AddComponent<Pulse>(); break;
                case "rainbow": b = o.AddComponent<Rainbow>(); break;
                default: return;
            }
            b.speed = speed;
            // الحركات المبرمجة لا تجتمع مع الفيزياء
            if (!(b is Spin || b is Pulse || b is Rainbow) && o.TryGetComponent<Rigidbody>(out var rb)) rb.isKinematic = true;
        }

        void Explode(Dictionary<string, object> a)
        {
            var at = a.Vec("position") ?? Vector3.zero;
            float force = a.Num("force", 15f), radius = a.Num("radius", 10f);
            foreach (var o in objects.Where(o => o && Vector3.Distance(o.transform.position, at) <= radius).ToList())
            {
                if (o.GetComponent<TextMesh>()) continue;
                Body(o).AddExplosionForce(force, at, radius, 1f, ForceMode.VelocityChange);
            }
            var player = SimGame.Instance ? SimGame.Instance.Player : null;
            if (player && Vector3.Distance(player.transform.position, at) <= radius)
                player.Knock((player.transform.position - at).normalized * force + Vector3.up * force * 0.3f);
        }

        void CameraCmd(Dictionary<string, object> a)
        {
            var mode = (a.Str("mode") ?? "").ToLowerInvariant();
            if (mode == "2d" || mode == "3d") Set2D(mode == "2d");
            if (a.Has("size")) { cam.size2D = Mathf.Clamp(a.Num("size", 10), 2, 80); cam.distance = Mathf.Clamp(a.Num("size", 10) * 2.2f, 2, 150); }
            var look = a.Vec("lookAt") ?? FindOne(a.Get("lookAt"))?.position;
            if (a.Vec("position") is Vector3 p) cam.Place(p, look ?? cam.pivot);
            else if (look is Vector3 l) cam.pivot = l;
            if (a.Has("follow"))
            {
                var f = a.Str("follow");
                cam.follow = f == "none" || f == "" ? null : FindOne(f);
            }
        }

        void Set2D(bool on)
        {
            Is2D = on;
            var s = ground.transform.localScale;
            ground.transform.localScale = new Vector3(s.x, 1, on ? 4 : s.x);
            foreach (var rb in objects.Where(o => o).Select(o => o.GetComponent<Rigidbody>()).Where(r => r))
                rb.constraints = on ? RigidbodyConstraints.FreezePositionZ | RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationY : RigidbodyConstraints.None;
            if (on)
            {
                foreach (var o in objects.Where(o => o)) { var p = o.transform.position; Teleport(o.transform, new Vector3(p.x, p.y, 0)); }
                cam.pivot = new Vector3(cam.pivot.x, Mathf.Max(cam.pivot.y, 4f), 0);
            }
        }

        void Text(Dictionary<string, object> a, List<string> log)
        {
            objects.RemoveAll(o => !o);
            if (objects.Count >= MaxObjects) { log.Add("المشهد ممتلئ."); return; }
            var name = a.Str("name") ?? "text";
            var go = objects.FirstOrDefault(o => o.name == name && o.GetComponent<TextMesh>());
            if (!go)
            {
                go = new GameObject(Unique(name));
                go.transform.SetParent(root, true);
                go.AddComponent<SimTag>().shape = "text";
                var tm0 = go.AddComponent<TextMesh>();
                tm0.font = font;
                go.GetComponent<MeshRenderer>().sharedMaterial = font.material;
                tm0.anchor = TextAnchor.MiddleCenter;
                tm0.alignment = TextAlignment.Center;
                tm0.fontSize = 64;
                go.AddComponent<Billboard>();
                objects.Add(go);
            }
            var tm = go.GetComponent<TextMesh>();
            tm.text = string.Join("\n", (a.Str("text") ?? "").Split('\n').Select(ArabicText.Fix));
            tm.characterSize = 0.05f * a.Num("size", 1f);
            Paint(go, a.Str("color") ?? "white");
            var bb = go.GetComponent<Billboard>();
            bb.attach = FindOne(a.Get("attach"));
            if (bb.attach) bb.offset = new Vector3(0, bb.attach.localScale.y * 0.5f + 0.6f, 0);
            else go.transform.position = a.Vec("position") ?? new Vector3(0, 3, 0);
            lastSpawned = new List<GameObject> { go };
        }

        public void Clear()
        {
            foreach (var o in objects) if (o) Destroy(o);
            objects.Clear();
            lastSpawned.Clear();
            if (cam) cam.follow = null;
        }

        public void ResetWorld()
        {
            Clear();
            Set2D(false);
            Physics.gravity = new Vector3(0, -9.81f, 0);
            Time.timeScale = 1f;
            ground.SetActive(true);
            ground.transform.localScale = new Vector3(50, 1, 50);
            ground.GetComponent<Renderer>().material.color = new Color(0.36f, 0.55f, 0.33f);
            sun.intensity = 1f;
            sun.color = Color.white;
            sun.transform.rotation = Quaternion.Euler(sunDefaultEuler);
            var c = Camera.main;
            if (c) c.clearFlags = CameraClearFlags.Skybox;
            cam.ResetView();
            if (SimGame.Instance) SimGame.Instance.OnWorldReset();
        }

        /* ── الألوان (إنجليزي، عربي، #hex) ───────────────── */

        static readonly Dictionary<string, Color> Colors = new Dictionary<string, Color>(StringComparer.OrdinalIgnoreCase)
        {
            ["red"] = new Color(0.9f, 0.15f, 0.15f), ["green"] = new Color(0.2f, 0.75f, 0.25f), ["blue"] = new Color(0.15f, 0.4f, 0.95f),
            ["yellow"] = new Color(1f, 0.88f, 0.1f), ["orange"] = new Color(1f, 0.55f, 0.05f), ["purple"] = new Color(0.55f, 0.2f, 0.85f),
            ["pink"] = new Color(1f, 0.45f, 0.7f), ["white"] = Color.white, ["black"] = new Color(0.08f, 0.08f, 0.08f),
            ["gray"] = Color.gray, ["grey"] = Color.gray, ["brown"] = new Color(0.5f, 0.3f, 0.12f), ["cyan"] = Color.cyan,
            ["sky"] = new Color(0.5f, 0.78f, 1f), ["gold"] = new Color(1f, 0.78f, 0.2f), ["silver"] = new Color(0.78f, 0.78f, 0.8f),
            ["navy"] = new Color(0.05f, 0.1f, 0.4f), ["night"] = new Color(0.03f, 0.04f, 0.1f),
        };

        static readonly Dictionary<string, string> ArabicColors = new Dictionary<string, string>
        {
            ["احمر"] = "red", ["أحمر"] = "red", ["حمرا"] = "red", ["حمراء"] = "red",
            ["اخضر"] = "green", ["أخضر"] = "green", ["خضرا"] = "green",
            ["ازرق"] = "blue", ["أزرق"] = "blue", ["زرقا"] = "blue",
            ["اصفر"] = "yellow", ["أصفر"] = "yellow", ["صفرا"] = "yellow",
            ["برتقالي"] = "orange", ["بنفسجي"] = "purple", ["وردي"] = "pink", ["ابيض"] = "white", ["أبيض"] = "white",
            ["اسود"] = "black", ["أسود"] = "black", ["رمادي"] = "gray", ["رصاصي"] = "gray", ["بني"] = "brown", ["جوزي"] = "brown",
            ["سمائي"] = "sky", ["ذهبي"] = "gold", ["فضي"] = "silver", ["كحلي"] = "navy",
        };

        static string NormalizeColorName(string s)
        {
            s = (s ?? "").Trim();
            return ArabicColors.TryGetValue(s, out var en) ? en : s.ToLowerInvariant();
        }

        public static Color ParseColor(string s, out string name)
        {
            name = NormalizeColorName(s);
            if (string.IsNullOrEmpty(name)) { name = "white"; return new Color(0.92f, 0.92f, 0.92f); }
            if (name == "random") { name = ""; return Color.HSVToRGB(UnityEngine.Random.value, 0.75f, 0.95f); }
            if (Colors.TryGetValue(name, out var c)) return c;
            if (ColorUtility.TryParseHtmlString(name.StartsWith("#") || !IsHex(name) ? name : "#" + name, out c)) { name = ""; return c; }
            name = "";
            return Color.white;
        }

        static bool IsHex(string s) => s.Length == 6 && s.All(Uri.IsHexDigit);
    }
}
