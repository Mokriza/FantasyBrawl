using Godot;

namespace Brawl.Game;

/// <summary>
/// The battle's sounds: the web game's recordings (vfx.json "sounds", copied to
/// res://content/sounds), each loaded once. The web synthesises the plain sounds (a
/// step, a hit, a crit, thunder…); here board3d.json's "sounds" says which recording
/// stands in for each, at what pitch. A name nothing knows is silence.
/// </summary>
public partial class Sounds : Node
{
    private const int Voices = 10;
    private readonly List<AudioStreamPlayer> players = [];
    private readonly Dictionary<string, AudioStreamWav?> loaded = [];
    private int next;

    /// <summary>Whether sound is on; the battle screen's button switches it.</summary>
    public static bool Enabled { get; set; } = true;

    public override void _Ready()
    {
        for (int i = 0; i < Voices; i++)
        {
            var player = new AudioStreamPlayer();
            AddChild(player);
            players.Add(player);
        }
    }

    private AudioStreamWav? Recording(string url)
    {
        if (loaded.TryGetValue(url, out var stream)) return stream;
        string path = "res://content/sounds/" + url[(url.LastIndexOf('/') + 1)..];
        stream = Godot.FileAccess.FileExists(path) ? AudioStreamWav.LoadFromBuffer(Godot.FileAccess.GetFileAsBytes(path)) : null;
        loaded[url] = stream;
        return stream;
    }

    public void Play(string name)
    {
        if (!Enabled) return;
        float pitch = 1, volume = 1;
        var info = Vfx.Sound(name);
        if (info is null && Art3D.Sound(name) is { } stand)
        {
            info = Vfx.Sound(stand.Use);
            pitch = stand.Pitch;
            volume = stand.Volume;
        }
        if (info is null || Recording(info.Url) is not { } stream) return;
        var player = players[next];
        next = (next + 1) % players.Count;
        player.Stream = stream;
        player.PitchScale = pitch;
        player.VolumeDb = Mathf.LinearToDb((float)info.Volume * volume);
        player.Play();
    }
}
