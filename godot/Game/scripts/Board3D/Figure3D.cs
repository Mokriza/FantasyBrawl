using Godot;

namespace Brawl.Game;

/// <summary>
/// One hero on the 3D board: its class model with the class weapon, a ring in its side's
/// colour under its feet, and the animations the board asks for. It shows; it decides
/// nothing (where it stands and when it is hit come from the playback projection).
/// </summary>
public partial class Figure3D : Node3D
{
    private readonly HeroArt art;
    private readonly bool small;
    private Node3D? model;
    private AnimationPlayer? player;
    private MeshInstance3D? ring;
    private MeshInstance3D? activeRing;
    private string looping = "";
    private bool dead;

    /// <summary>Where the figure looks, as an angle round the vertical.</summary>
    public float Facing { get; set; }

    public Figure3D(HeroArt art, Color side, bool small)
    {
        this.art = art;
        this.small = small;
        sideColour = side;
    }

    private readonly Color sideColour;

    public override void _Ready()
    {
        float r = HexSpace.Radius * (small ? 0.5f : 0.68f);
        ring = new MeshInstance3D { Mesh = HexSpace.Circle(r, r - 0.09f), Position = new Vector3(0, 0.03f, 0), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        ring.MaterialOverride = HexSpace.Flat(sideColour, glow: true);
        AddChild(ring);
        activeRing = new MeshInstance3D { Mesh = HexSpace.Circle(r + 0.16f, r + 0.06f), Position = new Vector3(0, 0.03f, 0), Visible = false, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        activeRing.MaterialOverride = HexSpace.Flat(Palette.Active, glow: true);
        AddChild(activeRing);

        model = Art3D.Spawn(art.Model);
        if (model is null) return;
        AddChild(model);
        foreach (string name in art.Hide ?? [])
            if (model.FindChild(name, true, false) is Node3D hidden) hidden.Visible = false;
        if (art.Attach is { } weapon) Attach(weapon);
        if (Art3D.ParseTint(art.Tint) is { } tint) Art3D.Tint(model, tint);
        Normalise();

        player = model.FindChild("AnimationPlayer", true, false) as AnimationPlayer;
        Loop(art.Idle);
    }

    /// <summary>A separate weapon model in the right hand, for models that come empty-handed.</summary>
    private void Attach(string path)
    {
        if (model?.FindChild("Skeleton3D", true, false) is not Skeleton3D skeleton) return;
        if (Art3D.Spawn(path) is not { } weapon) return;
        var hand = new BoneAttachment3D { BoneName = "handslot.r" };
        skeleton.AddChild(hand);
        hand.AddChild(weapon);
    }

    /// <summary>Scales the model to the class's height on the board, whatever size it was made at.</summary>
    private void Normalise()
    {
        if (model is null) return;
        float top = 0;
        foreach (var node in model.FindChildren("*", "MeshInstance3D", true, false))
        {
            if (node is not MeshInstance3D mesh || !mesh.IsVisibleInTree()) continue;
            var box = mesh.GlobalTransform * mesh.GetAabb();
            top = Mathf.Max(top, box.End.Y - GlobalPosition.Y);
        }
        if (top > 0.01f) model.Scale = Vector3.One * (art.Height / top);
    }

    // --- animation -------------------------------------------------------------------------

    private bool Has(string name) => player?.HasAnimation(name) == true;

    /// <summary>A looping animation: standing, or running between hexes.</summary>
    private void Loop(string name)
    {
        if (player is null || dead || looping == name) return;
        if (!Has(name)) name = art.Idle;
        if (!Has(name)) name = "Idle";
        if (!Has(name)) return;
        player.GetAnimation(name).LoopMode = Animation.LoopModeEnum.Linear;
        player.Play(name, 0.15);
        player.SpeedScale = 1;
        looping = name;
    }

    /// <summary>Plays once, then goes back to standing.</summary>
    private void Once(string name, float speed = 1.4f)
    {
        if (player is null || dead || !Has(name)) return;
        player.GetAnimation(name).LoopMode = Animation.LoopModeEnum.None;
        player.Play(name, 0.08);
        player.SpeedScale = speed;
        looping = "";
    }

    public void Attack() => Once(art.Attack, 1.6f);
    public void Cast() => Once(art.Cast, 1.5f);
    public void Flinch() => Once(Art3D.Moves.Hit, 1.6f);

    public void Die()
    {
        if (dead || player is null) return;
        Once(Art3D.Moves.Death, 1.2f);
        dead = true;
    }

    public bool Dead => dead;

    /// <summary>Each frame: running or standing, the facing, the active marker.</summary>
    public void Pose(bool running, bool active, double now)
    {
        if (activeRing is not null)
        {
            activeRing.Visible = active && !dead;
            float pulse = 1 + 0.06f * Mathf.Sin((float)now / 160);
            activeRing.Scale = new Vector3(pulse, 1, pulse);
        }
        if (ring is not null) ring.Visible = !dead;
        Rotation = new Vector3(0, Facing, 0);
        if (dead || player is null) return;
        if (running) Loop(Art3D.Moves.Run);
        else if (looping == Art3D.Moves.Run || (!player.IsPlaying() && looping == "")) Loop(art.Idle);
    }
}
