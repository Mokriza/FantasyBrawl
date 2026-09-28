using Godot;

namespace Brawl.Game;

/// <summary>The first screen. For now it only proves the content loads through the C# core.</summary>
public partial class Main : Control
{
    public override void _Ready()
    {
        var content = GameContent.Registry;
        var label = new Label
        {
            Text = $"Арена 3v3 — Godot\nКонтент загружен: {content.Classes.Count} классов, {content.Abilities.Count} способностей, {GameContent.Teams.Heroes.Count} героев быстрого боя",
            Position = new Vector2(40, 40),
        };
        AddChild(label);
        GD.Print(label.Text);
    }
}
