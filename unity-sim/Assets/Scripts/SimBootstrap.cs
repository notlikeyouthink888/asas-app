using UnityEngine;

namespace AISim
{
    /// <summary>يبني المحاكاة تلقائيًا عند الضغط على Play في أي مشهد (حتى المشهد الفارغ).</summary>
    public static class SimBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (SimWorld.Instance) return;
            var go = new GameObject("AI Simulation");
            go.AddComponent<SimWorld>();
            go.AddComponent<SimChatUI>();
            Application.targetFrameRate = 60;
        }
    }
}
