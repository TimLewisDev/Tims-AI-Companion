using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Xml.Linq;

namespace TtCompanion
{
    // What Tatty looks like: the avatar chosen in the shop, in what he wears. The page in
    // the bubble works it out (avatar.js's bake: the browser has the cascade, so every
    // colour, stroke and visibility comes already resolved) and sends it as a small
    // description, laid out in the window's own moving parts:
    //
    //   <tatty av="cat"><part name="Root" c="52,100">
    //     <part name="Body" c=..>the back accessories</part>  (they ride with the body, behind the legs)
    //     <part name="LegL" c=..>..</part> <part name="LegR" c=..>..</part>
    //     <part name="Body" c=..> .. <eyes c=..> .. <pupils>..</pupils> .. </eyes> .. <mouth name="neutral">..</mouth>
    //        <numtag text="x,y" size=.. fill=..>..</numtag> <badge at="x,y"/> <g p="Tail" c=..>..</g> .. </part>
    //   </part><defs>gradients</defs></tatty>
    //
    // After the parts the description carries what he does while a session works: <props> (a <prop state=
    // layer=> group of drawing for each state's thought bubble, magnifier, notepad ...) and <states> (a <state
    // id= dur= mouth= lids= bob=> with its <track p="Part.prop" k= ..>s): see Props, States and Avatar.SetState.
    //
    // Shapes are SVG's path, circle, ellipse, rect, line and polygon, each drawn as a WPF
    // Path in the drawing's own coordinates. TattyWindow.Apply puts the parts into the
    // canvases TattyWindow.xaml names, so Avatar.cs moves them as it always has; the
    // parts of an avatar's own that move (a tail, wings, a propeller) get a little idle
    // motion of their own here (Idle). The project number's badge (numtag) may be in Body or in a
    // leg; the window writes the number itself, where and how the badge says.
    internal sealed class AvatarArt
    {
        public string Id = "";
        public Point Root = new(52, 100), LegLPivot = new(38, 80), LegRPivot = new(66, 80), BodyPivot = new(52, 90);
        public Point EyesPivot = new(52, 48), BadgeAt = new(85, 23);
        public Point? NumberAt;      // where the project number's baseline sits, at its middle
        public double? NumberSize;
        public Brush? NumberPaint;
        public readonly List<UIElement> Back = new(), LegL = new(), LegR = new(), Body = new();
        public readonly List<UIElement> Eyes = new(), Pupils = new(), NumTag = new();
        public readonly Dictionary<string, UIElement> Mouths = new();
        // where the window's own Eyes canvas and number badge go among the drawing's things
        public Panel? EyesSlot, NumSlot;
        public readonly List<(string Name, ScaleTransform S, RotateTransform R, TranslateTransform T, Canvas Outer)> Moving = new();

        // What he does while a session works (avatar.js's bake: <props> and <states>, the board's own data).
        // Each prop is a canvas of drawing, hidden until its state is on; Layer says where it rides: "back"
        // (behind him), "body" (with his body) or "root" (with all of him). PropParts are the names of the
        // moving parts inside props, which a state sets in place where his own parts are eased.
        public readonly List<(string State, string Layer, Canvas Canvas)> Props = new();
        public readonly HashSet<string> PropParts = new();
        public readonly Dictionary<string, StateDef> States = new();

        // One number moved over time, as avatar.js has it: k "f" frames of (value, seconds) eased into each
        // other, "l" a straight run from a to b that wraps, "w" a swell from a to b and back; ph a phase
        // (a fraction of its length) and Dur a length of its own (else the state's).
        internal sealed class Track
        {
            public string Part = "", Prop = "";
            public char Kind = 'f';
            public double A, B, Ph, Dur;
            public (double V, double T)[] Frames = Array.Empty<(double, double)>();
        }

        internal sealed class StateDef
        {
            public string Id = "", Mouth = "neutral";
            public double Dur = 2, Lids = 1, BobRise = 4, BobSeconds = 1.6;
            public bool Blink = true;
            public readonly List<Track> Tracks = new();
        }

        private static double Frac(double x) => ((x % 1) + 1) % 1;
        private static double Ease(double u) => (1 - Math.Cos(Math.PI * u)) / 2;

