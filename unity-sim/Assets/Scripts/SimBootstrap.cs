using UnityEngine;

namespace AISim
{
    /// <summary>يبني اللعبة تلقائيًا عند الضغط على Play في أي مشهد (حتى المشهد الفارغ).</summary>
    public static class SimBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (SimWorld.Instance) return;
            var go = new GameObject("AI Adventure");
            go.AddComponent<SimWorld>();
            go.AddComponent<SimGame>();
            go.AddComponent<SimChatUI>();
            Application.targetFrameRate = 60;
        }
    }
}
