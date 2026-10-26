using UnityEngine;

namespace AISim
{
    /// <summary>عملة، جوهرة، مفتاح، أو صحة: تُجمع حين يقترب اللاعب.</summary>
    public class Collectible : MonoBehaviour
    {
        public string kind = "coin";
        public int value = 1;

        void Update()
        {
            var g = SimGame.Instance;
            if (!g || !g.Player) return;
            float reach = 1f + transform.localScale.magnitude * 0.3f;
            if (Vector3.Distance(g.Player.transform.position, transform.position) > reach) return;
            g.OnCollect(this);
            Destroy(gameObject);
        }
    }

    /// <summary>عدو يلاحق اللاعب ويؤذيه. يُهزم بالضرب (F) أو بالقفز فوقه.</summary>
    public class Enemy : MonoBehaviour
    {
        public float speed = 2f, damage = 10f, health = 2f, range = 10f;
        float cooldown;
        Vector3 home;
        Renderer rend;
        Color baseColor;

        void Start()
        {
            home = transform.position;
            rend = GetComponent<Renderer>();
            if (rend) baseColor = rend.material.color;
        }

        void Update()
        {
            var g = SimGame.Instance;
            if (!g || !g.Player || g.Dead) return;
            var p = g.Player.transform.position;
            var to = p - transform.position;
            to.y = 0;
            if (SimWorld.Is2D) to.z = 0;
            float d = to.magnitude;

            Vector3 goal = d < range ? p : home;
            var step = goal - transform.position;
            step.y = 0;
            if (SimWorld.Is2D) step.z = 0;
            if (step.magnitude > 0.6f)
            {
                transform.position += step.normalized * (speed * Time.deltaTime);
                if (!SimWorld.Is2D) transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(step), 0.1f);
            }

            cooldown -= Time.deltaTime;
            float reach = transform.localScale.x * 0.5f + 0.7f;
            if (cooldown > 0 || d > reach || Mathf.Abs(p.y - transform.position.y) > transform.localScale.y * 0.5f + 1.3f) return;
            cooldown = 0.8f;
            bool stomp = g.Player.Falling && p.y > transform.position.y + transform.localScale.y * 0.3f;
            if (stomp)
            {
                g.Player.Bounce();
                Hit(1f, Vector3.zero);
            }
            else g.Damage(damage, to.normalized);
        }

        public void Hit(float dmg, Vector3 push)
        {
            health -= dmg;
            transform.position += push;
            if (rend) { rend.material.color = Color.white; Invoke(nameof(Unflash), 0.12f); }
            if (health > 0) return;
            SimGame.Instance.OnDefeat(this);
            Destroy(gameObject);
        }

        void Unflash() { if (rend) rend.material.color = baseColor; }
    }

    /// <summary>شخصية تتكلم حين يضغط اللاعب E قربها.</summary>
    public class Npc : MonoBehaviour
    {
        public string title = "";
        public string[] lines = { "هلا بيك!" };
        TextMesh label;

        public void SetTitle(string t)
        {
            title = t;
            if (!label)
            {
                var go = new GameObject("label");
                go.transform.SetParent(transform, false);
                label = go.AddComponent<TextMesh>();
                var font = SimWorld.Instance.Font;
                label.font = font;
                go.GetComponent<MeshRenderer>().sharedMaterial = font.material;
                label.anchor = TextAnchor.MiddleCenter;
                label.alignment = TextAlignment.Center;
                label.fontSize = 64;
                label.characterSize = 0.04f;
                label.color = Color.yellow;
                go.AddComponent<Billboard>().attach = transform;
            }
            label.GetComponent<Billboard>().offset = new Vector3(0, transform.localScale.y + 0.6f, 0);
            label.text = ArabicText.Fix(string.IsNullOrEmpty(t) ? name : t);
        }
    }

    /// <summary>بوابة أو هدف: الوصول إليه يربح المرحلة (أو يكمل مهمة «reach»).</summary>
    public class Goal : MonoBehaviour
    {
        public string message = "فزت!";
        float cooldown;

        void Update()
        {
            var g = SimGame.Instance;
            cooldown -= Time.deltaTime;
            if (!g || !g.Player || cooldown > 0) return;
            float reach = Mathf.Max(transform.localScale.x, transform.localScale.z) * 0.5f + 1f;
            if (Vector3.Distance(g.Player.transform.position, transform.position) > reach) return;
            cooldown = 2f;
            g.OnReach(this);
        }
    }

    /// <summary>حمم، أشواك، فخ: يؤذي اللاعب ما دام فوقه.</summary>
    public class Hazard : MonoBehaviour
    {
        public float damage = 20f;

        void Update()
        {
            var g = SimGame.Instance;
            if (!g || !g.Player || !TryGetComponent<Renderer>(out var r)) return;
            var b = r.bounds;
            b.Expand(new Vector3(0.3f, 1.2f, 0.3f));
            var p = g.Player.transform.position + Vector3.down * 0.9f;
            if (b.Contains(p)) g.Damage(damage * Time.deltaTime, Vector3.zero, false);
        }
    }
}
