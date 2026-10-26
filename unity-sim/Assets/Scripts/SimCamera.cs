using UnityEngine;

namespace AISim
{
    /// <summary>
    /// كاميرا تدور حول نقطة (3D) أو منظور جانبي مسطح (2D).
    /// السحب والتكبير يأتيان من واجهة IMGUI حتى تعمل مع أي نظام إدخال.
    /// </summary>
    public class SimCamera : MonoBehaviour
    {
        public Vector3 pivot = Vector3.zero;
        public float distance = 12f, yaw = 0f, pitch = 25f, size2D = 10f;
        public Transform follow;
        Camera cam;

        public static readonly Vector3 DefaultPivot = new Vector3(0, 1, 0);

        void Awake() => cam = GetComponent<Camera>();

        public void ResetView()
        {
            pivot = DefaultPivot;
            distance = 12f;
            yaw = 0f;
            pitch = 25f;
            size2D = 10f;
            // في اللعبة تلحق الكاميرا الشخصية
            follow = SimGame.Instance && SimGame.Instance.Player ? SimGame.Instance.Player.transform : null;
        }

        public void Drag(Vector2 delta)
        {
            if (SimWorld.Is2D)
            {
                pivot -= new Vector3(delta.x, -delta.y, 0) * (size2D * 0.004f);
                return;
            }
            yaw += delta.x * 0.3f;
            pitch = Mathf.Clamp(pitch + delta.y * 0.3f, -5f, 89f);
        }

        public void Zoom(float amount)
        {
            if (SimWorld.Is2D) size2D = Mathf.Clamp(size2D * (1f + amount * 0.05f), 2f, 80f);
            else distance = Mathf.Clamp(distance * (1f + amount * 0.05f), 2f, 150f);
        }

        /// <summary>يضع الكاميرا في موضع وينظر إلى نقطة (يحسب الدوران والمسافة منهما).</summary>
        public void Place(Vector3 position, Vector3 lookAt)
        {
            pivot = lookAt;
            var d = position - lookAt;
            if (SimWorld.Is2D) { pivot = new Vector3(position.x, position.y, 0); return; }
            distance = Mathf.Max(1f, d.magnitude);
            yaw = Mathf.Atan2(-d.x, -d.z) * Mathf.Rad2Deg;
            pitch = Mathf.Asin(Mathf.Clamp(d.y / distance, -1f, 1f)) * Mathf.Rad2Deg;
        }

        void LateUpdate()
        {
            if (!cam) cam = GetComponent<Camera>();
            if (follow) pivot = Vector3.Lerp(pivot, follow.position, 0.15f);
            if (SimWorld.Is2D)
            {
                cam.orthographic = true;
                cam.orthographicSize = size2D;
                transform.SetPositionAndRotation(new Vector3(pivot.x, pivot.y, -50f), Quaternion.identity);
                return;
            }
            cam.orthographic = false;
            var rot = Quaternion.Euler(pitch, yaw, 0);
            transform.SetPositionAndRotation(pivot - rot * Vector3.forward * distance, rot);
        }
    }
}
