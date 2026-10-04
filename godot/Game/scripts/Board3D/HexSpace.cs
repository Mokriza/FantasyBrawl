using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// Hexes in 3D: the same flat-topped axial layout as the 2D board and the web, laid on
/// the ground plane (x, z) at the size of the tile model. Up is +y.
/// </summary>
public static class HexSpace
{
    private static readonly float Sqrt3 = Mathf.Sqrt(3);

    /// <summary>Centre to corner, in world units: the tile model's own size.</summary>
    public static float Radius => Art3D.Tile.Radius;

    public static Vector3 Centre(Hex h, float y = 0) =>
        new(Radius * 1.5f * h.Q, y, Radius * Sqrt3 * (h.R + h.Q / 2f));

    /// <summary>The hex under a point of the ground plane.</summary>
    public static Hex At(Vector3 p)
    {
        double q = 2.0 / 3 * p.X / Radius;
        double r = (-1.0 / 3 * p.X + Math.Sqrt(3) / 3 * p.Z) / Radius;
        double s = -q - r;
        double rq = Math.Round(q), rr = Math.Round(r), rs = Math.Round(s);
        double dq = Math.Abs(rq - q), dr = Math.Abs(rr - r), ds = Math.Abs(rs - s);
        if (dq > dr && dq > ds) rq = -rr - rs;
        else if (dr > ds) rr = -rq - rs;
        return new Hex((int)rq, (int)rr);
    }

    /// <summary>A whole number from a hex, the same every time: which variant of a model stands there.</summary>
    public static int Pick(Hex h, int salt = 0)
    {
        unchecked
        {
            uint x = (uint)(h.Q * 73856093) ^ (uint)(h.R * 19349663) ^ (uint)(salt * 83492791);
            x ^= x >> 13;
            x *= 0x5bd1e995;
            x ^= x >> 15;
            return (int)(x & 0x7fffffff);
        }
    }

    private static Vector3 Corner(int i, float radius) =>
        new(Mathf.Cos(Mathf.DegToRad(60 * i)) * radius, 0, Mathf.Sin(Mathf.DegToRad(60 * i)) * radius);

    /// <summary>A flat hexagon lying on the ground, centred on the origin.</summary>
    public static ArrayMesh Plate(float radius)
    {
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        st.SetNormal(Vector3.Up);
        for (int i = 0; i < 6; i++)
        {
            st.AddVertex(Vector3.Zero);
            st.AddVertex(Corner(i + 1, radius));
            st.AddVertex(Corner(i, radius));
        }
        return st.Commit();
    }

    /// <summary>A flat hexagonal ring: the outline of a hex.</summary>
    public static ArrayMesh Ring(float outer, float inner)
    {
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        st.SetNormal(Vector3.Up);
        for (int i = 0; i < 6; i++)
        {
            Vector3 o0 = Corner(i, outer), o1 = Corner(i + 1, outer), i0 = Corner(i, inner), i1 = Corner(i + 1, inner);
            st.AddVertex(o0); st.AddVertex(i1); st.AddVertex(o1);
            st.AddVertex(o0); st.AddVertex(i0); st.AddVertex(i1);
        }
        return st.Commit();
    }

    /// <summary>A round ring lying on the ground, such as the circle under a hero's feet.</summary>
    public static ArrayMesh Circle(float outer, float inner, int segments = 40)
    {
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        st.SetNormal(Vector3.Up);
        for (int i = 0; i < segments; i++)
        {
            float a0 = Mathf.Tau * i / segments, a1 = Mathf.Tau * (i + 1) / segments;
            var o0 = new Vector3(Mathf.Cos(a0) * outer, 0, Mathf.Sin(a0) * outer);
            var o1 = new Vector3(Mathf.Cos(a1) * outer, 0, Mathf.Sin(a1) * outer);
            var i0 = new Vector3(Mathf.Cos(a0) * inner, 0, Mathf.Sin(a0) * inner);
            var i1 = new Vector3(Mathf.Cos(a1) * inner, 0, Mathf.Sin(a1) * inner);
            st.AddVertex(o0); st.AddVertex(i1); st.AddVertex(o1);
            st.AddVertex(o0); st.AddVertex(i0); st.AddVertex(i1);
        }
        return st.Commit();
    }

    /// <summary>A material that ignores light: for marks painted on the board.</summary>
    public static StandardMaterial3D Flat(Color colour, bool glow = false) => new()
    {
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        AlbedoColor = colour,
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        CullMode = BaseMaterial3D.CullModeEnum.Disabled,
        EmissionEnabled = glow,
        Emission = colour,
    };
}