        // The value of a track t seconds into a state of length dur: avatar.js's evalTrack, so he moves as the page's does.
        internal static double Eval(Track tr, double t, double dur)
        {
            double d = tr.Dur > 0 ? tr.Dur : dur, lt = ((t % d) + d) % d;
            if (tr.Kind == 'l') return tr.A + (tr.B - tr.A) * Frac(lt / d + tr.Ph);
            if (tr.Kind == 'w') return tr.A + (tr.B - tr.A) * Math.Sin(Math.PI * Frac(lt / d + tr.Ph));
            var f = tr.Frames;
            if (f.Length == 0) return 0;
            if (f.Length == 1 || lt <= f[0].T) return f[0].V;
            for (int i = 1; i < f.Length; i++)
            {
                if (lt <= f[i].T)
                {
                    var (v0, t0) = f[i - 1];
                    var (v1, t1) = f[i];
                    return v0 + (v1 - v0) * Ease(t1 > t0 ? (lt - t0) / (t1 - t0) : 1);
                }
            }
            return f[^1].V;
        }

        private readonly Dictionary<string, Brush> gradients = new();
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        // ---------------------------------------------------------------- reading

        public static AvatarArt? Read(string text)
        {
            try
            {
                var doc = XElement.Parse(text);
                if (doc.Name.LocalName != "tatty") return null;
                var art = new AvatarArt { Id = (string?)doc.Attribute("av") ?? "" };
                foreach (var g in doc.Element("defs")?.Elements() ?? Enumerable.Empty<XElement>()) art.Gradient(g);
                var root = doc.Elements("part").FirstOrDefault(p => (string?)p.Attribute("name") == "Root");
                if (root == null) return null;
                art.Root = Pt(root, "c", art.Root);
                bool backDone = false;
                foreach (var p in root.Elements())
                {
                    string name = (string?)p.Attribute("name") ?? "";
                    if (p.Name.LocalName != "part") continue;
                    if (name == "LegL") { art.LegLPivot = Pt(p, "c", art.LegLPivot); art.Kids(p, art.LegL); }
                    else if (name == "LegR") { art.LegRPivot = Pt(p, "c", art.LegRPivot); art.Kids(p, art.LegR); }
                    else if (name == "Body" && !backDone && p.ElementsAfterSelf("part").Any(x => (string?)x.Attribute("name") == "LegL"))
                    { backDone = true; art.Kids(p, art.Back); }
                    else if (name == "Body") { art.BodyPivot = Pt(p, "c", art.BodyPivot); art.Kids(p, art.Body); }
                }
                if (art.Body.Count == 0) return null;
                try { art.ReadStates(doc); }
                catch (Exception) { art.Props.Clear(); art.States.Clear(); }  // the states are an extra: without them he is still himself
                return art;
            }
            catch (Exception)
            {
                return null;  // a description that doesn't read leaves him as he was
            }
        }

        // The working states' props and tracks (see Props and States).
        private void ReadStates(XElement doc)
        {
            foreach (var pr in doc.Element("props")?.Elements("prop") ?? Enumerable.Empty<XElement>())
            {
                int before = Moving.Count;
                var canvas = (Canvas)KidsCanvas(pr);
                canvas.Visibility = Visibility.Collapsed;
                Props.Add(((string?)pr.Attribute("state") ?? "", (string?)pr.Attribute("layer") ?? "", canvas));
                for (int i = before; i < Moving.Count; i++) PropParts.Add(Moving[i].Name);
            }
            foreach (var st in doc.Element("states")?.Elements("state") ?? Enumerable.Empty<XElement>())
            {
                var def = new StateDef
                {
                    Id = (string?)st.Attribute("id") ?? "", Mouth = (string?)st.Attribute("mouth") ?? "neutral",
                    Dur = Math.Max(0.1, Num(st, "dur", 2)), Lids = Num(st, "lids", 1), Blink = Num(st, "blink", 1) != 0,
                };
                var bob = ((string?)st.Attribute("bob") ?? "").Split(',');
                if (bob.Length == 2 && double.TryParse(bob[0], NumberStyles.Float, Inv, out var rise) && double.TryParse(bob[1], NumberStyles.Float, Inv, out var secs))
                { def.BobRise = rise; def.BobSeconds = Math.Max(0.2, secs); }
                foreach (var t in st.Elements("track"))
                {
                    var at = ((string?)t.Attribute("p") ?? "").Split('.');
                    if (at.Length != 2) continue;
                    var tr = new Track { Part = at[0], Prop = at[1], Kind = ((string?)t.Attribute("k") ?? "f")[0], A = Num(t, "a"), B = Num(t, "b"), Ph = Num(t, "ph"), Dur = Num(t, "dur") };
                    if (tr.Kind == 'f')
                    {
                        tr.Frames = ((string?)t.Attribute("v") ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)
                            .Select(x => x.Split(',')).Where(x => x.Length == 2)
                            .Select(x => (double.Parse(x[0], Inv), double.Parse(x[1], Inv))).ToArray();
                    }
                    def.Tracks.Add(tr);
                }
                if (def.Id.Length > 0) States[def.Id] = def;
            }
        }

