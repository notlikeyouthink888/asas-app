using UnityEngine;

namespace AISim
{
    /// <summary>شخصية اللاعب: مشي بالنسبة لاتجاه الكاميرا، قفز، ودفع الأجسام الفيزيائية.</summary>
    [RequireComponent(typeof(CharacterController))]
    public class SimPlayer : MonoBehaviour
    {
        public float speed = 6f, jump = 7f;
        public Vector2 move;
        bool jumpQueued;
        float vy;
        Vector3 knock;
        CharacterController cc;

        public bool Falling => !cc.isGrounded && vy < 0;

        void Awake() => cc = GetComponent<CharacterController>();

        public void Jump() => jumpQueued = true;
        public void Bounce() => vy = jump * 0.8f;
        public void Knock(Vector3 v) => knock += v;

        public void Teleport(Vector3 p)
        {
            cc.enabled = false;
            transform.position = p;
            cc.enabled = true;
            vy = 0;
            knock = Vector3.zero;
        }

        void Update()
        {
            var cam = SimWorld.Instance ? SimWorld.Instance.Camera3D : null;
            Vector3 dir = SimWorld.Is2D || !cam
                ? new Vector3(move.x, 0, SimWorld.Is2D ? 0 : move.y)
                : Quaternion.Euler(0, cam.yaw, 0) * new Vector3(move.x, 0, move.y);
            dir = Vector3.ClampMagnitude(dir, 1f);

            if (cc.isGrounded && vy < 0) vy = -2f;
            if (jumpQueued && cc.isGrounded) vy = jump;
            jumpQueued = false;
            // الجاذبية نفسها التي يغيرها الذكاء الاصطناعي (قمر، انعدام وزن...)
            vy += Physics.gravity.y * Time.deltaTime;
            vy = Mathf.Max(vy, -40f);

            cc.Move((dir * speed + knock + Vector3.up * vy) * Time.deltaTime);
            knock = Vector3.Lerp(knock, Vector3.zero, 6f * Time.deltaTime);

            if (dir.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(dir), 12f * Time.deltaTime);
            if (SimWorld.Is2D && Mathf.Abs(transform.position.z) > 0.01f)
                Teleport(new Vector3(transform.position.x, transform.position.y, 0));
        }

        void OnControllerColliderHit(ControllerColliderHit hit)
        {
            var rb = hit.rigidbody;
            if (rb && !rb.isKinematic && hit.moveDirection.y > -0.3f)
                rb.AddForceAtPosition(hit.moveDirection * (speed * 0.4f), hit.point, ForceMode.VelocityChange);
        }
    }
}
