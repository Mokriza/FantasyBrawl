using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>Colours, the same as src/ui/theme.ts: the player's team blue, the opponent red.</summary>
public static class Palette
{
    private static Color Hex(uint rgb) => Color.FromHtml($"#{rgb:x6}");

    public static readonly Color Background = Hex(0x14161c);
    public static readonly Color Panel = Hex(0x1c1f28);
    public static readonly Color PanelBorder = Hex(0x2b3040);
    public static readonly Color Text = Hex(0xe6e8ef);
    public static readonly Color TextDim = Hex(0x8b91a5);
    public static readonly Color TextSoft = Hex(0xc9cddb);

    public static readonly Color HexFill = Hex(0x252a36);
    public static readonly Color HexFillAlt = Hex(0x2a2f3d);
    public static readonly Color HexLine = Hex(0x3a4152);
    public static readonly Color HexHover = Hex(0xd8dcea);
    public static readonly Color Reach = Hex(0x30536e);
    public static readonly Color Range = Hex(0x3f86c0);
    public static readonly Color Reachable = Hex(0x2f6f4f);
    public static readonly Color Path = Hex(0x4bbd7f);
    public static readonly Color Zone = Hex(0xd05a4a);
    public static readonly Color ZoneAlly = Hex(0x4a9fd0);
    public static readonly Color Illegal = Hex(0x7a2b2b);

    public static readonly Color Rock = Hex(0x6a7085);
    public static readonly Color Thicket = Hex(0x2e6b40);
    public static readonly Color Column = Hex(0xc9c2ae);
    public static readonly Color Collapse = Hex(0x2a0f0f);
    public static readonly Color High = Hex(0xd9b25f);
    public static readonly Color Pit = Hex(0x05070a);
    public static readonly Color Ice = Hex(0xbfe6f5);
    public static readonly Color Smoke = new(Hex(0x9aa0ab), 0.55f);
    public static readonly Color Trap = Hex(0xb8a27a);

    public static readonly Color Ours = Hex(0x5aa9f0);
    public static readonly Color Theirs = Hex(0xf0705a);
    public static readonly Color Neutral = Hex(0xd9b25f);
    public static readonly Color PowerPoint = Hex(0xf0c04a);
    public static readonly Color Active = Hex(0xf0c04a);
    public static readonly Color HpGood = Hex(0x4bbd7f);
    public static readonly Color HpLow = Hex(0xd4674a);
    public static readonly Color Shield = Hex(0xbfe3ff);
    public static readonly Color Death = Hex(0x8a8f9c);

    private static readonly Dictionary<string, Color> ClassColors = new()
    {
        ["warrior"] = Hex(0xe05a4a),
        ["paladin"] = Hex(0xf0c53a),
        ["hunter"] = Hex(0x54c96a),
        ["mage"] = Hex(0x4aa3f0),
        ["priest"] = Hex(0xf2f5fa),
        ["warlock"] = Hex(0xb46ae0),
        ["rogue"] = Hex(0x8fa3b5),
        ["monk"] = Hex(0xe67e22),
        ["imp"] = Hex(0xd9483b),
    };

    public static Color ClassColor(string id) => ClassColors.TryGetValue(id, out var c) ? c : Hex(0x888888);

    public static Color SideColor(Side side, Side player) => side == Side.N ? Neutral : side == player ? Ours : Theirs;

    public static Color FloatColor(FloatKind kind) => kind switch
    {
        FloatKind.Damage => Hex(0xffd7cf),
        FloatKind.Crit => Hex(0xffc24a),
        FloatKind.Heal => Hex(0x7ff0ae),
        FloatKind.Block => Hex(0x9fd0ff),
        _ => Hex(0xd7b8ff),
    };

    public static Color EffectColor(EffectTone tone) => tone switch
    {
        EffectTone.Physical => Hex(0xffe2b8),
        EffectTone.Magic => Hex(0xa98bff),
        EffectTone.Pure => Hex(0xfff1a8),
        EffectTone.Heal => Hex(0x7ff0ae),
        _ => Hex(0x6fd3ff),
    };

    public static Color ImpactColor(EffectTone tone) => tone switch
    {
        EffectTone.Physical => Hex(0xff6a4a),
        EffectTone.Magic => Hex(0xb07bff),
        EffectTone.Pure => Hex(0xffe27a),
        EffectTone.Heal => Hex(0x7ff0ae),
        _ => Hex(0x6fd3ff),
    };

    /// <summary>A flat dark panel with a thin border, as in the web version.</summary>
    public static StyleBoxFlat PanelStyle(Color? border = null)
    {
        var style = new StyleBoxFlat
        {
            BgColor = Panel,
            BorderColor = border ?? PanelBorder,
            CornerRadiusTopLeft = 8,
            CornerRadiusTopRight = 8,
            CornerRadiusBottomLeft = 8,
            CornerRadiusBottomRight = 8,
            ContentMarginLeft = 10,
            ContentMarginRight = 10,
            ContentMarginTop = 8,
            ContentMarginBottom = 8,
        };
        style.SetBorderWidthAll(border is null ? 1 : 2);
        return style;
    }
}