        private void Kids(XElement from, List<UIElement> into)
        {
            foreach (var e in from.Elements())
            {
                var made = Make(e);
                if (made != null) into.Add(made);
            }
        }

        private Panel KidsCanvas(XElement from)
        {
            var c = new Canvas();
            foreach (var e in from.Elements())
            {
                var made = Make(e);
                if (made != null) c.Children.Add(made);
            }
            return c;
        }

        private UIElement? Make(XElement e)
        {
            switch (e.Name.LocalName)
            {
                case "eyes":
                    EyesPivot = Pt(e, "c", EyesPivot);
                    foreach (var k in e.Elements())
                    {
                        if (k.Name.LocalName == "pupils") { Kids(k, Pupils); Eyes.Add(new PupilsMark()); }
                        else { var m = Make(k); if (m != null) Eyes.Add(m); }
                    }
                    EyesSlot = new Canvas();
                    return EyesSlot;
                case "numtag":
                    if (e.Attribute("text") != null) NumberAt = Pt(e, "text", new Point(52, 80));
                    if (e.Attribute("size") != null) NumberSize = Num(e, "size", 7);
                    NumberPaint = Paint((string?)e.Attribute("fill"), 1);
                    Kids(e, NumTag);
                    NumSlot = new Canvas();
                    return NumSlot;
                case "badge":
                    BadgeAt = Pt(e, "at", BadgeAt);
                    return null;
                case "mouth":
                {
                    // hidden until Avatar.cs shows the one his pose or state wants (neutral, happy and flat for
                    // the poses; the "o" and the wobbly one belong to the states)
                    var c = KidsCanvas(e);
                    c.Visibility = Visibility.Collapsed;
                    Mouths[(string?)e.Attribute("name") ?? ""] = c;
                    return c;
                }
                case "g":
                {
                    var c = KidsCanvas(e);
                    c.RenderTransform = Transform((string?)e.Attribute("transform"));
                    c.Opacity = Num(e, "opacity", 1);
                    string? moving = (string?)e.Attribute("p");
                    if (string.IsNullOrEmpty(moving)) return c;
                    // a part of his own that moves: a canvas around it to move it by, about its pivot
                    var at = Pt(e, "c", new Point());
                    var s = new ScaleTransform(1, 1, at.X, at.Y);
                    var r = new RotateTransform(0, at.X, at.Y);
                    var t = new TranslateTransform();
                    var outer = new Canvas { RenderTransform = new TransformGroup { Children = { s, r, t } } };
                    outer.Children.Add(c);
                    Moving.Add((moving!, s, r, t, outer));
                    return outer;
                }
                case "text":
                {
                    // a prop's words (the "?"): drawn the way the project number is, its baseline at (x, y)
                    double size = Num(e, "size", 10);
                    bool middle = (string?)e.Attribute("anchor") == "middle";
                    var tb = new TextBlock
                    {
                        Text = e.Value, FontSize = size, FontFamily = new FontFamily("Segoe UI"),
                        FontWeight = Num(e, "weight", 400) >= 700 ? FontWeights.ExtraBold : FontWeights.Normal,
                        Foreground = Paint((string?)e.Attribute("fill"), 1) ?? Brushes.Black,
                        Width = 40, TextAlignment = middle ? TextAlignment.Center : TextAlignment.Left,
                        Opacity = Num(e, "opacity", 1), RenderTransform = Transform((string?)e.Attribute("transform")),
                    };
                    Canvas.SetLeft(tb, Num(e, "x") - (middle ? 20 : 0));
                    Canvas.SetTop(tb, Num(e, "y") - size * 1.05);
                    return tb;
                }
                default:
                    return Shape(e);
            }
        }

        // the window's own Pupils canvas goes here among the eyes' things
        internal sealed class PupilsMark : UIElement { }

        // ---------------------------------------------------------------- shapes

