using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

namespace AISim.EditorTools
{
    /// <summary>أول فتح للمشروع: ينشئ مشهد Assets/Scenes/AISim.unity ويضيفه للبناء ويفتحه.</summary>
    [InitializeOnLoad]
    static class SimSetup
    {
        const string ScenePath = "Assets/Scenes/AISim.unity";

        static SimSetup() => EditorApplication.delayCall += () => { if (!File.Exists(ScenePath)) CreateScene(); };

        [MenuItem("AI Sim/Create Scene")]
        static void CreateScene()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            Directory.CreateDirectory("Assets/Scenes");
            if (!File.Exists(ScenePath))
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, ScenePath);
            }
            else EditorSceneManager.OpenScene(ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }
    }
}
