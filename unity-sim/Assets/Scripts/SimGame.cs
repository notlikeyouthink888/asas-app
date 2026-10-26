using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace AISim
{
    /// <summary>
    /// طبقة اللعبة: اللاعب، الصحة والنقاط، المهمة، الحوار مع الشخصيات، الواجهة،
    /// وأدوار الأجسام التي يضيفها الذكاء الاصطناعي (عملة، عدو، شخصية، بوابة، فخ).
    /// </summary>
    public class SimGame : MonoBehaviour
    {
        class Quest
        {
            public string title = "", kind = "collect", target = "";
            public int count = 1, progress, reward = 50;
            public bool done;
        }

        public static SimGame Instance { get; private set; }

        public SimPlayer Player { get; private set; }
        public bool Dead { get; private set; }
        public float health = 100, maxHealth = 100;
        public int score, coins, keys;
        public Vector3 spawn = new Vector3(0, 1.1f, -8);

        Quest quest;
        string banner = "";
        float bannerUntil, hurtFlash, invulnerable;
        Npc talking;
        int talkLine;
        readonly HashSet<KeyCode> held = new HashSet<KeyCode>();
        GUIStyle hud, hudR, bannerStyle, talkStyle, barBg, barFg, hurt;

        void Awake()
        {
            Instance = this;
            CreatePlayer();
        }

        void Start()
        {
            SimLevel.Load();
            StartCoroutine(Restart());
        }

        void CreatePlayer()
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            go.name = "player";
            Destroy(go.GetComponent<CapsuleCollider>());
            var cc = go.AddComponent<CharacterController>();
            cc.height = 2f;
            cc.radius = 0.45f;
            go.GetComponent<Renderer>().material.color = new Color(0.95f, 0.55f, 0.2f);
            var tag = go.AddComponent<SimTag>();
            tag.shape = "player";
            tag.role = "player";
            tag.color = new Color(0.95f, 0.55f, 0.2f);
            // عينان حتى يظهر اتجاه الشخصية
            foreach (var x in new[] { -0.18f, 0.18f })
            {
                var eye = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                Destroy(eye.GetComponent<Collider>());
                eye.transform.SetParent(go.transform, false);
                eye.transform.localPosition = new Vector3(x, 0.55f, 0.4f);
                eye.transform.localScale = Vector3.one * 0.18f;
                eye.GetComponent<Renderer>().material.color = Color.black;
            }
            Player = go.AddComponent<SimPlayer>();
            Player.Teleport(spawn);
        }

        /// <summary>يعيد بناء المرحلة كلها من التعديلات المحفوظة ويبدأ اللعب من جديد.</summary>
        public IEnumerator Restart()
        {
            var world = SimWorld.Instance;
            world.ResetWorld();
            spawn = new Vector3(0, 1.1f, -8);
            Player.speed = 6f;
            Player.jump = 7f;
            maxHealth = 100;
            var log = new List<string>();
            foreach (var batch in SimLevel.Batches.ToList()) yield return world.Run(batch, log, true);
            foreach (var l in log) Debug.LogWarning(l);
            score = coins = keys = 0;
            health = maxHealth;
            Dead = false;
            Player.Teleport(spawn);
        }

        /// <summary>يُستدعى من reset في العالم: تبقى الشخصية وتعود الكاميرا تلحقها.</summary>
        public void OnWorldReset()
        {
            quest = null;
            talking = null;
            if (!Player) return;
            Player.Teleport(spawn);
            SimWorld.Instance.Camera3D.follow = Player.transform;
        }

        /* ── أوامر الذكاء الاصطناعي الخاصة باللعبة ─────────── */

        static readonly Dictionary<string, string> RoleDefaults = new Dictionary<string, string>
        {
            ["coin"] = "{\"shape\":\"cylinder\",\"scale\":[0.7,0.06,0.7],\"rotation\":[90,0,0],\"color\":\"gold\",\"behavior\":\"spin\",\"position\":[0,1,0],\"spacing\":2}",
            ["gem"] = "{\"shape\":\"sphere\",\"scale\":0.5,\"color\":\"cyan\",\"behavior\":\"bounce\",\"height\":0.3,\"position\":[0,1,0],\"spacing\":2}",
            ["key"] = "{\"shape\":\"cube\",\"scale\":[0.25,0.6,0.1],\"color\":\"gold\",\"behavior\":\"spin\",\"position\":[0,1,0],\"spacing\":2}",
            ["health"] = "{\"shape\":\"cube\",\"scale\":0.5,\"color\":\"red\",\"behavior\":\"pulse\",\"position\":[0,0.8,0],\"spacing\":2}",
            ["enemy"] = "{\"shape\":\"sphere\",\"scale\":1,\"color\":\"green\",\"pattern\":\"random\"}",
            ["npc"] = "{\"shape\":\"capsule\",\"scale\":1,\"color\":\"blue\",\"position\":[3,1,0]}",
            ["goal"] = "{\"shape\":\"cylinder\",\"scale\":[2.5,0.1,2.5],\"rotation\":[90,0,0],\"color\":\"purple\",\"behavior\":\"pulse\",\"position\":[0,1.6,12]}",
            ["hazard"] = "{\"shape\":\"cube\",\"scale\":[4,0.1,4],\"color\":\"#ff4400\",\"position\":[0,0.05,0],\"damage\":20}",
        };

        public static string RoleOf(string type, Dictionary<string, object> a)
        {
            switch (type)
            {
                case "coin": case "coins": return "coin";
                case "collectible": case "item": case "pickup":
                    var k = (a.Str("kind") ?? "coin").ToLowerInvariant();
                    return RoleDefaults.ContainsKey(k) && k != "enemy" && k != "npc" && k != "goal" && k != "hazard" ? k : "coin";
                case "enemy": case "monster": return "enemy";
                case "npc": case "character": return "npc";
                case "goal": case "portal": case "finish": return "goal";
                case "hazard": case "trap": case "lava": case "spikes": return "hazard";
                default: return null;
            }
        }

        /// <summary>يكمل الحقول الناقصة بقيم مناسبة للدور (شكل العملة، لون العدو...).</summary>
        public static Dictionary<string, object> WithDefaults(string role, Dictionary<string, object> a)
        {
            var d = new Dictionary<string, object>(a, StringComparer.OrdinalIgnoreCase);
            if (RoleDefaults.TryGetValue(role, out var json) && MiniJson.Parse(json) is Dictionary<string, object> defs)
                foreach (var kv in defs)
                    if (!d.Has(kv.Key)) d[kv.Key] = kv.Value;
            if (!d.Has("name")) d["name"] = role;
            return d;
        }

        public void SetupRole(GameObject go, string role, Dictionary<string, object> a)
        {
            go.GetComponent<SimTag>().role = role;
            bool pickup = role == "coin" || role == "gem" || role == "key" || role == "health";
            if ((pickup || role == "goal") && go.TryGetComponent<Collider>(out var col)) col.isTrigger = true;
            if (pickup)
            {
                var c = go.AddComponent<Collectible>();
                c.kind = role;
                c.value = Mathf.Max(1, Mathf.RoundToInt(a.Num("value", role == "health" ? 25 : 1)));
            }
            else if (role == "enemy")
            {
                var e = go.AddComponent<Enemy>();
                e.speed = a.Num("speed", 2f);
                e.damage = a.Num("damage", 10f);
                e.health = Mathf.Max(1, a.Num("health", 2f));
                e.range = a.Num("range", 10f);
            }
            else if (role == "npc")
            {
                var n = go.AddComponent<Npc>();
                var lines = a.Get("dialogue") as List<object>;
                if (lines != null && lines.Count > 0) n.lines = lines.Select(x => Convert.ToString(x)).ToArray();
                else if (a.Str("dialogue") is string one) n.lines = new[] { one };
                n.SetTitle(a.Str("title") ?? go.name);
            }
            else if (role == "goal")
            {
                go.AddComponent<Goal>().message = a.Str("message") ?? "فزت!";
            }
            else if (role == "hazard")
            {
                go.AddComponent<Hazard>().damage = a.Num("damage", 20f);
            }
        }

        public void Command(string type, Dictionary<string, object> a, List<string> log)
        {
            switch (type)
            {
                case "player":
                    if (a.Vec("spawn") is Vector3 s) spawn = s;
                    if (a.Vec("position") is Vector3 p) Player.Teleport(p);
                    if (a.Has("speed")) Player.speed = Mathf.Clamp(a.Num("speed", 6), 0.5f, 40f);
                    if (a.Has("jump")) Player.jump = Mathf.Clamp(a.Num("jump", 7), 0f, 60f);
                    if (a.Has("maxHealth")) maxHealth = Mathf.Clamp(a.Num("maxHealth", 100), 1, 10000);
                    if (a.Has("health")) health = Mathf.Clamp(a.Num("health", 100), 1, maxHealth);
                    if (a.Has("color")) Player.GetComponent<Renderer>().material.color = SimWorld.ParseColor(a.Str("color"), out _);
                    if (a.Vec("scale") is Vector3 sc) Player.transform.localScale = sc;
                    break;
                case "quest":
                    if (a.Bool("clear") || a.Str("kind") == "none") { quest = null; break; }
                    quest = new Quest
                    {
                        title = a.Str("title") ?? "مهمة",
                        kind = (a.Str("kind") ?? "collect").ToLowerInvariant(),
                        target = a.Str("target") ?? "",
                        count = Mathf.Max(1, Mathf.RoundToInt(a.Num("count", 1))),
                        reward = Mathf.RoundToInt(a.Num("reward", 50)),
                    };
                    Show("مهمة جديدة: " + quest.title);
                    break;
                case "message": case "banner":
                    Show(a.Str("text") ?? "", a.Num("seconds", 4f));
                    break;
                case "score":
                    score += Mathf.RoundToInt(a.Num("add", 0));
                    if (a.Has("set")) score = Mathf.RoundToInt(a.Num("set"));
                    break;
                case "heal":
                    health = Mathf.Min(maxHealth, health + a.Num("amount", 25));
                    break;
            }
        }

        public object Describe()
        {
            var d = new Dictionary<string, object>
            {
                ["player"] = new List<object> { Math.Round(Player.transform.position.x, 1), Math.Round(Player.transform.position.y, 1), Math.Round(Player.transform.position.z, 1) },
                ["spawn"] = new List<object> { spawn.x, spawn.y, spawn.z },
                ["health"] = Mathf.RoundToInt(health) + "/" + Mathf.RoundToInt(maxHealth),
                ["score"] = score,
                ["coins"] = coins,
                ["keys"] = keys,
                ["playerSpeed"] = Player.speed,
                ["playerJump"] = Player.jump,
            };
            if (quest != null) d["quest"] = $"{quest.title} ({quest.kind} {quest.target} {quest.progress}/{quest.count}{(quest.done ? ", done" : "")})";
            return d;
        }

        /* ── أحداث اللعب ─────────────────────────────────── */

        public void Show(string text, float seconds = 3.5f)
        {
            banner = text;
            bannerUntil = Time.unscaledTime + seconds;
        }

        bool Matches(string target, GameObject go, string kind)
        {
            if (string.IsNullOrEmpty(target)) return true;
            return string.Equals(target, kind, StringComparison.OrdinalIgnoreCase)
                || go.name.StartsWith(target, StringComparison.OrdinalIgnoreCase);
        }

        void Progress(string kind, GameObject go, string subKind)
        {
            if (quest == null || quest.done || quest.kind != kind || !Matches(quest.target, go, subKind)) return;
            quest.progress++;
            if (quest.progress < quest.count) return;
            quest.done = true;
            score += quest.reward;
            Show($"أكملت المهمة: {quest.title} (+{quest.reward})", 5f);
        }

        public void OnCollect(Collectible c)
        {
            switch (c.kind)
            {
                case "health": health = Mathf.Min(maxHealth, health + c.value); break;
                case "key": keys += c.value; score += 5; break;
                case "gem": score += 5 * c.value; break;
                default: coins += c.value; score += c.value; break;
            }
            Progress("collect", c.gameObject, c.kind);
        }

        public void OnDefeat(Enemy e)
        {
            score += 10;
            Progress("defeat", e.gameObject, "enemy");
        }

        public void OnReach(Goal g)
        {
            if (quest != null && quest.kind == "reach") Progress("reach", g.gameObject, "goal");
            if (quest != null && !quest.done) { Show("كمّل المهمة أول: " + quest.title); return; }
            score += 100;
            Show(g.message, 6f);
        }

        public void Damage(float amount, Vector3 dir, bool flinch = true)
        {
            if (Dead || (flinch && invulnerable > 0)) return;
            health -= amount;
            if (flinch)
            {
                invulnerable = 0.6f;
                hurtFlash = 0.3f;
                Player.Knock(dir * 8f + Vector3.up * 2f);
            }
            if (health <= 0) StartCoroutine(Die());
        }

        IEnumerator Die()
        {
            Dead = true;
            health = 0;
            Show("خسرت! ترجع لنقطة البداية…", 2.5f);
            yield return new WaitForSecondsRealtime(2f);
            Player.Teleport(spawn);
            health = maxHealth;
            Dead = false;
        }

        void Attack()
        {
            var me = Player.transform;
            var enemies = SimWorld.Instance ? FindEnemies() : new List<Enemy>();
            foreach (var e in enemies)
            {
                var to = e.transform.position - me.position;
                float reach = 2.2f + e.transform.localScale.x * 0.5f;
                if (to.magnitude > reach) continue;
                if (to.magnitude > 1.3f && Vector3.Dot(me.forward, to.normalized) < 0.2f) continue;
                var push = to;
                push.y = 0;
                e.Hit(1f, push.normalized * 1.2f);
            }
            StartCoroutine(Swing());
        }

        static List<Enemy> FindEnemies()
        {
#if UNITY_2023_1_OR_NEWER
            return FindObjectsByType<Enemy>(FindObjectsSortMode.None).ToList();
#else
            return FindObjectsOfType<Enemy>().ToList();
#endif
        }

        IEnumerator Swing()
        {
            var t = Player.transform;
            var s = t.localScale;
            t.localScale = new Vector3(s.x * 1.25f, s.y * 0.9f, s.z * 1.25f);
            yield return new WaitForSeconds(0.1f);
            if (t) t.localScale = s;
        }

        Npc NearNpc()
        {
#if UNITY_2023_1_OR_NEWER
            var all = FindObjectsByType<Npc>(FindObjectsSortMode.None);
#else
            var all = FindObjectsOfType<Npc>();
#endif
            return all.Where(n => Vector3.Distance(n.transform.position, Player.transform.position) < 3f)
                .OrderBy(n => Vector3.Distance(n.transform.position, Player.transform.position)).FirstOrDefault();
        }

        void Talk()
        {
            var n = NearNpc();
            if (!n) { talking = null; return; }
            if (talking != n) { talking = n; talkLine = 0; }
            else talkLine++;
            if (talkLine >= n.lines.Length)
            {
                talking = null;
                Progress("talk", n.gameObject, "npc");
            }
        }

        /* ── الإدخال (لوحة المفاتيح عبر IMGUI حتى يعمل مع أي نظام إدخال) ── */

        void Update()
        {
            invulnerable -= Time.deltaTime;
            hurtFlash -= Time.unscaledDeltaTime;
            nearNpc = NearNpc();
            if (talking && Vector3.Distance(talking.transform.position, Player.transform.position) > 4f) talking = null;
            if (Player.transform.position.y < -25f) { Damage(25, Vector3.zero, false); if (!Dead) Player.Teleport(spawn); }

            float x = 0, y = 0;
            if (!Typing && !Dead)
            {
                if (held.Contains(KeyCode.A) || held.Contains(KeyCode.LeftArrow)) x -= 1;
                if (held.Contains(KeyCode.D) || held.Contains(KeyCode.RightArrow)) x += 1;
                if (held.Contains(KeyCode.W) || held.Contains(KeyCode.UpArrow)) y += 1;
                if (held.Contains(KeyCode.S) || held.Contains(KeyCode.DownArrow)) y -= 1;
            }
            Player.move = new Vector2(Mathf.Clamp(x + touchMove.x, -1, 1), Mathf.Clamp(y + touchMove.y, -1, 1));
            touchMove = Vector2.zero;
        }

        Vector2 touchMove;
        Npc nearNpc;
        // يُحدَّث داخل OnGUI فقط (دوال GUI لا تُستدعى من Update)
        bool Typing;

        void OnApplicationFocus(bool focus) { if (!focus) held.Clear(); }

        void Keys()
        {
            var e = Event.current;
            Typing = GUI.GetNameOfFocusedControl() == "input";
            if (Typing) { held.Clear(); return; }
            if (e.type == EventType.KeyDown && e.keyCode != KeyCode.None)
            {
                bool first = held.Add(e.keyCode);
                if (first && !Dead)
                {
                    if (e.keyCode == KeyCode.Space) Player.Jump();
                    if (e.keyCode == KeyCode.F || e.keyCode == KeyCode.J) Attack();
                    if (e.keyCode == KeyCode.E) Talk();
                }
            }
            else if (e.type == EventType.KeyUp) held.Remove(e.keyCode);
        }

        /* ── الواجهة ─────────────────────────────────────── */

        public static readonly List<Rect> ControlRects = new List<Rect>();

        void Styles()
        {
            if (hud != null) return;
            var font = Resources.Load<Font>("ArabicFont");
            hud = new GUIStyle(GUI.skin.label) { fontSize = 17, fontStyle = FontStyle.Bold };
            if (font) hud.font = font;
            hud.normal.textColor = Color.white;
            hudR = new GUIStyle(hud) { alignment = TextAnchor.UpperRight };
            bannerStyle = new GUIStyle(hud) { fontSize = 24, alignment = TextAnchor.MiddleCenter };
            bannerStyle.normal.background = Tex(new Color(0, 0, 0, 0.6f));
            talkStyle = new GUIStyle(hud) { fontSize = 19, alignment = TextAnchor.MiddleRight, padding = new RectOffset(16, 16, 10, 10) };
            talkStyle.normal.background = Tex(new Color(0.05f, 0.05f, 0.1f, 0.85f));
            barBg = new GUIStyle { normal = { background = Tex(new Color(0, 0, 0, 0.55f)) } };
            barFg = new GUIStyle { normal = { background = Tex(new Color(0.85f, 0.15f, 0.2f)) } };
            hurt = new GUIStyle { normal = { background = Tex(new Color(1, 0, 0, 0.25f)) } };
        }

        static Texture2D Tex(Color c)
        {
            var t = new Texture2D(1, 1);
            t.SetPixel(0, 0, c);
            t.Apply();
            return t;
        }

        void OnGUI()
        {
            Keys();
            Styles();
            float scale = SimChatUI.UiScale;
            GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1));
            float vw = Screen.width / scale, vh = Screen.height / scale;
            var panel = SimChatUI.Panel;
            float gameW = panel.width > 1 && panel.x > 1 ? panel.x : vw;
            float gameH = panel.width > 1 && panel.y > 1 ? panel.y : vh;
            GUI.depth = 1;

            if (hurtFlash > 0) GUI.Box(new Rect(0, 0, vw, vh), GUIContent.none, hurt);

            // الصحة والنقاط والمهمة
            GUI.Box(new Rect(10, 52, 200, 16), GUIContent.none, barBg);
            GUI.Box(new Rect(10, 52, 200 * Mathf.Clamp01(health / maxHealth), 16), GUIContent.none, barFg);
            GUI.Label(new Rect(10, 70, 330, 26), ArabicText.Fix($"النقاط {score}   العملات {coins}   المفاتيح {keys}"), hud);
            if (quest != null)
                GUI.Label(new Rect(10, 96, 360, 26), ArabicText.Fix($"{(quest.done ? "✓ " : "")}المهمة: {quest.title} ({Mathf.Min(quest.progress, quest.count)}/{quest.count})"), hud);

            if (Time.unscaledTime < bannerUntil && banner != "")
            {
                float w = Mathf.Min(gameW - 40, 620);
                GUI.Label(new Rect((gameW - w) / 2, 130, w, 48), ArabicText.Fix(banner), bannerStyle);
            }

            if (talking)
            {
                float w = Mathf.Min(gameW - 40, 640);
                var line = talking.lines[Mathf.Clamp(talkLine, 0, talking.lines.Length - 1)];
                var lines = ArabicText.Wrap($"{talking.title}: {line}", talkStyle, w - 40);
                GUI.Label(new Rect((gameW - w) / 2, gameH - 150, w, 40 + 22 * lines.Count), string.Join("\n", lines) + "\n" + ArabicText.Fix("(E للتكملة)"), talkStyle);
            }
            else if (nearNpc)
            {
                GUI.Label(new Rect(gameW / 2 - 120, gameH - 120, 240, 30), ArabicText.Fix($"E: كلّم {nearNpc.title}"), bannerStyle);
            }

            ControlRects.Clear();
            if (Application.isMobilePlatform) TouchControls(gameW, gameH);
            else GUI.Label(new Rect(10, gameH - 30, 640, 26), ArabicText.Fix("WASD/الأسهم: حركة   Space: قفز   F: ضرب   E: كلام   Enter: اكتب للذكاء الاصطناعي"), hud);
        }

        void TouchControls(float w, float h)
        {
            const float s = 64;
            var left = new Rect(20, h - s * 2 - 20, s, s);
            var right = new Rect(20 + s * 2, h - s * 2 - 20, s, s);
            var up = new Rect(20 + s, h - s * 3 - 20, s, s);
            var down = new Rect(20 + s, h - s - 20, s, s);
            if (GUI.RepeatButton(left, "◀")) touchMove.x = -1;
            if (GUI.RepeatButton(right, "▶")) touchMove.x = 1;
            if (GUI.RepeatButton(up, "▲")) touchMove.y = 1;
            if (GUI.RepeatButton(down, "▼")) touchMove.y = -1;
            var jump = new Rect(w - s * 1.5f - 20, h - s * 1.5f - 20, s * 1.5f, s * 1.5f);
            var hit = new Rect(w - s * 3f - 30, h - s - 20, s, s);
            var talk = new Rect(w - s * 3f - 30, h - s * 2 - 30, s, s);
            if (GUI.Button(jump, ArabicText.Fix("قفز")) && !Dead) Player.Jump();
            if (GUI.Button(hit, ArabicText.Fix("ضرب")) && !Dead) Attack();
            if (GUI.Button(talk, ArabicText.Fix("كلام"))) Talk();
            ControlRects.AddRange(new[] { left, right, up, down, jump, hit, talk });
        }
    }
}