        private UIElement? Shape(XElement e)
        {
            Geometry? g;
            try
            {
                g = e.Name.LocalName switch
                {
                    "path" => Geometry.Parse("F1 " + ((string?)e.Attribute("d") ?? "")),
                    "circle" => new EllipseGeometry(new Point(Num(e, "cx"), Num(e, "cy")), Num(e, "r"), Num(e, "r")),
                    "ellipse" => new EllipseGeometry(new Point(Num(e, "cx"), Num(e, "cy")), Num(e, "rx"), Num(e, "ry")),
                    "rect" => new RectangleGeometry(new Rect(Num(e, "x"), Num(e, "y"), Math.Max(0, Num(e, "width")), Math.Max(0, Num(e, "height"))),
                                                    Num(e, "rx", Num(e, "ry")), Num(e, "ry", Num(e, "rx"))),
                    "line" => new LineGeometry(new Point(Num(e, "x1"), Num(e, "y1")), new Point(Num(e, "x2"), Num(e, "y2"))),
                    "polygon" => Geometry.Parse("F1 M " + ((string?)e.Attribute("points") ?? "") + " Z"),
                    _ => null,
                };
            }
            catch (FormatException) { return null; }
            if (g == null) return null;
            var path = new System.Windows.Shapes.Path
            {
                Data = g,
                Fill = Paint((string?)e.Attribute("fill"), Num(e, "fill-opacity", 1)),
                Opacity = Num(e, "opacity", 1),
                RenderTransform = Transform((string?)e.Attribute("transform")),
            };
            var stroke = Paint((string?)e.Attribute("stroke"), Num(e, "stroke-opacity", 1));
            if (stroke != null)
            {
                path.Stroke = stroke;
                path.StrokeThickness = Num(e, "stroke-width", 1);
                var cap = (string?)e.Attribute("stroke-linecap") switch { "round" => PenLineCap.Round, "square" => PenLineCap.Square, _ => PenLineCap.Flat };
                path.StrokeStartLineCap = path.StrokeEndLineCap = path.StrokeDashCap = cap;
                path.StrokeLineJoin = (string?)e.Attribute("stroke-linejoin") switch { "round" => PenLineJoin.Round, "bevel" => PenLineJoin.Bevel, _ => PenLineJoin.Miter };
            }
            return path;
        }

        // "#rrggbbaa" (the page's form), "url(#id)" or "none"
        private Brush? Paint(string? value, double opacity)
        {
            if (string.IsNullOrEmpty(value) || value == "none") return null;
            if (value.StartsWith("url(#", StringComparison.Ordinal))
            {
                string id = value.Substring(5).TrimEnd(')');
                if (!gradients.TryGetValue(id, out var b)) return null;
                if (opacity >= 1) return b;
                var faded = b.Clone();
                faded.Opacity = opacity;
                return faded;
            }
            var c = Colour(value);
            if (c == null) return null;
            return new SolidColorBrush(c.Value) { Opacity = opacity };
        }

        private static Color? Colour(string hex)
        {
            if (!hex.StartsWith("#", StringComparison.Ordinal) || (hex.Length != 7 && hex.Length != 9)) return null;
            byte At(int i) => byte.Parse(hex.Substring(i, 2), NumberStyles.HexNumber, Inv);
            try { return Color.FromArgb(hex.Length == 9 ? At(7) : (byte)255, At(1), At(3), At(5)); }
            catch (FormatException) { return null; }
        }

        private void Gradient(XElement g)
        {
            string id = (string?)g.Attribute("id") ?? "";
            var stops = new GradientStopCollection();
            foreach (var s in g.Elements("stop"))
            {
                var c = Colour((string?)s.Attribute("color") ?? "") ?? Colors.Transparent;
                c.A = (byte)Math.Round(c.A * Num(s, "opacity", 1));
                stops.Add(new GradientStop(c, Num(s, "offset")));
            }
            if (g.Name.LocalName == "linearGradient")
                gradients[id] = new LinearGradientBrush(stops, new Point(Num(g, "x1", 0), Num(g, "y1", 0)), new Point(Num(g, "x2", 1), Num(g, "y2", 0)));
            else if (g.Name.LocalName == "radialGradient")
                gradients[id] = new RadialGradientBrush(stops);
        }

        // An SVG transform list ("translate(52 24) scale(.8) rotate(-12)", or the browser's
        // "matrix(a, b, c, d, e, f)"). SVG applies the last one first, WPF's group the first one.
        private static readonly Regex Step = new(@"(translate|rotate|scale|matrix)\s*\(([^)]*)\)", RegexOptions.Compiled);

