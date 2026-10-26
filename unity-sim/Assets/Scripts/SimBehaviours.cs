using UnityEngine;

namespace AISim
{
    /// <summary>بيانات كل جسم أنشأه الذكاء الاصطناعي (لوصف العالم له في كل رسالة).</summary>
    public class SimTag : MonoBehaviour
    {
        public string shape = "cube";
        public string colorName = "";
        public string role = "";
        public Color color = Color.white;
    }

    public abstract class SimBehaviour : MonoBehaviour
    {
        public float speed = 1f;
        public abstract string Kind { get; }
    }

    public class Spin : SimBehaviour
    {
        public Vector3 axis = Vector3.up;
        public override string Kind => "spin";
        void Update() => transform.Rotate(axis.normalized * (90f * speed * Time.deltaTime), Space.World);
    }

    public class Bounce : SimBehaviour
    {
        public float height = 1f;
        float baseY, t;
        public override string Kind => "bounce";
        void OnEnable() => baseY = transform.position.y;
        public void Rebase() => baseY = transform.position.y;
        void Update()
        {
            t += Time.deltaTime * speed * 3f;
            var p = transform.position;
            p.y = baseY + Mathf.Abs(Mathf.Sin(t)) * height;
            transform.position = p;
        }
    }

    public class Orbit : SimBehaviour
    {
        public Transform center;
        public Vector3 point;
        public float radius = 3f;
        float angle;
        public override string Kind => "orbit";
        void OnEnable()
        {
            var c = center ? center.position : point;
            var d = transform.position - c;
            angle = Mathf.Atan2(d.z, d.x);
        }
        void Update()
        {
            var c = center ? center.position : point;
            angle += speed * Time.deltaTime;
            var p = transform.position;
            transform.position = new Vector3(c.x + Mathf.Cos(angle) * radius, SimWorld.Is2D ? c.y + Mathf.Sin(angle) * radius : p.y,
                SimWorld.Is2D ? p.z : c.z + Mathf.Sin(angle) * radius);
        }
    }

    public class Wander : SimBehaviour
    {
        public float area = 15f;
        Vector3 goal;
        public override string Kind => "wander";
        void OnEnable() => Pick();
        void Pick()
        {
            var r = Random.insideUnitCircle * area;
            goal = SimWorld.Is2D ? new Vector3(r.x, Mathf.Abs(r.y) * 0.3f + transform.localScale.y * 0.5f, 0) : new Vector3(r.x, transform.position.y, r.y);
        }
        void Update()
        {
            var to = goal - transform.position;
            if (!SimWorld.Is2D) to.y = 0;
            if (to.magnitude < 0.3f) { Pick(); return; }
            var step = to.normalized * (2.5f * speed * Time.deltaTime);
            transform.position += step;
            if (!SimWorld.Is2D && step.sqrMagnitude > 0) transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(step), 0.1f);
        }
    }

    public class Follow : SimBehaviour
    {
        public Transform target;
        public float distance = 2f;
        public override string Kind => "follow";
        void Update()
        {
            if (!target) return;
            var to = target.position - transform.position;
            if (to.magnitude <= distance) return;
            transform.position += to.normalized * (3f * speed * Time.deltaTime);
        }
    }

    public class Pulse : SimBehaviour
    {
        Vector3 baseScale;
        float t;
        public override string Kind => "pulse";
        void OnEnable() => baseScale = transform.localScale;
        void OnDisable() => transform.localScale = baseScale;
        public void Rebase() => baseScale = transform.localScale;
        void Update()
        {
            t += Time.deltaTime * speed * 4f;
            transform.localScale = baseScale * (1f + Mathf.Sin(t) * 0.2f);
        }
    }

    public class Rainbow : SimBehaviour
    {
        Renderer r;
        float h;
        public override string Kind => "rainbow";
        void OnEnable() { r = GetComponent<Renderer>(); h = Random.value; }
        void Update()
        {
            if (!r) return;
            h = (h + Time.deltaTime * 0.2f * speed) % 1f;
            r.material.color = Color.HSVToRGB(h, 0.8f, 1f);
        }
    }

    /// <summary>النص يواجه الكاميرا دائمًا، ويتبع جسمًا إن رُبط به.</summary>
    public class Billboard : MonoBehaviour
    {
        public Transform attach;
        public Vector3 offset = new Vector3(0, 1.2f, 0);
        void LateUpdate()
        {
            if (attach) transform.position = attach.position + offset;
            var cam = Camera.main;
            if (cam) transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);
        }
    }
}