        internal static Transform Transform(string? list)
        {
            if (string.IsNullOrWhiteSpace(list)) return System.Windows.Media.Transform.Identity;
            var group = new TransformGroup();
            foreach (Match m in Step.Matches(list).Cast<Match>().Reverse())
            {
                var a = m.Groups[2].Value.Split(new[] { ' ', ',', '\t' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(x => double.Parse(x.Replace("px", ""), Inv)).ToArray();
                if (a.Length == 0) continue;
                switch (m.Groups[1].Value)
                {
                    case "translate": group.Children.Add(new TranslateTransform(a[0], a.Length > 1 ? a[1] : 0)); break;
                    case "rotate": group.Children.Add(a.Length >= 3 ? new RotateTransform(a[0], a[1], a[2]) : new RotateTransform(a[0])); break;
                    case "scale": group.Children.Add(new ScaleTransform(a[0], a.Length > 1 ? a[1] : a[0])); break;
                    case "matrix" when a.Length == 6: group.Children.Add(new MatrixTransform(new Matrix(a[0], a[1], a[2], a[3], a[4], a[5]))); break;
                }
            }
            return group.Children.Count == 0 ? System.Windows.Media.Transform.Identity : group;
        }

        private static double Num(XElement e, string name, double otherwise = 0) =>
            double.TryParse((string?)e.Attribute(name), NumberStyles.Float, Inv, out var v) ? v : otherwise;

        private static Point Pt(XElement e, string name, Point otherwise)
        {
            var parts = ((string?)e.Attribute(name) ?? "").Split(',');
            return parts.Length == 2 && double.TryParse(parts[0], NumberStyles.Float, Inv, out var x)
                   && double.TryParse(parts[1], NumberStyles.Float, Inv, out var y) ? new Point(x, y) : otherwise;
        }

        // ---------------------------------------------------------------- his own parts' idle motion

        // What each of an avatar's own moving parts does while he stands about, kept small: the
        // page's shop has the full performances; on the desktop these only keep him alive.
        // (name, what moves, from, to, seconds one way)
        private static readonly (string Name, string Prop, double From, double To, double Seconds)[] IdleMoves =
        {
            ("Tail", "a", -6, 8, 1.0), ("ArmL", "a", 0, 5, 1.6), ("ArmR", "a", 0, -5, 1.6),
            ("Prop", "sx", 1, -1, 0.12), ("Halo", "y", 0, -2.5, 1.2), ("Tassel", "a", -9, 9, 1.1),
            ("Jet", "sy", 1, 0.72, 0.16), ("Flame", "sy", 1, 0.78, 0.16), ("Balloon", "a", -5, 5, 2.0),
            ("WingL", "a", 0, 9, 0.8), ("WingR", "a", 0, -9, 0.8), ("Key", "sy", 1, -1, 1.2), ("Needle", "a", -4, 6, 2.0),
        };

        public void Idle(bool lively)
        {
            var ease = new SineEase { EasingMode = EasingMode.EaseInOut };
            foreach (var (name, s, r, t, _) in Moving)
            {
                foreach (var m in IdleMoves.Where(x => x.Name == name))
                {
                    var anim = lively
                        ? new DoubleAnimation(m.From, m.To, TimeSpan.FromSeconds(m.Seconds)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = ease }
                        : null;
                    switch (m.Prop)
                    {
                        case "a": r.BeginAnimation(RotateTransform.AngleProperty, anim); break;
                        case "sx": s.BeginAnimation(ScaleTransform.ScaleXProperty, anim); break;
                        case "sy": s.BeginAnimation(ScaleTransform.ScaleYProperty, anim); break;
                        case "y": t.BeginAnimation(TranslateTransform.YProperty, anim); break;
                    }
                }
            }
        }

        // ---------------------------------------------------------------- kept between runs

        // The last look the page sent, so the next start shows him as he is from the first frame
        // rather than in his old clothes until the page has loaded.
        private static string Where => System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tatty", "avatar-art.xml");

        public static string? Saved()
        {
            try { return System.IO.File.Exists(Where) ? System.IO.File.ReadAllText(Where) : null; } catch (Exception) { return null; }
        }

        public static void Save(string text)
        {
            try
            {
                System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Where)!);
                System.IO.File.WriteAllText(Where, text);
            }
            catch (Exception) { }
        }
    }
}
